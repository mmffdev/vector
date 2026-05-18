package alerting

// B16.8 P5 — audit-event alerting tests.
//
// Pinned behaviours:
//   1. Empty URL or empty allowlist → disabled (no-op).
//   2. Action not on the allowlist → no POST.
//   3. Action on the allowlist → POST with the right wire-format
//      payload and X-Vector-Signature when AUDIT_ALERT_SECRET is set.
//   4. Network error / non-2xx → silently dropped, never propagates.
//   5. Verify(secret, body, sig) matches what sign() produces.
//   6. The alerter never invokes itself (no infinite loop) — this is
//      structural (Webhook has no Log path back into itself), so the
//      test is by inspection rather than runtime.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/audit"
)

func setEnv(t *testing.T, url, actions, secret string) {
	t.Helper()
	t.Setenv("AUDIT_ALERT_WEBHOOK_URL", url)
	t.Setenv("AUDIT_ALERT_ACTIONS", actions)
	t.Setenv("AUDIT_ALERT_SECRET", secret)
}

// captureServer stands up a tiny HTTP receiver. It records every
// inbound request body + signature header and signals via the
// returned channel whenever a POST lands.
type captured struct {
	body []byte
	sig  string
}

func captureServer(t *testing.T, status int) (*httptest.Server, <-chan captured) {
	t.Helper()
	// Generous buffer — the race-safety test fires 20 concurrent POSTs;
	// a small buffer would deadlock the receiver handler and look like a
	// network timeout from the client side.
	ch := make(chan captured, 64)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		select {
		case ch <- captured{body: body, sig: r.Header.Get("X-Vector-Signature")}:
		default:
			// Channel full — drop. The test doesn't assert on every
			// request body in the race test, only that nothing panics
			// or races. Drop-on-full keeps the handler from blocking.
		}
		w.WriteHeader(status)
	}))
	return srv, ch
}

func TestNewWebhook_DisabledWhenURLEmpty(t *testing.T) {
	setEnv(t, "", "auth.account_locked", "")
	w := NewWebhook()
	if !w.disabled {
		t.Fatalf("want disabled on empty URL")
	}
}

func TestNewWebhook_DisabledWhenActionsEmpty(t *testing.T) {
	setEnv(t, "http://example/", "", "")
	w := NewWebhook()
	if !w.disabled {
		t.Fatalf("want disabled on empty actions")
	}
}

func TestNewWebhook_DisabledWhenActionsAreOnlyCommas(t *testing.T) {
	// "," parses to two empty entries which the loop skips, leaving
	// the actions map empty — should treat as disabled.
	setEnv(t, "http://example/", ", ,", "")
	w := NewWebhook()
	if !w.disabled {
		t.Fatalf("want disabled when allowlist is whitespace-only")
	}
}

func TestNewWebhook_EnabledWithBothSet(t *testing.T) {
	setEnv(t, "http://example/", "auth.account_locked,auth.refresh_token_reuse", "shh")
	w := NewWebhook()
	if w.disabled {
		t.Fatalf("want enabled when both URL and allowlist are set")
	}
	if _, ok := w.actions["auth.account_locked"]; !ok {
		t.Fatalf("missing first action in allowlist")
	}
	if _, ok := w.actions["auth.refresh_token_reuse"]; !ok {
		t.Fatalf("missing second action in allowlist")
	}
	if string(w.secret) != "shh" {
		t.Fatalf("secret not captured")
	}
}

// waitForOne pulls one message off the channel with a short timeout.
// Used because SendIfAllowed dispatches its POST on a goroutine.
func waitForOne(t *testing.T, ch <-chan captured) captured {
	t.Helper()
	select {
	case c := <-ch:
		return c
	case <-time.After(2 * time.Second):
		t.Fatalf("no POST received within timeout")
		return captured{}
	}
}

