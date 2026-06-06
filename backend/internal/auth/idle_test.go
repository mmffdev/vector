package auth

// A1 — session idle-timeout mechanism (Cause 3).
//
// Root cause being fixed: the middleware idle gate read
// COALESCE(rotated_at, created_at) as "last activity", and
// users_sessions_last_used_at was never written by any Go code — so the
// gate was a ~30-min ABSOLUTE cap that booted actively-working users
// rather than a genuine idle timeout. See plan
// docs/superpowers/plans/2026-06-06-session-idle-timeout.md.
//
// These tests pin the pure idle decision so the gate's contract is
// DB-free and unambiguous: a session is idle-expired iff the time since
// its last genuine activity exceeds the resolved idle TTL. Written
// red-first against a sessionIdleExpired helper that does not yet exist.

import (
	"testing"
	"time"
)

func TestSessionIdleExpired_ActiveSessionNotExpired(t *testing.T) {
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	lastActivity := now.Add(-5 * time.Minute) // active 5 min ago
	idleTTL := 30 * time.Minute

	if sessionIdleExpired(lastActivity, idleTTL, now) {
		t.Errorf("session active %v ago with %v TTL must NOT be idle-expired", now.Sub(lastActivity), idleTTL)
	}
}

func TestSessionIdleExpired_IdlePastTTLExpired(t *testing.T) {
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	lastActivity := now.Add(-31 * time.Minute) // idle just past the cap
	idleTTL := 30 * time.Minute

	if !sessionIdleExpired(lastActivity, idleTTL, now) {
		t.Errorf("session idle %v with %v TTL MUST be idle-expired", now.Sub(lastActivity), idleTTL)
	}
}

func TestSessionIdleExpired_ExactlyAtBoundaryNotExpired(t *testing.T) {
	// At exactly the TTL the session is still alive — expiry is strictly
	// "past" the window, matching the existing `> idleTTL` comparison.
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	lastActivity := now.Add(-30 * time.Minute)
	idleTTL := 30 * time.Minute

	if sessionIdleExpired(lastActivity, idleTTL, now) {
		t.Errorf("session at exactly the TTL boundary must NOT be idle-expired (strict >)")
	}
}
