package security

// PLA-0010 / story 00368 — per-user write-rate limit composed atop the
// existing per-IP limiter.
//
// Why this exists: every authenticated route group already runs
// httprate.LimitByIP (typically 120/min). That defends against a single
// noisy IP, but a determined caller behind a NAT or a botnet can fan
// writes across many source IPs while still acting as ONE authenticated
// user. The per-IP limit cannot see that. We add a second limiter keyed
// on auth.UserFromCtx(...).ID so the same user is throttled regardless
// of source IP — defence in depth, not a replacement.
//
// Design choices:
//   - Reads (GET/HEAD/OPTIONS) bypass: list/detail traffic is benign and
//     would otherwise consume the write budget. Writes only.
//   - One bucket per (returned middleware, user). Call the constructor
//     ONCE and reuse the middleware across route groups so a user's
//     cross-surface writes share the quota — that is the whole point.
//     Calling the constructor multiple times produces independent
//     buckets (matching how httprate.LimitByIP is used today, but here
//     the goal is the opposite).
//   - keyFn is injected so this package stays free of an auth import.
//     main.go wires a closure that reads auth.UserFromCtx; anonymous
//     traffic should fall back to an IP-derived key so the bucket still
//     contains pre-auth surface (login already has its own LimitByIP,
//     so this is mostly belt-and-braces).

import (
	"net/http"
	"time"

	"github.com/go-chi/httprate"
)

// LimitByUserOnWrites returns a middleware enforcing a per-key rate
// limit on POST/PUT/PATCH/DELETE while letting GET/HEAD/OPTIONS pass
// through untouched. Compose after RequireAuth so the key function can
// see the authenticated user.
func LimitByUserOnWrites(limit int, window time.Duration, keyFn httprate.KeyFunc) func(http.Handler) http.Handler {
	rl := httprate.Limit(limit, window, httprate.WithKeyFuncs(keyFn))
	return func(next http.Handler) http.Handler {
		wrapped := rl(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			wrapped.ServeHTTP(w, r)
		})
	}
}
