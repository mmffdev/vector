package sentinel

import (
	"errors"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

// Middleware is the HTTP middleware that attaches a Clamp to every
// request context. Mount it ONCE per route group in main.go, downstream
// of auth.RequireAuth — see S05.
//
// Resolution order for the focus node:
//   1. ?focus=<uuid> query parameter (URL wins — bookmarkable scope)
//   2. resolver.DefaultFocus(userID)  (per-user persisted preference)
//   3. resolver.TenantRoot(tenantID)  (final fallback — subscription root)
//
// Scope-up / scope-down default to true (Rally idiom — see RES059).
// Both must be explicitly "false" to clamp to the focus node alone.
//
// Failure modes (all RFC 9457 problem+json):
//   - No auth on ctx          → 401 /errors/sentinel/unauthorized
//   - Focus in another tenant → 403 /errors/sentinel/focus-not-in-tenant
//   - User has no grant       → 403 /errors/sentinel/focus-no-access
//   - Resolver internal error → 500 /errors/sentinel/internal
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

			// Step 2 — resolve scope_up / scope_down from query.
			// Defaults are TRUE per Rally idiom. Only the literal string
			// "false" or "0" flips them off.
			scopeUp := !isQueryFalse(req, "scope_up")
			scopeDown := !isQueryFalse(req, "scope_down")

			// Step 3 — resolve focus node (URL > user default > tenant root).
			focus, ferr := resolveFocus(req, u.ID, u.SubscriptionID, r)
			if ferr != nil {
				log.Printf("sentinel.Middleware resolveFocus: %v", ferr)
				writeProblem(w, req, http.StatusInternalServerError, "internal",
					"focus resolution failed")
				return
			}

			// Step 4 — resolve allowed subtree (or get a sentinel error).
			ids, rerr := r.ResolveSubtree(req.Context(), u.SubscriptionID, focus, scopeUp, scopeDown)
			if rerr != nil {
				switch {
				case errors.Is(rerr, ErrFocusNotInTenant):
					writeProblem(w, req, http.StatusForbidden, "focus-not-in-tenant",
						"the requested focus node belongs to a different tenant")
					return
				case errors.Is(rerr, ErrFocusNoAccess):
					writeProblem(w, req, http.StatusForbidden, "focus-no-access",
						"you do not have access to the requested focus node")
					return
				default:
					log.Printf("sentinel.Middleware ResolveSubtree: %v", rerr)
					writeProblem(w, req, http.StatusInternalServerError, "internal",
						"subtree resolution failed")
					return
				}
			}

			// Step 5 — attach clamp + serve inner handler.
			c := Clamp{
				TenantID:          u.SubscriptionID,
				UserID:            u.ID,
				Role:              string(u.Role),
				RoleID:            u.RoleID,
				FocusNodeID:       focus,
				ScopeUp:           scopeUp,
				ScopeDown:         scopeDown,
				AllowedSubtreeIDs: ids,
			}
			next.ServeHTTP(w, req.WithContext(withClamp(req.Context(), c)))
		})
	}
}

// resolveFocus picks the focus node per URL > user default > tenant root.
// Returns the resolved UUID; an error from this function indicates an
// infrastructure failure (resolver / DB lookup), not a user-visible
// 4xx — those come from ResolveSubtree.
func resolveFocus(req *http.Request, userID, tenantID uuid.UUID, r Resolver) (uuid.UUID, error) {
	// Step 1 — URL ?focus=
	if raw := req.URL.Query().Get("focus"); raw != "" {
		if id, err := uuid.Parse(raw); err == nil {
			return id, nil
		}
		// Malformed UUID in the URL → treat as if absent and fall through.
		// A future S## may decide to 400 on this instead; for now we
		// match Rally's "garbage focus → user default" tolerance.
	}

	// Step 2 — user default (only call if resolver provides it; the
	// stub in tests may set defaultFocusFn nil)
	if def, err := r.DefaultFocus(req.Context(), userID); err != nil {
		return uuid.Nil, err
	} else if def != nil {
		return *def, nil
	}

	// Step 3 — tenant root
	return r.TenantRoot(req.Context(), tenantID)
}

// isQueryFalse returns true when the named query param is explicitly
// "false" or "0". Anything else (missing, "true", "1", garbage) treats
// the param as on — Rally's defaults-true contract.
func isQueryFalse(req *http.Request, name string) bool {
	v := req.URL.Query().Get(name)
	return v == "false" || v == "0"
}
