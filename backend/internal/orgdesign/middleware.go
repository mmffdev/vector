package orgdesign

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

// ClampMode describes the result of computing the clamp predicate for
// the current request. Three states the consumer must distinguish
// because the SQL each one generates is different.
type ClampMode int

const (
	// ClampUnscoped means no clamp middleware ran for this request.
	// Consumers MUST treat this as "no Topology filter applied" and
	// fall back to subscription-only scoping. This is the case for
	// admin / system tools that bypass the substrate.
	ClampUnscoped ClampMode = iota

	// ClampAll means the user has a grant at or above the tenant root,
	// so they see every node in their subscription. The SQL helper
	// returns no extra predicate — subscription_id alone is enough.
	ClampAll

	// ClampSubset means the user has at least one grant on a non-root
	// node. NodeIDs is the union of every subtree they can reach. SQL
	// must add `org_node_id = ANY($N)`.
	ClampSubset

	// ClampEmpty means the user has zero active grants — they see
	// nothing. SQL must short-circuit to an empty result.
	ClampEmpty
)

// Clamp is the value the middleware writes to the request context.
// Read it with ClampFromCtx in any list endpoint that touches a table
// carrying org_node_id.
type Clamp struct {
	Mode    ClampMode
	NodeIDs []uuid.UUID
}

type clampCtxKey struct{}

// ClampFromCtx returns the clamp computed by ClampMiddleware. When the
// middleware did not run (ClampUnscoped) the caller must decide whether
// to allow the request — list endpoints inside the user surface should
// consider that an error; admin tools may proceed.
func ClampFromCtx(ctx context.Context) Clamp {
	c, ok := ctx.Value(clampCtxKey{}).(Clamp)
	if !ok {
		return Clamp{Mode: ClampUnscoped}
	}
	return c
}

// withClamp seeds the clamp into the request context. Test-only — the
// middleware is the prod path.
func withClamp(ctx context.Context, c Clamp) context.Context {
	return context.WithValue(ctx, clampCtxKey{}, c)
}

// WithClampForTest is the public test seam. Used by handler tests in
// other packages so they don't have to spin up a real orgdesign
// service to exercise their clamp branches.
func WithClampForTest(ctx context.Context, c Clamp) context.Context {
	return withClamp(ctx, c)
}

// ClampMiddleware wraps a handler chain so that every request lands
// with a precomputed Clamp in its context. The middleware is mounted
// once at the router level (see backend/cmd/server/main.go) on every
// route group whose handlers query portfolio_items / user_stories or
// any other table carrying org_node_id.
//
// Costs: one recursive CTE per request. The query is indexed
// (idx_org_node_roles_user_active in migration 083 +
// idx_portfolio_items_org_node in migration 085) and bounded by the
// size of the user's grant set, which is small in practice. We do
// NOT cache across requests — the user's grants can change at any
// time and stale clamps would mean unauthorised reads, which is the
// failure mode this whole substrate exists to prevent.
//
// The middleware short-circuits to ClampEmpty when the user has no
// active grants at all — list endpoints can return [] in O(1) without
// hitting the underlying tables.
//
// MUST run after RequireAuth: it reads the authenticated user from
// context. Mounting it without auth is a programming error.
func (s *Service) ClampMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := auth.UserFromCtx(r.Context())
		if u == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		ids, err := s.ClampPredicate(r.Context(), u.SubscriptionID, u.ID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		c := Clamp{NodeIDs: ids}
		switch {
		case len(ids) == 0:
			c.Mode = ClampEmpty
		default:
			rootID, rootErr := s.tenantRootID(r.Context(), u.SubscriptionID)
			if rootErr == nil && containsID(ids, rootID) {
				c.Mode = ClampAll
				// Clear NodeIDs so consumers don't accidentally use
				// them as a filter when ClampAll says "no extra WHERE".
				c.NodeIDs = nil
			} else {
				c.Mode = ClampSubset
			}
		}

		ctx := withClamp(r.Context(), c)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// tenantRootID resolves the subscription's single root org_node — the
// node with parent_id IS NULL. Used by ClampMiddleware to decide
// whether the user's grant set covers the entire tenant.
func (s *Service) tenantRootID(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM org_nodes
		 WHERE subscription_id = $1
		   AND parent_id IS NULL
		   AND archived_at IS NULL
		 ORDER BY position
		 LIMIT 1
	`, subscriptionID).Scan(&id)
	return id, err
}

func containsID(haystack []uuid.UUID, needle uuid.UUID) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}
