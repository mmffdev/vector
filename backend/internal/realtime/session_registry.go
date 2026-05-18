package realtime

// B16.8.12 — WebSocket session registry.
//
// Foundation already shipped in B16.8.11: every access JWT carries a
// `sid` claim equal to the users_sessions row that issued it. The HTTP
// path re-checks that row on every request (RequireAuth →
// FindUserBySessionID). A WebSocket only runs RequireAuth once at
// upgrade, so without a server-side ticker an open socket keeps serving
// its frozen auth context forever — instant revocation from the HTTP
// surface never reaches an active WS.
//
// The registry is the in-memory side of the fix: every successful WS
// upgrade registers {sid, user_id, close_fn}. The sweeper (see
// session_sweeper.go) batch-queries users_sessions every
// WS_SESSION_CHECK_INTERVAL and fires close_fn on rows that are
// revoked or idle past SESSION_IDLE_TTL. The future B16.8.10 revoke
// endpoint calls CloseSession synchronously for instant teardown
// instead of waiting up to the sweep interval.

import (
	"sync"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// SessionRegistry maps live WebSocket sessions to their close hooks.
// Keyed by users_sessions_id because revocation acts on the session row,
// not the connection identity.
type SessionRegistry struct {
	mu      sync.Mutex
	entries map[uuid.UUID]*sessionEntry
}

type sessionEntry struct {
	userID uuid.UUID
	close  func(code websocket.StatusCode, reason string)
}

// NewSessionRegistry returns an empty registry. Safe for concurrent use.
func NewSessionRegistry() *SessionRegistry {
	return &SessionRegistry{entries: map[uuid.UUID]*sessionEntry{}}
}

// Register binds sid to closeFn. If sid is already registered (a fresh
// login while an old socket is still alive), the prior close hook is
// invoked with StatusPolicyViolation before being replaced. The
// duplicate-sid path uses a *transient* close code, not 4001/4002, so
// the frontend's existing reconnect-on-1008 path takes over instead of
// triggering hardLogout — the user is still validly signed in under the
// fresh login, only the stale connection needs to go.
func (r *SessionRegistry) Register(sid, userID uuid.UUID, closeFn func(code websocket.StatusCode, reason string)) {
	r.mu.Lock()
	prior, dup := r.entries[sid]
	r.entries[sid] = &sessionEntry{userID: userID, close: closeFn}
	r.mu.Unlock()

	if dup && prior != nil {
		prior.close(websocket.StatusPolicyViolation, "session re-bound to a new connection")
	}
}

// Deregister removes sid from the registry. Called when the WS
// disconnects on its own (client close, network drop, ping timeout).
// Idempotent.
func (r *SessionRegistry) Deregister(sid uuid.UUID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.entries, sid)
}

// CloseSession fires the close hook for sid (if registered) and
// deregisters synchronously. The future B16.8.10 revoke endpoint calls
// this immediately after the SQL UPDATE commits so the user does not
// have to wait up to WS_SESSION_CHECK_INTERVAL for the sweeper to
// notice. No-op for unknown sids — a revoke racing a natural
// disconnect should not panic.
func (r *SessionRegistry) CloseSession(sid uuid.UUID, code websocket.StatusCode, reason string) {
	r.mu.Lock()
	entry, ok := r.entries[sid]
	if ok {
		delete(r.entries, sid)
	}
	r.mu.Unlock()
	if ok {
		entry.close(code, reason)
	}
}

// SnapshotSIDs returns the live sid set as a slice. Used by the sweeper
// to build the batch SELECT input under-lock, then released so the SQL
// roundtrip does not block Register/Deregister.
func (r *SessionRegistry) SnapshotSIDs() []uuid.UUID {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]uuid.UUID, 0, len(r.entries))
	for sid := range r.entries {
		out = append(out, sid)
	}
	return out
}