func TestSendIfAllowed_ActionOnAllowlist_PostsSignedPayload(t *testing.T) {
	srv, ch := captureServer(t, http.StatusNoContent)
	defer srv.Close()
	setEnv(t, srv.URL, "auth.account_locked", "secret-key")
	w := NewWebhook()

	uid := uuid.New()
	sid := uuid.New()
	ip := "192.0.2.1"
	w.SendIfAllowed("auth.account_locked", audit.AlertEvent{
		Event:          "audit.alert",
		Timestamp:      "2026-05-18T12:00:00Z",
		Action:         "auth.account_locked",
		UserID:         &uid,
		SubscriptionID: &sid,
		IPAddress:      &ip,
		Metadata:       map[string]any{"reason": "too_many_attempts"},
	})

	got := waitForOne(t, ch)

	var payload wirePayload
	if err := json.Unmarshal(got.body, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if payload.Action != "auth.account_locked" {
		t.Errorf("action: want auth.account_locked, got %q", payload.Action)
	}
	if payload.Event != "audit.alert" {
		t.Errorf("event: want audit.alert, got %q", payload.Event)
	}
	if payload.UserID == nil || *payload.UserID != uid.String() {
		t.Errorf("user_id mismatch: %+v vs %s", payload.UserID, uid)
	}
	if payload.SubscriptionID == nil || *payload.SubscriptionID != sid.String() {
		t.Errorf("subscription_id mismatch")
	}
	if payload.IPAddress == nil || *payload.IPAddress != ip {
		t.Errorf("ip mismatch")
	}
	if payload.Metadata["reason"] != "too_many_attempts" {
		t.Errorf("metadata not propagated")
	}

	if got.sig == "" {
		t.Fatalf("X-Vector-Signature header missing")
	}
	if !Verify([]byte("secret-key"), got.body, got.sig) {
		t.Fatalf("signature failed to verify")
	}
}

func TestSendIfAllowed_ActionOffAllowlist_NoPost(t *testing.T) {
	srv, ch := captureServer(t, http.StatusOK)
	defer srv.Close()
	setEnv(t, srv.URL, "auth.account_locked", "")
	w := NewWebhook()

	w.SendIfAllowed("auth.login", audit.AlertEvent{Action: "auth.login"})

	// Give the (would-be) goroutine time to fire if it were going to.
	select {
	case <-ch:
		t.Fatalf("non-allowlisted action triggered a POST")
	case <-time.After(200 * time.Millisecond):
		// Expected — no POST.
	}
}

func TestSendIfAllowed_NoSignatureWhenSecretUnset(t *testing.T) {
	srv, ch := captureServer(t, http.StatusOK)
	defer srv.Close()
	setEnv(t, srv.URL, "auth.account_locked", "")
	w := NewWebhook()

	w.SendIfAllowed("auth.account_locked", audit.AlertEvent{Action: "auth.account_locked"})
	got := waitForOne(t, ch)
	if got.sig != "" {
		t.Fatalf("unexpected X-Vector-Signature when secret is unset: %q", got.sig)
	}
}

func TestSendIfAllowed_NilReceiverIsNoOp(t *testing.T) {
	var w *Webhook // nil
	// Must not panic.
	w.SendIfAllowed("auth.account_locked", audit.AlertEvent{Action: "auth.account_locked"})
}

func TestSendIfAllowed_FailsOpenOnNon2xx(t *testing.T) {
	// Server returns 500 — the alerter must log and move on, NOT panic
	// or otherwise propagate. We can't observe the log line easily in
	// a unit test, but we can confirm that calling SendIfAllowed
	// completes without panic and a subsequent call still works.
	srv, ch := captureServer(t, http.StatusInternalServerError)
	defer srv.Close()
	setEnv(t, srv.URL, "auth.account_locked", "")
	w := NewWebhook()

	w.SendIfAllowed("auth.account_locked", audit.AlertEvent{Action: "auth.account_locked"})
	waitForOne(t, ch) // confirms the POST went out

	// Second call should also fire — alerter is stateless and a
	// previous failure doesn't disable it.
	w.SendIfAllowed("auth.account_locked", audit.AlertEvent{Action: "auth.account_locked"})
	waitForOne(t, ch)
}

func TestSendIfAllowed_FailsOpenOnUnreachableHost(t *testing.T) {
	// Point at a port that refuses connections. The Do() call should
	// error, the goroutine logs it, the caller is undisturbed.
	setEnv(t, "http://127.0.0.1:1/alerts", "auth.account_locked", "")
	w := NewWebhook()
	w.client.Timeout = 100 * time.Millisecond

	done := make(chan struct{})
	go func() {
		w.SendIfAllowed("auth.account_locked", audit.AlertEvent{Action: "auth.account_locked"})
		close(done)
	}()
	select {
	case <-done:
		// caller path completed; the inner goroutine eats the error
	case <-time.After(2 * time.Second):
		t.Fatalf("SendIfAllowed blocked the caller on unreachable host")
	}
}

func TestVerify_ConstantTimeMatch(t *testing.T) {
	body := []byte(`{"event":"audit.alert","action":"auth.account_locked"}`)
	sig := sign([]byte("k"), body)
	if !Verify([]byte("k"), body, sig) {
		t.Fatalf("Verify should accept a fresh signature")
	}
	if Verify([]byte("k"), body, sig+"00") {
		t.Fatalf("Verify should reject a length-wrong signature")
	}
	if Verify([]byte("wrong-key"), body, sig) {
		t.Fatalf("Verify should reject the wrong key")
	}
	if Verify([]byte("k"), append(body, '!'), sig) {
		t.Fatalf("Verify should reject a tampered body")
	}
	if Verify([]byte("k"), body, "ZZZZ") {
		t.Fatalf("Verify should reject non-hex input")
	}
}

func TestString_RedactsSecret(t *testing.T) {
	setEnv(t, "http://example/", "auth.account_locked", "super-secret")
	w := NewWebhook()
	s := w.String()
	if strings.Contains(s, "super-secret") {
		t.Fatalf("String() leaked the secret: %s", s)
	}
	if !strings.Contains(s, "signed") {
		t.Fatalf("String() should mention signed/unsigned state: %s", s)
	}
}

// Race-safety smoke: SendIfAllowed spawns goroutines, so let -race
// detect any data race on w.client. Fire a burst at a fast server.
func TestSendIfAllowed_ConcurrentSendIsRaceFree(t *testing.T) {
	srv, _ := captureServer(t, http.StatusOK)
	defer srv.Close()
	setEnv(t, srv.URL, "auth.account_locked", "k")
	w := NewWebhook()

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w.SendIfAllowed("auth.account_locked", audit.AlertEvent{Action: "auth.account_locked"})
		}()
	}
	wg.Wait()
	// No assertion — relying on `go test -race` to flag any race.
	// Allow the dispatched goroutines a moment to drain so the test
	// server isn't torn down while they're mid-write.
	time.Sleep(200 * time.Millisecond)
}
