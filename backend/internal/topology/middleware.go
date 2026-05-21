package topology

// HTTP middleware for the topology clamp substrate.
//
// Two middlewares mount above every list endpoint that reads
// org_node_id-bearing tables:
//
//   - ClampMiddleware           (per-node grant clamp, PLA-0006)
//   - WorkspaceClampMiddleware  (per-workspace clamp, story 00378)
//
// Plus the small workspaceClause / workspaceClauseAt helpers that
// service-layer SQL uses to splice the workspace_id predicate at
// runtime.
//
// Pure-context helpers (ClampFromCtx, WorkspaceIDFromCtx, sentinel
// types) live in context.go. The DB lookup adapter for workspaces
// (PoolWorkspaceLookup) lives in workspace_lookup.go. Service methods
// the middleware calls (tenantRootID, ClampPredicate) live in
// service.go.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

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
// PLA-0053 / story 00576 (2026-05-16): resolution source changed from
// `?ws=<slug|uuid>` URL parameter to the JWT workspace_id claim. The
// URL surface was dropped to honour feedback_url_is_path_only (no URL
// state of any kind). Legacy tokens that predate PLA-0053 carry no
// workspace_id claim and fall back to FirstLiveWorkspace below.
//
// The companion workspace switcher (topology) now POSTs to
// /_site/auth/switch-workspace to re-issue the JWT instead of
// toggling ?ws= in the address bar.
func WorkspaceClampMiddleware(lookup WorkspaceLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := auth.UserFromCtx(r.Context())
			if u == nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			var workspaceID uuid.UUID
			if u.WorkspaceID != uuid.Nil {
				// JWT carries the workspace_id claim — use it directly.
				// Skips the FirstLiveWorkspace DB lookup. Role check
				// below still runs so a forged claim (or a token
				// issued before role-revocation) can't reach a
				// workspace the actor has no active role on.
				workspaceID = u.WorkspaceID
			} else {
				// Legacy-token rollout window: JWT predates PLA-0053
				// and carries no workspace_id. Fall back to the
				// subscription's first live workspace.
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
			}

			// AC#3: an actor asking for a workspace they have no role on
			// gets 403, not 200-empty. The check applies to BOTH the
			// JWT-resolved and first-live paths so a tenant where the
			// actor has zero grants still cannot read by accident, and
			// a forged JWT claim can't bypass authorization.
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
