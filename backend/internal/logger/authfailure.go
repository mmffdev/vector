package logger

import (
	"context"
	"net/http"
)

// AuthFailureKind labels why a request failed authentication. Recorded
// on the request context by the auth middleware before it writes 401,
// then read by HTTPLogger to choose between info and warn.
//
// The distinction matters for the SOC 2 / defence-tier audit trail:
//   - NoCredential is "someone opened a tab without logging in" or "the
//     EventSource reconnected after sign-out" — boring, high-volume,
//     not a security signal.
//   - InvalidCredential is "someone presented a credential that failed
//     validation" — expired, bad signature, revoked session, DPoP
//     mismatch. That IS a security signal and stays at warn so it
//     shows up in alerting + procurement evidence.
type AuthFailureKind string

const (
	AuthFailureNoCredential      AuthFailureKind = "none"
	AuthFailureInvalidCredential AuthFailureKind = "invalid"
)

// authFailureCarrier is a mutable slot stashed in the request context
// by HTTPLogger at the top of the middleware chain. Downstream
// middleware (auth) mutates the slot via RecordAuthFailure; HTTPLogger
// reads the slot after next.ServeHTTP returns. We need a carrier
// rather than context.WithValue here because middleware lower in the
// chain doesn't get to propagate a new context back up — HTTPLogger
// sees only the context that existed when it called next.ServeHTTP.
type authFailureCarrier struct {
	Set    bool
	Kind   AuthFailureKind
	Reason string
}

type authFailureCtxKey struct{}

// withAuthFailureCarrier seeds an empty carrier on ctx. Called by
// HTTPLogger before delegating to next.ServeHTTP so downstream code
// has somewhere to record into. Unexported — HTTPLogger is the sole
// caller.
func withAuthFailureCarrier(ctx context.Context) (context.Context, *authFailureCarrier) {
	c := &authFailureCarrier{}
	return context.WithValue(ctx, authFailureCtxKey{}, c), c
}

// RecordAuthFailure stamps the failure kind + reason into the carrier
// that HTTPLogger seeded on the request context. Safe to call when no
// carrier is present (e.g. handler invoked outside the middleware
// chain in a test) — it becomes a no-op.
//
// Reason is a short machine-readable label like "expired",
// "bad_signature", "session_revoked". Empty for AuthFailureNoCredential
// since there is nothing to differentiate.
func RecordAuthFailure(r *http.Request, kind AuthFailureKind, reason string) {
	c, ok := r.Context().Value(authFailureCtxKey{}).(*authFailureCarrier)
	if !ok {
		return
	}
	c.Set = true
	c.Kind = kind
	c.Reason = reason
}

// authFailureFromCtx returns the carrier's last recorded state. ok is
// false when nothing was recorded — keeps non-auth 4xx (404, 422) on
// their existing warn level.
func authFailureFromCtx(ctx context.Context) (kind AuthFailureKind, reason string, ok bool) {
	c, present := ctx.Value(authFailureCtxKey{}).(*authFailureCarrier)
	if !present || !c.Set {
		return "", "", false
	}
	return c.Kind, c.Reason, true
}
