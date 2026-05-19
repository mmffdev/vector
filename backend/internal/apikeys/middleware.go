package apikeys

import (
	"context"
	"net/http"
	"strings"

	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// CtxKeySubscriptionID is the context key for the validated subscription ID from an API key.
const CtxKeySubscriptionID = "api_key_subscription_id"

// UserSynth resolves an api-key's subscription to a synthetic User
// that downstream handlers can read via auth.UserFromCtx(). Used on
// transports (today: /_site) where handlers do permission checks +
// audit attribution against a full User, not just a subscription.
//
// Implementations should pick a deterministic, stable user on the
// subscription (e.g. the highest-tier active account). The returned
// context value is set under auth's internal user key — call
// auth.WithUserForServiceAuth(ctx, user) to write it correctly
// without touching auth's unexported ctxKey.
type UserSynth func(ctx context.Context, subscriptionID string) (*roletypes.User, context.Context, error)

// Middleware validates API key Bearer tokens and sets subscription_id
// in context. If no API key is provided, falls through to JWT auth
// (which is checked upstream). If an invalid API key is provided,
// returns 401.
//
// When userSynth is non-nil, the middleware ALSO resolves the
// subscription to a synthetic User and seeds it on the context via
// the caller-provided ctx-builder (typically
// auth.WithUserForServiceAuth). Used on /_site where downstream
// handlers expect a User. Pass nil on transports that only need the
// subscription_id (today: /samantha/v2).
func Middleware(svc *Service, userSynth UserSynth) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				// No API key; JWT middleware will handle auth upstream
				next.ServeHTTP(w, r)
				return
			}

			rawKey := strings.TrimPrefix(authHeader, "Bearer ")

			// Only validate if it looks like an API key (sam_live_ prefix)
			if !strings.HasPrefix(rawKey, "sam_live_") {
				// JWT token, fall through to JWT auth middleware
				next.ServeHTTP(w, r)
				return
			}

			// Validate the API key
			info, err := svc.ValidateKey(r.Context(), rawKey)
			if err != nil {
				// Invalid/expired/revoked key
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}

			// Set subscription_id in context for downstream handlers
			ctx := context.WithValue(r.Context(), CtxKeySubscriptionID, info.SubscriptionID)

			// If the caller provided a UserSynth, resolve a synthetic
			// User and stash it on the context. /_site handlers read
			// auth.UserFromCtx() to drive permission gating + audit
			// attribution; without this they'd see nil and 401 even
			// after the api-key check passed.
			if userSynth != nil {
				_, ctxWithUser, synthErr := userSynth(ctx, info.SubscriptionID)
				if synthErr != nil {
					// No active user on this subscription — the api-key
					// is orphaned. 401 (same shape as an expired token)
					// rather than 500: from the caller's perspective
					// the key didn't authenticate them to a real actor.
					httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
					return
				}
				ctx = ctxWithUser
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetSubscriptionIDFromContext extracts the validated subscription_id from an API key.
// Returns "" if not set (JWT auth was used instead).
func GetSubscriptionIDFromContext(r *http.Request) string {
	val := r.Context().Value(CtxKeySubscriptionID)
	if val == nil {
		return ""
	}
	return val.(string)
}
