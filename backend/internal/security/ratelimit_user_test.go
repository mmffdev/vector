package security_test

// PLA-0010 / story 00368 — proves the per-user write limiter:
//   - writes exceeding the cap return 429
//   - GET/HEAD/OPTIONS pass through regardless of the cap
//   - the same user from two different source IPs is still throttled
//     (the whole point of layering this on top of LimitByIP)
//   - two different users from the same source IP have independent
//     buckets (no cross-user collateral damage)

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mmffdev/vector-backend/internal/security"
)

const userHeader = "X-Test-User"

// keyByTestHeader stands in for the production keyFn (which reads
// auth.UserFromCtx). The test injects the user identity through a
// header so we can drive the limiter without standing up the auth
// stack.
func keyByTestHeader(r *http.Request) (string, error) {
	u := r.Header.Get(userHeader)
	if u == "" {
		return "anon:" + r.RemoteAddr, nil
	}
	return "user:" + u, nil
}

func newLimitedHandler(t *testing.T, limit int) http.Handler {
	t.Helper()
	mw := security.LimitByUserOnWrites(limit, time.Minute, keyByTestHeader)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	return mw(next)
}

func doReq(t *testing.T, h http.Handler, method, user, remote string) int {
	t.Helper()
	r := httptest.NewRequest(method, "/x", strings.NewReader(""))
	if user != "" {
		r.Header.Set(userHeader, user)
	}
	if remote != "" {
		r.RemoteAddr = remote
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code
}

func TestLimitByUserOnWrites_WriteExceedsLimit_429(t *testing.T) {
	h := newLimitedHandler(t, 3)
	for i := 0; i < 3; i++ {
		if got := doReq(t, h, http.MethodPost, "alice", "1.1.1.1:1"); got != http.StatusOK {
			t.Fatalf("write %d: expected 200, got %d", i, got)
		}
	}
	if got := doReq(t, h, http.MethodPost, "alice", "1.1.1.1:1"); got != http.StatusTooManyRequests {
		t.Fatalf("expected 429 on 4th write, got %d", got)
	}
}

func TestLimitByUserOnWrites_GET_Unaffected(t *testing.T) {
	h := newLimitedHandler(t, 3)
	// Burn the write budget first so the bucket is empty.
	for i := 0; i < 3; i++ {
		_ = doReq(t, h, http.MethodPost, "alice", "1.1.1.1:1")
	}
	// GETs must still pass — many of them in a row.
	for i := 0; i < 50; i++ {
		if got := doReq(t, h, http.MethodGet, "alice", "1.1.1.1:1"); got != http.StatusOK {
			t.Fatalf("GET %d should bypass write limit, got %d", i, got)
		}
	}
}

func TestLimitByUserOnWrites_TwoIPsSameUser_StillThrottled(t *testing.T) {
	h := newLimitedHandler(t, 3)
	// Three writes split across two source IPs, same user — bucket
	// should fill regardless of IP rotation.
	if got := doReq(t, h, http.MethodPost, "alice", "1.1.1.1:1"); got != http.StatusOK {
		t.Fatalf("write 1: expected 200, got %d", got)
	}
	if got := doReq(t, h, http.MethodPost, "alice", "2.2.2.2:1"); got != http.StatusOK {
		t.Fatalf("write 2 from second IP: expected 200, got %d", got)
	}
	if got := doReq(t, h, http.MethodPost, "alice", "3.3.3.3:1"); got != http.StatusOK {
		t.Fatalf("write 3 from third IP: expected 200, got %d", got)
	}
	if got := doReq(t, h, http.MethodPost, "alice", "4.4.4.4:1"); got != http.StatusTooManyRequests {
		t.Fatalf("expected 429 on 4th write across rotated IPs, got %d", got)
	}
}

func TestLimitByUserOnWrites_TwoUsersSameIP_Independent(t *testing.T) {
	h := newLimitedHandler(t, 3)
	for i := 0; i < 3; i++ {
		if got := doReq(t, h, http.MethodPost, "alice", "1.1.1.1:1"); got != http.StatusOK {
			t.Fatalf("alice write %d: expected 200, got %d", i, got)
		}
	}
	// alice exhausted; bob from the same IP must be unaffected.
	for i := 0; i < 3; i++ {
		if got := doReq(t, h, http.MethodPost, "bob", "1.1.1.1:1"); got != http.StatusOK {
			t.Fatalf("bob write %d should be independent, got %d", i, got)
		}
	}
	if got := doReq(t, h, http.MethodPost, "alice", "1.1.1.1:1"); got != http.StatusTooManyRequests {
		t.Fatalf("alice 4th write should still be 429, got %d", got)
	}
	if got := doReq(t, h, http.MethodPost, "bob", "1.1.1.1:1"); got != http.StatusTooManyRequests {
		t.Fatalf("bob 4th write should be 429, got %d", got)
	}
}
