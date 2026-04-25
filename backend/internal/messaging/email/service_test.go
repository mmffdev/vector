package email

import (
	"context"
	"strings"
	"testing"
)

// captureTransport records every Send call so tests can assert on what
// the Service handed down. No DB, no SMTP — pure in-process.
type captureTransport struct {
	from string
	msgs []Message
}

func (c *captureTransport) Send(_ context.Context, from string, msg Message) error {
	c.from = from
	c.msgs = append(c.msgs, msg)
	return nil
}

func TestSendPasswordReset_RendersSubjectAndLink(t *testing.T) {
	cap := &captureTransport{}
	svc := New(cap, "noreply@example.com")

	r := svc.SendPasswordReset(context.Background(), "user@example.com", "https://app.example/reset?token=abc")

	if !r.Sent {
		t.Fatalf("expected Sent=true, got %+v", r)
	}
	if r.Channel != ChannelPasswordReset {
		t.Fatalf("expected channel=%s, got %s", ChannelPasswordReset, r.Channel)
	}
	if len(cap.msgs) != 1 {
		t.Fatalf("expected 1 message captured, got %d", len(cap.msgs))
	}
	m := cap.msgs[0]
	if m.Subject != "Password reset" {
		t.Errorf("subject mismatch: %q", m.Subject)
	}
	if !strings.Contains(m.Body, "https://app.example/reset?token=abc") {
		t.Errorf("body missing link: %q", m.Body)
	}
	if cap.from != "noreply@example.com" {
		t.Errorf("from mismatch: %q", cap.from)
	}
}

func TestSendPasswordReset_DisabledByFlag(t *testing.T) {
	t.Setenv("MAIL_CH_PASSWORD_RESET_ENABLED", "false")

	cap := &captureTransport{}
	svc := New(cap, "noreply@example.com")

	r := svc.SendPasswordReset(context.Background(), "user@example.com", "https://x")

	if r.Sent {
		t.Fatal("expected Sent=false when channel disabled")
	}
	if r.Reason != "disabled" {
		t.Errorf("expected reason=disabled, got %q", r.Reason)
	}
	if len(cap.msgs) != 0 {
		t.Errorf("transport should NOT be called for disabled channel; got %d msgs", len(cap.msgs))
	}
}

func TestSendUserUpdate_PassesSubjectAndBody(t *testing.T) {
	cap := &captureTransport{}
	svc := New(cap, "noreply@example.com")

	r := svc.SendUserUpdate(context.Background(), "u@example.com", "Hello", "world")
	if !r.Sent {
		t.Fatalf("expected sent, got %+v", r)
	}
	if cap.msgs[0].Subject != "Hello" || cap.msgs[0].Body != "world" {
		t.Errorf("subject/body not pass-through: %+v", cap.msgs[0])
	}
}

func TestChannelEnabled_DefaultTrue(t *testing.T) {
	if !channelEnabled(ChannelPasswordReset) {
		t.Error("default should be enabled")
	}
}

func TestChannelEnabled_RespectsFalseValues(t *testing.T) {
	for _, v := range []string{"0", "false", "off", "no", "FALSE", "Off"} {
		t.Run(v, func(t *testing.T) {
			t.Setenv("MAIL_CH_PASSWORD_RESET_ENABLED", v)
			if channelEnabled(ChannelPasswordReset) {
				t.Errorf("value %q should disable", v)
			}
		})
	}
}

func TestDiscardTransport_NeverErrors(t *testing.T) {
	svc := New(DiscardTransport{}, "")
	r := svc.SendPasswordReset(context.Background(), "x@y", "z")
	if !r.Sent || r.Err != nil {
		t.Errorf("DiscardTransport should silently succeed: %+v", r)
	}
}
