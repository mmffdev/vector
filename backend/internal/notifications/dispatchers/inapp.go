// Package dispatchers houses the per-channel notification consumers.
// Each dispatcher binds a queue to the notifications topic exchange
// with a routing-key pattern (`*.in_app`, `*.email`, `*.sse`), reads
// the incoming envelope, checks the user's preferences, and
// delivers via its channel.
//
// Dispatchers do NOT decide *what* the notification says — that's
// the template registry's job (templates.go). Each kind ships a
// template per channel; the dispatcher hydrates and emits it.
package dispatchers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/notifications"
	"github.com/mmffdev/vector-backend/internal/notifications/broker"
)

// InApp persists incoming envelopes to users_notifications (the bell
// read-model). The frontend bell polls (or subscribes via SSE) to
// this table.
type InApp struct {
	pool      *pgxpool.Pool
	templates *notifications.Templates
	prefs     *notifications.Prefs
	logger    *slog.Logger
}

func NewInApp(pool *pgxpool.Pool, t *notifications.Templates, p *notifications.Prefs, logger *slog.Logger) *InApp {
	if logger == nil {
		logger = slog.Default()
	}
	return &InApp{pool: pool, templates: t, prefs: p, logger: logger}
}

// Run subscribes to *.in_app and processes deliveries until ctx is
// cancelled. Spawn in a goroutine from main.go.
func (d *InApp) Run(ctx context.Context, b broker.Broker) error {
	return b.Consume(ctx, "notifications.in_app", "*.in_app", d.handle)
}

func (d *InApp) handle(ctx context.Context, env broker.Envelope) error {
	var ev notifications.Event
	if err := json.Unmarshal(env.Payload, &ev); err != nil {
		return fmt.Errorf("unmarshal event: %w", err)
	}

	// Per-user pref check. Defaults to enabled when no explicit row.
	enabled, err := d.prefs.Enabled(ctx, ev.RecipientUserID, string(ev.Kind), "in_app")
	if err != nil {
		return fmt.Errorf("prefs check: %w", err)
	}
	if !enabled {
		d.logger.Debug("notifications.inapp: skipped by user pref",
			"user_id", ev.RecipientUserID, "kind", ev.Kind)
		return nil
	}

	title, body := d.templates.Render(ev, "in_app")

	var outboxID *uuid.UUID
	if env.OutboxID != "" {
		if id, err := uuid.Parse(env.OutboxID); err == nil {
			outboxID = &id
		}
	}

	// Tag bucket — drives the bell-filter chip in the inbox UI.
	// Today the only producers are mentions (tag='mention'); future
	// rules-fired notifications set tag to the rule's type
	// ('artefact', 'note', 'comment', etc). The dispatcher derives
	// tag from kind so we don't need a separate event field yet.
	tag := tagForKind(string(ev.Kind))

	if _, err := d.pool.Exec(ctx, notifications.SqlInsertUserNotificationFromEvent,
		ev.SubscriptionID,
		ev.RecipientUserID,
		string(ev.Kind),
		title,
		body,
		nullableStr(ev.ContextKind),
		nullableStr(ev.ContextID),
		nullableStr(ev.ContextLabel),
		outboxID,
		tag,
	); err != nil {
		return fmt.Errorf("insert users_notifications: %w", err)
	}
	return nil
}

// tagForKind returns the bell-filter bucket for a notification kind.
// Mentions stay tag='mention'; everything else inherits its kind as
// tag for now (artefact-rules-fired notifications will set kind=
// "artefact" so this still does the right thing).
func tagForKind(kind string) string {
	switch kind {
	case "mention":
		return "mention"
	default:
		return kind
	}
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
