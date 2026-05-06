package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

type ctxKey string

const userCtxKey ctxKey = "user"

func UserFromCtx(ctx context.Context) *models.User {
	u, _ := ctx.Value(userCtxKey).(*models.User)
	return u
}

// WithUserForTest seeds a user into the context as if RequireAuth had
// run. Test-only helper — production code paths must go through
// RequireAuth so JWT validation actually happens. Lives in the auth
// package because the ctxKey is unexported.
func WithUserForTest(ctx context.Context, u *models.User) context.Context {
	return context.WithValue(ctx, userCtxKey, u)
}

func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
			httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
			return
		}
		claims, err := ParseAccessToken(raw)
		if err != nil {
			httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
			return
		}
		uid, err := uuid.Parse(claims.Subject)
		if err != nil {
			httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
			return
		}
		u, err := s.FindUserByID(r.Context(), uid)
		if err != nil || !u.IsActive {
			httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Service) RequireFreshPassword(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromCtx(r.Context())
		if u != nil && u.ForcePasswordChange {
			httperr.Write(w, r, http.StatusForbidden, messages.AuthPasswordChangeRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequirePermission gates a route on the actor having ALL of the given
// permission codes (logical AND). Resolves the actor's effective code
// set via the resolver's process-local cache. Codes are defined in
// internal/permissions/catalogue.go (PLA-0007).
func RequirePermission(res *permissions.Resolver, codes ...permissions.Code) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromCtx(r.Context())
			if u == nil {
				httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
				return
			}
			set, err := res.PermissionsFor(r.Context(), u.ID)
			if err != nil {
				httperr.Write(w, r, http.StatusForbidden, messages.AuthForbidden)
				return
			}
			for _, code := range codes {
				if _, ok := set[code]; !ok {
					httperr.Write(w, r, http.StatusForbidden, messages.AuthForbidden)
					return
				}
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
				httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
				return
			}
			set, err := res.PermissionsFor(r.Context(), u.ID)
			if err != nil {
				httperr.Write(w, r, http.StatusForbidden, messages.AuthForbidden)
				return
			}
			for _, code := range codes {
				if _, ok := set[code]; ok {
					next.ServeHTTP(w, r)
					return
				}
			}
			httperr.Write(w, r, http.StatusForbidden, messages.AuthForbidden)
		})
	}
}
