package realtime

// Closes the production gap from review of B16.8.12: the second Close
// call against a coder/websocket *Conn queues a new close frame that
// can race the first frame's network flush, so a deferred
// `conn.Close(StatusNormalClosure, "")` running after an explicit
// closeFn(4001) may overwrite the wire-observable close code under
// load. closeOnce gates the underlying Close so only the first call
// reaches the conn. Tests pin that contract.

import (
	"sync"
	"testing"

	"github.com/coder/websocket"
)

// recordingCloser counts Close calls and remembers the args of every
// invocation so the test can prove only the first reached it.
type recordingCloser struct {
	mu    sync.Mutex
	calls []recordedClose
}

type recordedClose struct {
	code   websocket.StatusCode
	reason string
}

func (r *recordingCloser) Close(code websocket.StatusCode, reason string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, recordedClose{code: code, reason: reason})
	return nil
}

func (r *recordingCloser) snapshot() []recordedClose {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]recordedClose, len(r.calls))
	copy(out, r.calls)
	return out
}

// TestCloseOnce_FirstCallWins is the canonical case: an explicit
// close with code 4001 fires, then the deferred fallback runs with
// StatusNormalClosure. The recording closer must see exactly one
// invocation — the 4001 — proving the deferred path was suppressed.
func TestCloseOnce_FirstCallWins(t *testing.T) {
	rec := &recordingCloser{}
	gate := newCloseOnce(rec)

	if err := gate.Close(4001, "session terminated"); err != nil {
		t.Fatalf("first Close returned error: %v", err)
	}
	if err := gate.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatalf("second Close returned error: %v", err)
	}

	calls := rec.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected exactly 1 Close to reach the conn, got %d: %+v", len(calls), calls)
	}
	if calls[0].code != 4001 {
		t.Errorf("winning close code = %d, want 4001", calls[0].code)
	}
	if calls[0].reason != "session terminated" {
		t.Errorf("winning close reason = %q, want %q", calls[0].reason, "session terminated")
	}
}

// TestCloseOnce_ReverseOrder pins that a deferred fallback firing
// first (because no immediate-close hook ran) still wins, and a
// later 4001 cannot retroactively change the wire frame. This is
// the no-bug case — the test exists so anyone refactoring the gate
// doesn't inadvertently invert its contract.
func TestCloseOnce_ReverseOrder(t *testing.T) {
	rec := &recordingCloser{}
	gate := newCloseOnce(rec)

	_ = gate.Close(websocket.StatusNormalClosure, "")
	_ = gate.Close(4001, "session terminated")

	calls := rec.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected exactly 1 Close, got %d", len(calls))
	}
	if calls[0].code != websocket.StatusNormalClosure {
		t.Errorf("winning code = %d, want StatusNormalClosure", calls[0].code)
	}
}

// TestCloseOnce_ConcurrentCallers proves the atomic gate handles a
// race between the immediate-close goroutine (fired by
// hub.CloseSession from an HTTP handler) and the deferred fallback
// goroutine (the ServeWS exit path). Only one Close reaches the conn
// no matter how the scheduler interleaves them.
func TestCloseOnce_ConcurrentCallers(t *testing.T) {
	rec := &recordingCloser{}
	gate := newCloseOnce(rec)

	const goroutines = 32
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(i int) {
			defer wg.Done()
			gate.Close(websocket.StatusCode(4000+i), "racer")
		}(i)
	}
	wg.Wait()

	calls := rec.snapshot()
	if len(calls) != 1 {
		t.Fatalf("concurrent contention let %d Close calls through; want exactly 1", len(calls))
	}
}
