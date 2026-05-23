package apikeys

import (
	"context"
	"log"
	"net/http"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// PLA060 B16.11 — scope enforcement for API-key auth on data-plane routes.
//
// Scopes live on admin_api_keys.admin_api_keys_scopes (text[]) and are
// loaded into KeyInfo.Scopes by Service.ValidateKey. Middleware stashes
// them on the request context via WithScopes; routes opt-in with
// RequireScope(<code>) to demand a specific scope from API-key callers.
//
// HasScope returns true when ANY of the following holds:
//
//   (a) A JWT user is present on the context (auth.UserFromCtx != nil).
//       Scope enforcement is API-key-specific; human users authenticate
//       via JWT + RBAC permissions and are out of scope's threat model.
//   (b) The scopes slice is empty. Back-compat for legacy keys seeded
//       before scope enforcement existed (the dev key + any pre-PLA060
//       live keys, all of which carry '{}'). Tracked as TD-SCOPES-DEFAULT
//       in docs/c_tech_debt.md — flip to "deny" once the issuance UI
//       ships and empty-scopes means "user clicked through" rather than
//       "legacy key."
//   (c) The scopes slice contains the required scope string verbatim.
//       Exact match — no glob, no hierarchy. Keep the vocabulary small.

// Named scopes for the data-plane routes wired in PLA060. Add more here
// when extending coverage to other resources (see TD-SCOPES-COVERAGE).
const (
	ScopeWorkItemsRead       = "work_items:read"
	ScopeWorkItemsWrite      = "work_items:write"
	ScopePortfolioItemsRead  = "portfolio_items:read"
	ScopePortfolioItemsWrite = "portfolio_items:write"
)

type scopesCtxKey struct{}

// WithScopes returns a new context carrying the given API-key scopes.
// Called by Middleware after successful key validation. scopes may be
// empty but is never nil at the storage boundary (we materialise the
// empty case to []string{} so ScopesFromContext can distinguish
// "no scopes granted" from "key auth never ran").
func WithScopes(ctx context.Context, scopes []string) context.Context {
	if scopes == nil {
		scopes = []string{}
	}
	return context.WithValue(ctx, scopesCtxKey{}, scopes)
}

// ScopesFromContext returns the scopes attached to this request, or
// (nil, false) when the request did not authenticate via API key.
func ScopesFromContext(ctx context.Context) ([]string, bool) {
	v, ok := ctx.Value(scopesCtxKey{}).([]string)
	return v, ok
}

// HasScope is the gate every RequireScope wrap calls. See the
// package-level comment for the truth table.
func HasScope(ctx context.Context, required string) bool {
	if auth.UserFromCtx(ctx) != nil {
		return true
	}
	scopes, ok := ScopesFromContext(ctx)
	if !ok {
		// No api-key auth + no JWT user — RequireAuth upstream should
		// have already rejected. Conservative deny if we ever reach here.
		return false
	}
	if len(scopes) == 0 {
		return true // back-compat (TD-SCOPES-DEFAULT)
	}
	for _, s := range scopes {
		if s == required {
			return true
		}
	}
	return false
}

// RequireScope wraps an http.Handler so the request is allowed only
// when HasScope(ctx, required) returns true. Denials emit RFC 9457
// problem+json 403 with code "scope_denied" and a warn-level log line
// carrying key_id + required_scope + granted_scopes for forensics.
func RequireScope(required string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if HasScope(r.Context(), required) {
				next.ServeHTTP(w, r)
				return
			}
			// Identify the key for the audit log line when possible.
			// On JWT requests we never get here (HasScope returns true).
			keyID := GetSubscriptionIDFromContext(r) // best-effort identifier
			scopes, _ := ScopesFromContext(r.Context())
			log.Printf("apikeys.RequireScope DENY: key_subscription=%s required=%s granted=%v",
				keyID, required, scopes)
			httperr.WriteCoded(w, r, http.StatusForbidden, "scope_denied", usermessages.AuthForbidden)
		})
	}
}
