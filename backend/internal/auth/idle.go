package auth

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// sessionIdleExpired is the pure idle-timeout decision used by the
// RequireAuth gate. A session is idle-expired iff the elapsed time since
// its last GENUINE activity (users_sessions_last_used_at) exceeds the
// resolved idle TTL. Strict `>` — a session sitting at exactly the TTL
// is still alive (matches the historical comparison shape).
//
// Extracted as a pure function so the gate's contract is unit-testable
// without a DB: the middleware resolves lastActivity from the session
// row and idleTTL from config, then defers the decision to here. See
// A1 in docs/superpowers/plans/2026-06-06-session-idle-timeout.md.
func sessionIdleExpired(lastActivity time.Time, idleTTL time.Duration, now time.Time) bool {
	return now.Sub(lastActivity) > idleTTL
}

// touchSessionActivity advances users_sessions_last_used_at for the given
// session, throttled to ~1 write/min by sqlTouchSessionActivity's own
// WHERE clause. FIRE-AND-FORGET by design: a failed activity write must
// never turn a good authenticated request into a 401, so the error is
// intentionally discarded. Guards against a nil Pool (DB-free middleware
// unit tests) and a Nil session id (legacy/grace-window tokens with no
// sid claim, which never reach the sid branch but are cheap to defend).
func (s *Service) touchSessionActivity(ctx context.Context, sid uuid.UUID) {
	if s.Pool == nil || sid == uuid.Nil {
		return
	}
	_, _ = s.Pool.Exec(ctx, sqlTouchSessionActivity, sid)
}
