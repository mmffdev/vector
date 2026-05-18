package realtime_test

// B16.8.12 — WS session registry contract.
//
// The registry is the in-memory mapping of users_sessions_id → close hook
// the sweeper and the future B16.8.10 revoke endpoint act on. These
// tests pin the surface independent of any WebSocket / DB plumbing:
//
//   1. Register + Lookup round-trips.
//   2. Deregister removes the entry.
//   3. CloseSession fires the close hook synchronously and deregisters.
//   4. Duplicate sid on a fresh Register closes the prior connection
//      and replaces the hook — a fresh login while an old socket is
//      still alive does not leave two live entries under one sid.

import (
	"sync"
	"sync/atomic"
	"testing"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/realtime"
)

func TestSessionRegistry_RegisterLookupRoundTrips(t *testing.T) {
	reg := realtime.NewSessionRegistry()
	sid := uuid.New()
	uid := uuid.New()
	reg.Register(sid, uid, func(code websocket.StatusCode, reason string) {})

	got := reg.SnapshotSIDs()
	if len(got) != 1 || got[0] != sid {
		t.Fatalf("SnapshotSIDs = %v, want [%s]", got, sid)
	}
}

func TestSessionRegistry_DeregisterRemovesEntry(t *testing.T) {
	reg := realtime.NewSessionRegistry()
	sid := uuid.New()
	reg.Register(sid, uuid.New(), func(code websocket.StatusCode, reason string) {})
	reg.Deregister(sid)

	if got := reg.SnapshotSIDs(); len(got) != 0 {
		t.Fatalf("SnapshotSIDs after Deregister = %v, want []", got)
	}
}

func TestSessionRegistry_CloseSessionFiresHookAndDeregisters(t *testing.T) {
	reg := realtime.NewSessionRegistry()
	sid := uuid.New()

	var gotCode atomic.Int32
	var gotReason atomic.Value
	gotReason.Store("")

	reg.Register(sid, uuid.New(), func(code websocket.StatusCode, reason string) {
		gotCode.Store(int32(code))
		gotReason.Store(reason)
	})

	reg.CloseSession(sid, 4001, "session terminated")

	if got := gotCode.Load(); got != 4001 {
		t.Fatalf("close hook code = %d, want 4001", got)
	}
	if got := gotReason.Load().(string); got != "session terminated" {
		t.Fatalf("close hook reason = %q, want %q", got, "session terminated")
	}
	if sids := reg.SnapshotSIDs(); len(sids) != 0 {
		t.Fatalf("registry should be empty after CloseSession, got %v", sids)
	}
}

func TestSessionRegistry_DuplicateSIDReplacesAndClosesPrior(t *testing.T) {
	reg := realtime.NewSessionRegistry()
	sid := uuid.New()
	uid := uuid.New()

	var (
		mu          sync.Mutex
		priorClosed bool
		priorCode   websocket.StatusCode
	)
	reg.Register(sid, uid, func(code websocket.StatusCode, reason string) {
		mu.Lock()
		defer mu.Unlock()
		priorClosed = true
		priorCode = code
	})

	// Same sid, different close hook — must close the prior connection
	// and replace.
	freshFired := atomic.Bool{}
	reg.Register(sid, uid, func(code websocket.StatusCode, reason string) {
		freshFired.Store(true)
	})

	mu.Lock()
	pc, pcode := priorClosed, priorCode
	mu.Unlock()
	if !pc {
		t.Fatalf("duplicate Register did not close the prior hook")
	}
	if pcode != websocket.StatusPolicyViolation {
		t.Fatalf("prior close code = %d, want StatusPolicyViolation (1008) — duplicate-sid eviction uses the policy-violation code so the existing reconnect path treats it as transient", pcode)
	}

	// Closing the sid now must fire the *fresh* hook, not the prior one.
	reg.CloseSession(sid, 4001, "session terminated")
	if !freshFired.Load() {
		t.Fatalf("fresh hook did not fire on CloseSession after replacement")
	}
}

func TestSessionRegistry_CloseSessionUnknownSIDIsNoOp(t *testing.T) {
	reg := realtime.NewSessionRegistry()
	// Must not panic.
	reg.CloseSession(uuid.New(), 4001, "session terminated")
}
