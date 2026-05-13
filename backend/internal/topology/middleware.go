package topology

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
// route group whose handlers query any table carrying org_node_id.
//
// Costs: one recursive CTE per request. The query is indexed
// (idx_org_node_roles_user_active in migration 083) and bounded by the
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

// tenantRootID resolves the subscription's single root topology_node —
// the node with parent_id IS NULL. Used by ClampMiddleware to decide
// whether the user's grant set covers the entire tenant.
//
// This deliberately does NOT read WorkspaceIDFromCtx — the per-node
// clamp predicate needs the absolute tenant root to detect the
// "ClampAll" shortcut. Callers that want the workspace-scoped root
// must use TenantRootID instead.
func (s *Service) tenantRootID(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.vaPool.QueryRow(ctx, `
		SELECT id FROM topology_nodes
		 WHERE subscription_id = $1
		   AND parent_id IS NULL
		   AND archived_at IS NULL
		 ORDER BY sort_order
		 LIMIT 1
	`, subscriptionID).Scan(&id)
	return id, err
}

// TenantRootID resolves the canonical root of subscriptionID — the
// lowest-sort_order live node with parent_id IS NULL — narrowed to the
// request's workspace clamp when present (story 00378). Returns
// pgx.ErrNoRows when the (workspace-scoped) tenant has no root.
//
// This is the entry point handlers use when the client did not pass
// `?root=<id>`: the workspace clamp middleware has already chosen the
// workspace, so the root resolves WITHIN that workspace and never
// crosses to a sibling workspace's root in the same subscription.
func (s *Service) TenantRootID(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	wsClause, args, _ := workspaceClause(ctx, "topology_nodes", []any{subscriptionID})
	var id uuid.UUID
	err := s.vaPool.QueryRow(ctx, `
		SELECT id FROM topology_nodes
		 WHERE subscription_id = $1
		   AND parent_id IS NULL
		   AND archived_at IS NULL`+wsClause+`
		 ORDER BY sort_order
		 LIMIT 1
	`, args...).Scan(&id)
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

// ─────────────────────────────────────────────────────────────────────
// Workspace clamp (PLA-0006 / story 00378)
//
// Above the per-node grant clamp sits a coarser scope: every list
// endpoint that reads topology_nodes must narrow to a single workspace.
// The workspace is resolved per-request from `?ws=<slug>` (or, when
// absent, the actor's first live workspace in their tenant). Cross-
// tenant access returns 404, in-tenant access without a role on the
// target workspace returns 403 — explicitly NOT an empty list, so a
// caller can't probe slug existence by diffing 200 vs 200-empty.
//
// The middleware seeds workspaceCtxKey on the request context; the
// service-layer reads (Subtree / ListDisconnected / ArchivedDescendants
// / Tree-root resolution) splice it into their WHERE clauses through
// WorkspaceIDFromCtx. Write paths do NOT consume this — writes go
// through orgdesign.Service whose tenant scope is already enforced
// per-call by subscription_id.
// ─────────────────────────────────────────────────────────────────────

type workspaceCtxKey struct{}

// WorkspaceIDFromCtx returns the workspace_id seeded by
// WorkspaceClampMiddleware. The bool reports whether a workspace
// clamp ran for this request — list-style reads call it with the
// understanding that, when false, the route was not mounted under
// the clamp middleware (admin tools / migrations) and the read may
// fall back to the unclamped form.
func WorkspaceIDFromCtx(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(workspaceCtxKey{}).(uuid.UUID)
	return id, ok
}

// WithWorkspaceIDForTest seeds a workspace_id into context the way
// WorkspaceClampMiddleware would. Test-only — production code paths
// must go through the middleware so the role check actually runs.
func WithWorkspaceIDForTest(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, workspaceCtxKey{}, id)
}

