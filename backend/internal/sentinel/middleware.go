package sentinel

import (
	"errors"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// Middleware is the HTTP middleware that attaches a Clamp to every
// request context. Mount it ONCE per route group in main.go, downstream
// of auth.RequireAuth — see S05.
//
// Resolution order for the workspace_id (PLA-0053 + S05 absorption):
//  1. JWT workspace_id claim   (PLA-0053 era; the common path)
//  2. resolver.FirstLiveWorkspace(tenantID) (legacy-token fallback)
//     Then resolver.HasActiveRole(workspaceID, userID) MUST return true
//     (forgery guard + role-revocation guard) regardless of which path
//     was taken — false → 403 /errors/sentinel/no-workspace-role.
//
// Resolution order for the focus node:
//  1. ?focus=<uuid> query parameter (URL wins when it is in the JWT workspace)
//  2. resolver.DefaultFocus(userID)  (per-user persisted preference)
//  3. resolver.WorkspaceRoot(workspaceID) (current workspace root)
//  4. resolver.TenantRoot(tenantID)  (final emergency fallback)
//
// Scope-up / scope-down default to true (Rally idiom — see RES059).
// Both must be explicitly "false" to clamp to the focus node alone.
//
// Failure modes (all RFC 9457 problem+json):
//   - No auth on ctx              → 401 /errors/sentinel/unauthorized
//   - Tenant has no live workspace → 403 /errors/sentinel/no-workspace
//   - User has no role on workspace → 403 /errors/sentinel/no-workspace-role
//   - Focus in another tenant     → 403 /errors/sentinel/focus-not-in-tenant
//   - User has no grant on focus  → 403 /errors/sentinel/focus-no-access
//   - Resolver internal error     → 500 /errors/sentinel/internal
func Middleware(r Resolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// Step 1 — auth must already have run.
			u := auth.UserFromCtx(req.Context())
			if u == nil {
				writeProblem(w, req, http.StatusUnauthorized, "unauthorized",
					"authentication required")
				return
			}

			// Step 2 — resolve workspace_id (JWT claim > FirstLive fallback).
			workspaceID, werr := resolveWorkspace(req, u, r)
			if werr != nil {
				switch {
				case errors.Is(werr, ErrNoWorkspace):
					writeProblem(w, req, http.StatusForbidden, "no-workspace",
						"you have no accessible live workspace in this tenant")
					return
				default:
					log.Printf("sentinel.Middleware resolveWorkspace: %v", werr)
					writeProblem(w, req, http.StatusInternalServerError, "internal",
						"workspace resolution failed")
					return
				}
			}

			// Step 3 — forgery / role-revocation guard.
			// MUST run for both JWT-claim and FirstLive paths so a
			// forged claim can't reach a workspace the actor has no
			// grant on.
			has, rerr := r.HasActiveRole(req.Context(), workspaceID, u.ID)
			if rerr != nil {
				log.Printf("sentinel.Middleware HasActiveRole: %v", rerr)
				writeProblem(w, req, http.StatusInternalServerError, "internal",
					"role check failed")
				return
			}
			if !has {
				writeProblem(w, req, http.StatusForbidden, "no-workspace-role",
					"you have no active role on the resolved workspace")
				return
			}

			// Step 4 — resolve scope_up / scope_down from query.
			// Defaults are TRUE per Rally idiom. Only the literal string
			// "false" or "0" flips them off.
			scopeUp := !isQueryFalse(req, "scope_up")
			scopeDown := !isQueryFalse(req, "scope_down")

			// Step 5 — resolve focus node (URL > user default > workspace root > tenant root).
			focus, source, ferr := resolveFocus(req, u.ID, u.SubscriptionID, workspaceID, u.RoleID, r)
			if ferr != nil {
				switch {
				case errors.Is(ferr, ErrFocusNoAccess):
					writeProblem(w, req, http.StatusForbidden, "focus-no-access",
						"you do not have access to the requested focus node")
				default:
					log.Printf("sentinel.Middleware resolveFocus: %v", ferr)
					writeProblem(w, req, http.StatusInternalServerError, "internal",
						"focus resolution failed")
				}
				return
			}

			// Step 6 — resolve allowed subtree (or get a sentinel error).
			ids, serr := r.ResolveSubtree(req.Context(), u.SubscriptionID, focus, scopeUp, scopeDown)
			if serr != nil && source == focusSourceDefault &&
				(errors.Is(serr, ErrFocusNotInTenant) || errors.Is(serr, ErrFocusNoAccess)) {
				fallback, ferr := fallbackFocus(req, u.SubscriptionID, workspaceID, r)
				if ferr != nil {
					log.Printf("sentinel.Middleware fallbackFocus: %v", ferr)
					writeProblem(w, req, http.StatusInternalServerError, "internal",
						"focus fallback failed")
					return
				}
				fallbackIDs, fallbackErr := r.ResolveSubtree(req.Context(), u.SubscriptionID, fallback, scopeUp, scopeDown)
				if fallbackErr == nil {
					focus = fallback
					ids = fallbackIDs
					serr = nil
				}
			}
			if serr != nil {
				switch {
				case errors.Is(serr, ErrFocusNotInTenant):
					writeProblem(w, req, http.StatusForbidden, "focus-not-in-tenant",
						"the requested focus node belongs to a different tenant")
					return
				case errors.Is(serr, ErrFocusNoAccess):
					writeProblem(w, req, http.StatusForbidden, "focus-no-access",
						"you do not have access to the requested focus node")
					return
				default:
					log.Printf("sentinel.Middleware ResolveSubtree: %v", serr)
					writeProblem(w, req, http.StatusInternalServerError, "internal",
						"subtree resolution failed")
					return
				}
			}

			// Step 7 — attach clamp + serve inner handler.
			c := Clamp{
				TenantID:          u.SubscriptionID,
				UserID:            u.ID,
				Role:              string(u.Role),
				RoleID:            u.RoleID,
				WorkspaceID:       workspaceID,
				FocusNodeID:       focus,
				ScopeUp:           scopeUp,
				ScopeDown:         scopeDown,
				AllowedSubtreeIDs: ids,
				// Step 7 is only reached on the success path (every error
				// path above returns first). A real subtree was resolved,
				// so the SQL helpers must fail CLOSED if ids is somehow
				// empty rather than fall back to subscription-only scoping.
				SubtreeResolved: true,
			}
			next.ServeHTTP(w, req.WithContext(withClamp(req.Context(), c)))
		})
	}
}

