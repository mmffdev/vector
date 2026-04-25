package email

import (
	"log"
	"os"

	"github.com/mmffdev/vector-backend/internal/secrets"
)

// Service is the front door for outbound mail. Callers depend on this
// concrete pointer (not an interface) — the public method set IS the
// surface contract. Swap the Transport for tests; see DiscardTransport.
type Service struct {
	Transport Transport
	From      string
}

// New builds a Service with an explicit transport. Tests construct directly
// with DiscardTransport or a capture transport; production goes through
// NewFromEnv.
func New(t Transport, from string) *Service {
	return &Service{Transport: t, From: from}
}

// NewFromEnv selects a transport based on EMAIL_MODE.
//
//	EMAIL_MODE=smtp  → SMTPTransport (requires SMTP_HOST, SMTP_PORT, SMTP_FROM;
//	                   SMTP_USER + SMTP_PASS optional for whitelisted MTAs)
//	anything else    → ConsoleTransport (dev default; logs to backend.log)
//
// If EMAIL_MODE=smtp but a required var is missing, falls back to console
// with a warning rather than crashing the server. Production should treat
// the warning as a deploy bug.
func NewFromEnv() *Service {
	from := os.Getenv("SMTP_FROM")
	if os.Getenv("EMAIL_MODE") != "smtp" {
		return &Service{Transport: ConsoleTransport{}, From: from}
	}

	host := os.Getenv("SMTP_HOST")
	port := os.Getenv("SMTP_PORT")
	if host == "" || port == "" || from == "" {
		log.Println("[EMAIL] EMAIL_MODE=smtp but SMTP_HOST/SMTP_PORT/SMTP_FROM not all set; falling back to console")
		return &Service{Transport: ConsoleTransport{}, From: from}
	}

	return &Service{
		Transport: SMTPTransport{
			Host: host,
			Port: port,
			User: secrets.Get("SMTP_USER"),
			Pass: secrets.Get("SMTP_PASS"),
		},
		From: from,
	}
}