// WorkspaceLookup is the read surface the workspace clamp consumes.
// Defined as an interface so tests can swap a fake without standing
// up workspaces.Service. Production wiring (cmd/server/main.go) passes
// PoolWorkspaceLookup, an adapter that runs pure SELECTs against
// `workspaces` and `roles_workspaces` — those reads sit safely outside
// the workspaces sole-writer boundary, which gates writes only.
type WorkspaceLookup interface {
	// FirstLiveWorkspace returns the actor's first live workspace in
	// their tenant ordered by created_at ASC (Default lands first).
	// Returns ErrNoWorkspace when the tenant has zero live workspaces.
	FirstLiveWorkspace(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error)

	// ResolveSlug looks up a live workspace by slug inside the tenant.
	// Returns ErrWorkspaceNotFound when missing.
	ResolveSlug(ctx context.Context, subscriptionID uuid.UUID, slug string) (uuid.UUID, error)

	// ResolveRef accepts either a UUID or a slug as `ref` and resolves
	// it to a live workspace_id inside the tenant. UUIDs are the
	// canonical identifier (stable across renames and reslugs); slugs
	// are accepted for human-friendly URLs. Returns ErrWorkspaceNotFound
	// when missing.
	ResolveRef(ctx context.Context, subscriptionID uuid.UUID, ref string) (uuid.UUID, error)

	// HasActiveRole reports whether userID holds any active grant on
	// workspaceID. Used to enforce AC#3: in-tenant requests for a
	// workspace the actor has no role on return 403, not an empty list.
	HasActiveRole(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error)
}

// Workspace-clamp sentinels. The middleware translates these to
// 403/404 status codes per the AC matrix; the lookup adapter returns
// the typed errors so the lookup itself stays HTTP-agnostic.
var (
	ErrNoWorkspace       = errors.New("orgdesign: actor has no live workspace in this tenant")
	ErrWorkspaceNotFound = errors.New("orgdesign: workspace slug not found in tenant")
)

// PoolQuerier is the *pgxpool.Pool subset PoolWorkspaceLookup needs.
// Defined as an interface so tests of the lookup itself can pass a
// fixture-backed connection rather than a full pool.
type PoolQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// PoolWorkspaceLookup is the production WorkspaceLookup adapter — it
// runs the three lookups against any PoolQuerier (typically *pgxpool.Pool).
type PoolWorkspaceLookup struct {
	Pool PoolQuerier
}

// FirstLiveWorkspace implements WorkspaceLookup.
func (l PoolWorkspaceLookup) FirstLiveWorkspace(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := l.Pool.QueryRow(ctx, `
		SELECT id FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY created_at ASC
		 LIMIT 1
	`, subscriptionID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNoWorkspace
	}
	return id, err
}

// ResolveSlug implements WorkspaceLookup.
func (l PoolWorkspaceLookup) ResolveSlug(ctx context.Context, subscriptionID uuid.UUID, slug string) (uuid.UUID, error) {
	var id uuid.UUID
	err := l.Pool.QueryRow(ctx, `
		SELECT id FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND slug = $2
		   AND archived_at IS NULL
		 LIMIT 1
	`, subscriptionID, slug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrWorkspaceNotFound
	}
	return id, err
}

// ResolveRef implements WorkspaceLookup. A well-formed UUID resolves
// by id (canonical, survives slug changes); anything else falls back
// to ResolveSlug. Both branches end with the same tenant + live
// gating so a UUID from another tenant returns ErrWorkspaceNotFound,
// not a cross-tenant leak.
func (l PoolWorkspaceLookup) ResolveRef(ctx context.Context, subscriptionID uuid.UUID, ref string) (uuid.UUID, error) {
	if id, err := uuid.Parse(ref); err == nil {
		var got uuid.UUID
		qerr := l.Pool.QueryRow(ctx, `
			SELECT id FROM master_record_workspaces
			 WHERE id              = $1
			   AND subscription_id = $2
			   AND archived_at IS NULL
			 LIMIT 1
		`, id, subscriptionID).Scan(&got)
		if errors.Is(qerr, pgx.ErrNoRows) {
			return uuid.Nil, ErrWorkspaceNotFound
		}
		return got, qerr
	}
	return l.ResolveSlug(ctx, subscriptionID, ref)
}

// HasActiveRole implements WorkspaceLookup.
func (l PoolWorkspaceLookup) HasActiveRole(ctx context.Context, workspaceID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := l.Pool.QueryRow(ctx, `
		SELECT EXISTS(
		    SELECT 1 FROM roles_workspaces
		     WHERE workspace_id = $1
		       AND user_id      = $2
		       AND revoked_at IS NULL
		)
	`, workspaceID, userID).Scan(&ok)
	return ok, err
}

