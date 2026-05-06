package apikeys

import (
	"context"
	"net/http"
	"strings"

	"github.com/mmffdev/vector-backend/internal/httperr"
)

// CtxKeySubscriptionID is the context key for the validated subscription ID from an API key.
const CtxKeySubscriptionID = "api_key_subscription_id"

// Middleware validates API key Bearer tokens and sets subscription_id in context.
// If no API key is provided, falls through to JWT auth (which is checked upstream).
// If an invalid API key is provided, returns 401.
func Middleware(svc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				// No API key; JWT middleware will handle auth upstream
				next.ServeHTTP(w, r)
				return
			}

			rawKey := strings.TrimPrefix(authHeader, "Bearer ")

			// Validate the key
			info, err := svc.ValidateKey(r.Context(), rawKey)
			if err != nil {
				// Invalid/expired/revoked key
				httperr.Write(w, r, http.StatusUnauthorized, "invalid or expired API key")
				return
			}

			// Set subscription_id in context for downstream handlers
			ctx := context.WithValue(r.Context(), CtxKeySubscriptionID, info.SubscriptionID)
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
