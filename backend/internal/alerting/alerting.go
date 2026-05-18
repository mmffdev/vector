// Package alerting fans selected audit_log actions out to an external
// webhook so ops can route them into Slack / PagerDuty / SIEM / a
// pager / a Teams channel without coupling Vector to any specific
// notification surface.
//
// B16.8 Phase 5. The set of "alertable" actions is controlled at
// startup by AUDIT_ALERT_ACTIONS (comma-separated allowlist) and
// AUDIT_ALERT_WEBHOOK_URL (where to POST). Both must be set — empty
// allowlist OR empty URL silently disables the alerter, so the
// default-config deploy never fires.
//
// Wire format: a JSON body POSTed to the webhook URL with payload:
//
//	{
//	  "event":           "audit.alert",
//	  "timestamp":       "<RFC3339Nano>",
//	  "action":          "<the audit action, e.g. auth.account_locked>",
//	  "user_id":         "<uuid|null>",
//	  "subscription_id": "<uuid|null>",
//	  "ip_address":      "<string|null>",
//	  "metadata":        {<...arbitrary>},
//	}
//
// Each request is signed: an HMAC-SHA256 over the raw JSON body using
// AUDIT_ALERT_SECRET goes in the X-Vector-Signature header as a
// hex string. Receivers verify by re-computing the HMAC over the raw
// body and comparing constant-time. Without the secret env set, no
// signature header is emitted — receivers should refuse unsigned
// requests, but for local-dev convenience we don't force the secret.
//
// Failure mode: alerts are fire-and-forget on a separate goroutine
// with a 5s HTTP timeout. A failed POST (network error, non-2xx, slow
// receiver) is logged to stderr only — it does NOT block the audit
// row INSERT and does NOT re-fire as an alert (to avoid infinite
// loops). Use the receiver's own delivery semantics for retries.

package alerting

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/audit"
)

// uuidToStr renders a nullable UUID for the JSON wire payload. Nil
// pointers become JSON null; otherwise the canonical string form.
func uuidToStr(u *uuid.UUID) *string {
	if u == nil {
		return nil
	}
	s := u.String()
	return &s
}

// wirePayload is the JSON shape POSTed to the receiver. Built from
// audit.AlertEvent on the fly so we can stamp `event` + json tags
// without forcing audit.AlertEvent to carry encoding/json struct tags.
type wirePayload struct {
	Event          string         `json:"event"`
	Timestamp      string         `json:"timestamp"`
	Action         string         `json:"action"`
	UserID         *string        `json:"user_id"`
	SubscriptionID *string        `json:"subscription_id"`
	IPAddress      *string        `json:"ip_address"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// Webhook is the runtime alerter. Construct with NewWebhook(); a
// zero-value or nil Webhook is the documented "disabled" state and
// SendIfAllowed becomes a no-op.
type Webhook struct {
	url      string
	secret   []byte
	actions  map[string]struct{}
	client   *http.Client
	disabled bool
}

// NewWebhook reads the three env vars and returns a configured
// Webhook. If either the URL or the allowlist is empty, the returned
// Webhook is disabled (SendIfAllowed is a no-op).
//
// AUDIT_ALERT_WEBHOOK_URL — full URL to POST to. Required.
// AUDIT_ALERT_ACTIONS     — comma-separated allowlist of audit action
//   codes that should fan out. Required.
// AUDIT_ALERT_SECRET      — HMAC-SHA256 signing secret. Optional but
//   strongly recommended (receivers should refuse unsigned alerts).
func NewWebhook() *Webhook {
	url := strings.TrimSpace(os.Getenv("AUDIT_ALERT_WEBHOOK_URL"))
	actionsCSV := strings.TrimSpace(os.Getenv("AUDIT_ALERT_ACTIONS"))
	secret := os.Getenv("AUDIT_ALERT_SECRET")

	if url == "" || actionsCSV == "" {
		return &Webhook{disabled: true}
	}

	actions := make(map[string]struct{})
	for _, a := range strings.Split(actionsCSV, ",") {
		a = strings.TrimSpace(a)
		if a != "" {
			actions[a] = struct{}{}
		}
	}
	if len(actions) == 0 {
		return &Webhook{disabled: true}
	}

	return &Webhook{
		url:     url,
		secret:  []byte(secret),
		actions: actions,
		client:  &http.Client{Timeout: 5 * time.Second},
	}
}

// SendIfAllowed checks the action against the allowlist and fires the
// webhook asynchronously if it matches. Never blocks the caller; never
// panics; nil/disabled receivers are safe no-ops. Implements the
// audit.Alerter interface so it can be attached via audit.Logger.SetAlerter.
func (w *Webhook) SendIfAllowed(action string, e audit.AlertEvent) {
	if w == nil || w.disabled {
		return
	}
	if _, ok := w.actions[action]; !ok {
		return
	}
	go w.send(e)
}

// send is the goroutine body — performs the HTTP POST and logs any
// failure to stderr. Failures never propagate back to the caller and
// never re-enter audit/alerting (no infinite-loop risk).
func (w *Webhook) send(e audit.AlertEvent) {
	payload := wirePayload{
		Event:          e.Event,
		Timestamp:      e.Timestamp,
		Action:         e.Action,
		UserID:         uuidToStr(e.UserID),
		SubscriptionID: uuidToStr(e.SubscriptionID),
		IPAddress:      e.IPAddress,
		Metadata:       e.Metadata,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("alerting: marshal failed for action=%s: %v", e.Action, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.url, bytes.NewReader(body))
	if err != nil {
		log.Printf("alerting: build request failed for action=%s: %v", e.Action, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "vector-backend (audit-alerts)")
	if len(w.secret) > 0 {
		req.Header.Set("X-Vector-Signature", sign(w.secret, body))
	}
	resp, err := w.client.Do(req)
	if err != nil {
		log.Printf("alerting: POST failed for action=%s: %v", e.Action, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("alerting: receiver returned %d for action=%s", resp.StatusCode, e.Action)
		return
	}
}

// sign returns the hex-encoded HMAC-SHA256 of body under secret.
// Exposed for tests; production callers go through SendIfAllowed.
func sign(secret, body []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// Verify is a helper for receivers (and tests) to constant-time-check
// a signature. Returns true iff sig matches HMAC-SHA256(secret, body).
// Use this on the receiver side; the alerter signs but never verifies.
func Verify(secret, body []byte, sig string) bool {
	want, err := hex.DecodeString(sig)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(body)
	return hmac.Equal(mac.Sum(nil), want)
}

// Now returns RFC3339Nano wall-clock time. Indirected so tests can
// pin the timestamp.
var Now = func() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// String returns a human-readable summary of the Webhook config for
// startup logging — useful for ops to confirm what they configured.
// Never includes the secret.
func (w *Webhook) String() string {
	if w == nil || w.disabled {
		return "alerting=disabled"
	}
	signed := "unsigned"
	if len(w.secret) > 0 {
		signed = "signed"
	}
	acts := make([]string, 0, len(w.actions))
	for a := range w.actions {
		acts = append(acts, a)
	}
	return fmt.Sprintf("alerting=enabled url=%s %s actions=%s", w.url, signed, strings.Join(acts, ","))
}
