package realtime

// closeOnce wraps a coder/websocket *Conn so that the first call to
// Close wins and every subsequent call is a no-op. Closes the
// production gap exposed by review of B16.8.12 (commit chain
// d32ebd9..9ac876f): ServeWS registers two close paths against the
// same *Conn — the immediate-close hook fires explicitly with
// code 4001 / 4002, and a `defer conn.Close(StatusNormalClosure, "")`
// runs unconditionally on goroutine exit. coder/websocket's Close is
// documented as safe to invoke twice, but the second call queues a
// new close frame that can race the first frame's network flush:
// under any non-trivial latency the client may observe code 1000
// (normal closure) instead of 4001, and the frontend wsClose handler
// then never triggers hardLogout. The httptest server in the
// integration tests has effectively-zero network delay, which is why
// the existing tests pass deterministically while production is a
// coin flip.
//
// closeOnce uses an atomic flag to gate the underlying Close so the
// first writer of a close frame wins, period. The deferred fallback
// becomes a true cleanup-on-leak path rather than a competing close
// emitter.

import (
	"sync/atomic"

	"github.com/coder/websocket"
)

// wsCloser is the subset of *websocket.Conn we need. Allows the test
// to substitute a recorder without dragging in a real conn.
type wsCloser interface {
	Close(code websocket.StatusCode, reason string) error
}

// closeOnce gates a wsCloser so only the first Close call reaches the
// wire. Zero value is ready for use; safe for concurrent callers.
type closeOnce struct {
	conn wsCloser
	done atomic.Bool
}

// newCloseOnce binds conn to a closeOnce gate.
func newCloseOnce(conn wsCloser) *closeOnce {
	return &closeOnce{conn: conn}
}

// Close emits a close frame to the underlying conn on its first call
// and is a no-op on every subsequent call. Returns the underlying
// Close's error on the winning call; returns nil on losing calls.
func (c *closeOnce) Close(code websocket.StatusCode, reason string) error {
	if !c.done.CompareAndSwap(false, true) {
		return nil
	}
	return c.conn.Close(code, reason)
}
