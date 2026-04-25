package email

import (
	"context"
	"fmt"
	"log"
	"net/smtp"
	"strings"
	"time"
)

// Transport is the dumb wire-level sender. The Service layer renders + flags;
// Transport just serialises and ships. Swap implementations for tests, dev
// console output, or alternative providers without touching API callers.
type Transport interface {
	Send(ctx context.Context, from string, msg Message) error
}

// DiscardTransport drops everything on the floor. Use in tests where the
// channel-flag matrix is what's being asserted, not delivery.
type DiscardTransport struct{}

func (DiscardTransport) Send(_ context.Context, _ string, _ Message) error { return nil }

// ConsoleTransport logs the message instead of sending. Used in dev when
// EMAIL_MODE != "smtp" so password-reset links land in the backend log.
type ConsoleTransport struct{}

func (ConsoleTransport) Send(_ context.Context, _ string, msg Message) error {
	log.Printf("[EMAIL:console] to=%s subject=%q body=%q", msg.To, msg.Subject, msg.Body)
	return nil
}

// SMTPTransport ships RFC 5322 messages over SMTP. PlainAuth is only used
// when User != ""; otherwise we connect unauthenticated (sane for an MTA
// that whitelists the source IP).
type SMTPTransport struct {
	Host string
	Port string
	User string
	Pass string
}

func (s SMTPTransport) Send(_ context.Context, from string, msg Message) error {
	addr := s.Host + ":" + s.Port

	var auth smtp.Auth
	if s.User != "" {
		auth = smtp.PlainAuth("", s.User, s.Pass, s.Host)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", msg.To)
	fmt.Fprintf(&b, "Subject: %s\r\n", msg.Subject)
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	fmt.Fprintf(&b, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: text/plain; charset=utf-8\r\n")
	fmt.Fprintf(&b, "\r\n")
	b.WriteString(msg.Body)

	if err := smtp.SendMail(addr, auth, from, []string{msg.To}, []byte(b.String())); err != nil {
		log.Printf("[EMAIL:smtp] send failed → %s : %v", msg.To, err)
		return err
	}
	log.Printf("[EMAIL:smtp] sent → %s subject=%q", msg.To, msg.Subject)
	return nil
}