// resolveWorkspace picks the workspace per JWT claim > FirstLiveWorkspace
// fallback. The fallback exists for tokens predating PLA-0053 (story
// 00576, 2026-05-16) plus any future code path that signs without the
// claim. As of 2026-05-25 the fallback narrows to user-granted workspaces
// — see sentinel/sql.go for rationale.
func resolveWorkspace(req *http.Request, u *roletypes.User, r Resolver) (uuid.UUID, error) {
	if u.WorkspaceID != uuid.Nil {
		return u.WorkspaceID, nil
	}
	return r.FirstLiveWorkspace(req.Context(), u.SubscriptionID, u.ID)
}

type focusSource string

const (
	focusSourceURL           focusSource = "url"
	focusSourceDefault       focusSource = "default"
	focusSourceWorkspaceRoot focusSource = "workspace-root"
	focusSourceTenantRoot    focusSource = "tenant-root"
)

// resolveFocus picks the focus node per URL > user default > workspace root > tenant root.
// Returns the resolved UUID; an error from this function indicates an
// infrastructure failure (resolver / DB lookup), not a user-visible
// 4xx — those come from ResolveSubtree.
//
// roleID is threaded into r.GrantOnNode so the gadmin short-circuit
// fires here — see PoolResolver.GrantOnNode docs for the rationale.
// Callers (middleware) MUST pass the actor's authenticated u.RoleID.
func resolveFocus(req *http.Request, userID, tenantID, workspaceID, roleID uuid.UUID, r Resolver) (uuid.UUID, focusSource, error) {
	// Step 1 — URL ?meg= (PLA-0053; named after Rick's daughter Megan;
	// canonical scope-identity URL param across the project)
	if raw := req.URL.Query().Get("meg"); raw != "" {
		if id, err := uuid.Parse(raw); err == nil {
			if ok, werr := focusInWorkspace(req, tenantID, workspaceID, id, r); werr != nil {
				// Preserve the historical explicit-bad-link behaviour:
				// a URL focus that is archived/cross-tenant should 403 in
				// ResolveSubtree, while a same-tenant focus from a different
				// workspace is treated as stale and falls through.
				if !errors.Is(werr, pgx.ErrNoRows) {
					return uuid.Nil, "", werr
				}
				return id, focusSourceURL, nil
			} else if ok {
				if accessOK, aerr := r.GrantOnNode(req.Context(), tenantID, userID, id, roleID); aerr != nil {
					return uuid.Nil, "", aerr
				} else if !accessOK {
					return uuid.Nil, "", ErrFocusNoAccess
				}
				return id, focusSourceURL, nil
			}
		}
		// Malformed UUID in the URL → treat as if absent and fall through.
		// A future S## may decide to 400 on this instead; for now we
		// match Rally's "garbage focus → user default" tolerance.
	}

	// Step 2 — user default (only call if resolver provides it; the
	// stub in tests may set defaultFocusFn nil)
	if def, err := r.DefaultFocus(req.Context(), userID); err != nil {
		return uuid.Nil, "", err
	} else if def != nil {
		if ok, werr := focusInWorkspace(req, tenantID, workspaceID, *def, r); werr != nil {
			// Deleted/archived/cross-tenant saved default: ignore and
			// fall back. This is a user preference, not an explicit
			// request, so it should never strand the session.
			if !errors.Is(werr, pgx.ErrNoRows) {
				return uuid.Nil, "", werr
			}
		} else if ok {
			if accessOK, aerr := r.GrantOnNode(req.Context(), tenantID, userID, *def, roleID); aerr != nil {
				return uuid.Nil, "", aerr
			} else if !accessOK {
				return fallbackFocusWithSource(req, tenantID, workspaceID, r)
			}
			return *def, focusSourceDefault, nil
		}
	}

	// Step 3 — current workspace root.
	return fallbackFocusWithSource(req, tenantID, workspaceID, r)
}

