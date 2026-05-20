package dispatchers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/notifications"
	"github.com/mmffdev/vector-backend/internal/notifications/broker"
)

// Email is the SMTP / mailer-backed dispatcher. Binds to *.email,
// looks up the recipient's address, and hands off to
// messaging/email.Service.SendUserUpdate.
//
// The per-channel kill-switch lives upstream in
// messaging/email/flags.go (ChannelUserUpdate). Per-user opt-out is
// honoured here via the Prefs check before delivery.
type Email struct {
	pool      *pgxpool.Pool
	mailer    *email.Service
	templates *notifications.Templates
	prefs     *notifications.Prefs
	logger    *slog.Logger
}

func NewEmail(pool *pgxpool.Pool, mailer *email.Service, t *notifications.Templates, p *notifications.Prefs, logger *slog.Logger) *Email {
	if logger == nil {
		logger = slog.Default()
	}
	return &Email{pool: pool, mailer: mailer, templates: t, prefs: p, logger: logger}
}

func (d *Email) Run(ctx context.Context, b broker.Broker) error {
	return b.Consume(ctx, "notifications.email", "*.email", d.handle)
}

func (d *Email) handle(ctx context.Context, env broker.Envelope) error {
	var ev notifications.Event
	if err := json.Unmarshal(env.Payload, &ev); err != nil {
		return fmt.Errorf("unmarshal event: %w", err)
	}

	enabled, err := d.prefs.Enabled(ctx, ev.RecipientUserID, string(ev.Kind), "email")
	if err != nil {
		return fmt.Errorf("prefs check: %w", err)
	}
	if !enabled {
		return nil
	}

	addr, err := d.recipientEmail(ctx, ev.RecipientUserID)
	if err != nil {
		if err == pgx.ErrNoRows {
			d.logger.Warn("notifications.email: recipient not found", "user_id", ev.RecipientUserID)
			return nil // drop — no point retrying a missing user
		}
		return fmt.Errorf("look up recipient: %w", err)
	}
	if addr == "" {
		return nil
	}

	subject, body := d.templates.Render(ev, "email")
	res := d.mailer.SendUserUpdate(ctx, addr, subject, body)
	if res.Err != nil {
		return fmt.Errorf("send mail: %w", res.Err)
	}
	if !res.Sent {
		// Channel disabled at the email-flag layer — treat as success
		// from the consumer's perspective so we don't requeue forever.
		d.logger.Debug("notifications.email: not sent (flag/disabled)",
			"channel", res.Channel, "reason", res.Reason)
	}
	return nil
}

func (d *Email) recipientEmail(ctx context.Context, userID uuid.UUID) (string, error) {
	var addr string
	err := d.pool.QueryRow(ctx, notifications.SqlSelectUserEmail, userID).Scan(&addr)
	return addr, err
}
