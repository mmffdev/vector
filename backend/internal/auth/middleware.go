package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/pageaccess"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

type ctxKey string

const userCtxKey ctxKey = "user"

func UserFromCtx(ctx context.Context) *roletypes.User {
	u, _ := ctx.Value(userCtxKey).(*roletypes.User)
	return u
}

// WithUserForTest seeds a user into the context as if RequireAuth had
// run. Test-only helper — production code paths must go through
// RequireAuth so JWT validation actually happens. Lives in the auth
// package because the ctxKey is unexported.
func WithUserForTest(ctx context.Context, u *roletypes.User) context.Context {
	return context.WithValue(ctx, userCtxKey, u)
}

func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if API key auth was already validated by apikeys middleware
		if apiKeySubID := r.Context().Value("api_key_subscription_id"); apiKeySubID != nil {
			// API key already validated upstream; proceed
			next.ServeHTTP(w, r)
			return
		}

		// Browsers cannot set Authorization headers on the WebSocket
		// upgrade handshake, so we also accept ?access_token=... for
		// the /ws route. Header takes precedence when both are sent.
		authz := r.Header.Get("Authorization")
		var raw string
		if strings.HasPrefix(authz, "Bearer ") {
			raw = strings.TrimPrefix(authz, "Bearer ")
		} else if q := r.URL.Query().Get("access_token"); q != "" {
			raw = q
		} else {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
			return
		}
		claims, err := ParseAccessToken(raw)
		if err != nil {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
			return
		}
		uid, err := uuid.Parse(claims.Subject)
		if err != nil {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
			return
		}
		u, err := s.FindUserByID(r.Context(), uid)
		if err != nil || !u.IsActive {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
			return
		}
		// PLA-0053 / story 00575: populate u.WorkspaceID from the JWT
		// claim. The users table itself has no workspace_id column —
		// the workspace association is per-session, not per-user, and
		// lives on the access token. Legacy tokens (claim absent / "")
		// leave WorkspaceID as uuid.Nil, which WorkspaceClampMiddleware
		// treats as "fall back to FirstLiveWorkspace".
		if claims.WorkspaceID != "" {
			if wsID, perr := uuid.Parse(claims.WorkspaceID); perr == nil {
				u.WorkspaceID = wsID
			}
		}
		ctx := context.WithValue(r.Context(), userCtxKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Service) RequireFreshPassword(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromCtx(r.Context())
		if u != nil && u.ForcePasswordChange {
			httperr.Write(w, r, http.StatusForbidden, usermessages.AuthPasswordChangeRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequirePermission gates a route on the actor having ALL of the given
// permission codes (logical AND). Resolves the actor's effective code
// set via the resolver's process-local cache. Codes are defined in
// internal/permissions/catalogue.go (PLA-0007).
// API key auth (no user context) passes through without permission checks.
func RequirePermission(res *permissions.Resolver, codes ...permissions.Code) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromCtx(r.Context())
			// API key auth: no user context, but api_key_subscription_id is set — pass through
			if u == nil {
				if r.Context().Value("api_key_subscription_id") != nil {
					next.ServeHTTP(w, r)
					return
				}
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			set, err := res.PermissionsFor(r.Context(), u.ID)
			if err != nil {
				httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
				return
			}
			for _, code := range codes {
				if _, ok := set[code]; !ok {
					httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequirePageAccess gates a route on the actor having a users_roles_pages
// grant covering the page identified by keyEnum. PLA-0049 Phase 0.5.
//
// This is the page-level enforcement layer that defends against
// hand-typed URLs and stale bookmarks. Where RequirePermission gates on
// a permission code (e.g. "roles.assign_permissions"), RequirePageAccess
// gates on the actual users_roles_pages grant matrix — the same matrix
// that drives nav-rail visibility. The two layers are complementary:
// permission codes describe capabilities, page access describes which
// pages those capabilities apply to.
//
// API key auth (no user context) passes through without page-access
// checks — API keys are scoped to specific routes by their own
// middleware, not by the page model.
func RequirePageAccess(res *pageaccess.Resolver, keyEnum string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromCtx(r.Context())
			if u == nil {
				if r.Context().Value("api_key_subscription_id") != nil {
					next.ServeHTTP(w, r)
					return
				}
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			ok, err := res.Allowed(r.Context(), u.ID, keyEnum)
			if err != nil {
				httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
				return
			}
			if !ok {
				httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAnyPermission gates a route on the actor having ANY of the
// given permission codes (logical OR). Useful for routes that two
// different roles can hit for different reasons.
func RequireAnyPermission(res *permissions.Resolver, codes ...permissions.Code) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromCtx(r.Context())
			if u == nil {
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			set, err := res.PermissionsFor(r.Context(), u.ID)
			if err != nil {
				httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
				return
			}
			for _, code := range codes {
				if _, ok := set[code]; ok {
					next.ServeHTTP(w, r)
					return
				}
			}
			httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		})
	}
}