func fallbackFocus(req *http.Request, tenantID, workspaceID uuid.UUID, r Resolver) (uuid.UUID, error) {
	root, _, err := fallbackFocusWithSource(req, tenantID, workspaceID, r)
	return root, err
}

func fallbackFocusWithSource(req *http.Request, tenantID, workspaceID uuid.UUID, r Resolver) (uuid.UUID, focusSource, error) {
	if root, err := r.WorkspaceRoot(req.Context(), tenantID, workspaceID); err == nil {
		return root, focusSourceWorkspaceRoot, nil
	}
	root, err := r.TenantRoot(req.Context(), tenantID)
	return root, focusSourceTenantRoot, err
}

func focusInWorkspace(req *http.Request, tenantID, workspaceID, focus uuid.UUID, r Resolver) (bool, error) {
	focusWorkspace, err := r.FocusWorkspace(req.Context(), tenantID, focus)
	if err != nil {
		return false, err
	}
	return focusWorkspace == workspaceID, nil
}

// isQueryFalse returns true when the named query param is explicitly
// "false" or "0". Anything else (missing, "true", "1", garbage) treats
// the param as on — Rally's defaults-true contract.
func isQueryFalse(req *http.Request, name string) bool {
	v := req.URL.Query().Get(name)
	return v == "false" || v == "0"
}