// WorkspaceClampMiddleware narrows every read on its mounted routes to
// a single workspace. Request flow:
//
//   1. RequireAuth resolves the actor.
//   2. ?ws=<slug> resolves to a workspace_id in the actor's tenant.
//      Absent → first live workspace in tenant. Zero live workspaces
//      → 403 {"error":"no_workspace"}. Slug missing in tenant → 404.
//   3. Check the actor holds an active role on the resolved workspace.
//      If not → 403 {"error":"no_workspace_role"}. (Explicitly NOT an
//      empty list — see AC#3 of story 00378.)
//   4. Seed workspaceCtxKey on the request context.
//
// MUST run after RequireAuth. Mount alongside (or in place of) the
// per-node ClampMiddleware on every list endpoint that reads org_nodes.
func WorkspaceClampMiddleware(lookup WorkspaceLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := auth.UserFromCtx(r.Context())
			if u == nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			var workspaceID uuid.UUID
			ref := r.URL.Query().Get("ws")
			if ref == "" {
				id, err := lookup.FirstLiveWorkspace(r.Context(), u.SubscriptionID)
				if errors.Is(err, ErrNoWorkspace) {
					writeWorkspaceClampError(w, http.StatusForbidden, "no_workspace")
					return
				}
				if err != nil {
					http.Error(w, "internal error", http.StatusInternalServerError)
					return
				}
				workspaceID = id
			} else {
				// `?ws=<ref>` accepts either a UUID (canonical) or a
				// slug (human-friendly URL). Slug existed first; UUID
				// support was added so the frontend's switcher can
				// pass the stable id regardless of slug churn.
				id, err := lookup.ResolveRef(r.Context(), u.SubscriptionID, ref)
				if errors.Is(err, ErrWorkspaceNotFound) {
					writeWorkspaceClampError(w, http.StatusNotFound, "workspace_not_found")
					return
				}
				if err != nil {
					http.Error(w, "internal error", http.StatusInternalServerError)
					return
				}
				workspaceID = id
			}

			// AC#3: an actor asking for a workspace they have no role on
			// gets 403, not 200-empty. The check applies to BOTH the
			// slug-resolved and first-live paths so a tenant where the
			// actor has zero grants still cannot read by accident.
			has, err := lookup.HasActiveRole(r.Context(), workspaceID, u.ID)
			if err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if !has {
				writeWorkspaceClampError(w, http.StatusForbidden, "no_workspace_role")
				return
			}

			ctx := context.WithValue(r.Context(), workspaceCtxKey{}, workspaceID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// writeWorkspaceClampError emits {"error": "<code>"} with the given
// status. Same shape as the {"error":"parent_archived"} responses in
// handler.go so the frontend's existing JSON-error path handles every
// code.
func writeWorkspaceClampError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

// workspaceClause returns a SQL fragment that splices an
// `AND <alias>.workspace_id = $N` predicate onto a query when the
// request context carries a workspace clamp (story 00378). When no
// clamp is present (admin tools / migrations) the fragment is empty,
// `args` is returned unchanged, and slot is 0.
//
// Calling pattern for a single-alias query:
//
//	clause, args, _ := workspaceClause(ctx, "n", []any{rootID, subID})
//	pool.Query(ctx, "... WHERE ..."+clause, args...)
//
// For multi-alias queries (the Subtree recursive CTE has three
// references to org_nodes), call workspaceClause ONCE with the base
// args to bind the parameter slot, then use workspaceClauseAt for
// every additional alias passing the slot returned by the first call.
// Both helpers no-op when the clamp is absent.
//
// Reads are not constrained by the workspaces sole-writer lint
// (writer_boundary scopes to writes only), so this helper is allowed
// to embed `workspace_id` in queries living outside the workspaces
// package.
func workspaceClause(ctx context.Context, alias string, args []any) (clause string, out []any, slot int) {
	wsID, ok := WorkspaceIDFromCtx(ctx)
	if !ok {
		return "", args, 0
	}
	args = append(args, wsID)
	slot = len(args)
	return fmt.Sprintf(" AND %s.workspace_id = $%d", alias, slot), args, slot
}

// workspaceClauseAt returns the same fragment workspaceClause produces
// but reuses an already-bound parameter slot — used by multi-alias
// queries (e.g. the Subtree recursive CTE) where every alias points
// at the same workspace_id and adding the param multiple times would
// be wasteful.
//
// When slot == 0 the clamp is disabled (workspaceClause returned a
// zero slot), so the fragment is empty.
func workspaceClauseAt(alias string, slot int) string {
	if slot == 0 {
		return ""
	}
	return fmt.Sprintf(" AND %s.workspace_id = $%d", alias, slot)
}
