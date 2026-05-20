package dispatchers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/mmffdev/vector-backend/internal/notifications"
	"github.com/mmffdev/vector-backend/internal/notifications/broker"
	"github.com/mmffdev/vector-backend/internal/realtime"
)

// SSE pushes a nudge to the connected client so the bell refreshes
// in real time. We don't push the full notification body over the
// wire — we just publish on a per-user topic; the client refetches
// from /_site/notifications when it gets the nudge.
//
// Why nudge-only: the read-model row is authoritative; pushing the
// body separately risks dual-write skew with the InApp dispatcher.
// One write (InApp), one nudge (SSE), one source of truth (the read
// model).
//
// Topic shape: "notifications:<user_id>". The frontend subscribes
// to its own user's topic on bell mount.
type SSE struct {
	hub    *realtime.Hub
	prefs  *notifications.Prefs
	logger *slog.Logger
}

func NewSSE(hub *realtime.Hub, p *notifications.Prefs, logger *slog.Logger) *SSE {
	if logger == nil {
		logger = slog.Default()
	}
	return &SSE{hub: hub, prefs: p, logger: logger}
}

func (d *SSE) Run(ctx context.Context, b broker.Broker) error {
	return b.Consume(ctx, "notifications.sse", "*.sse", d.handle)
}

func (d *SSE) handle(ctx context.Context, env broker.Envelope) error {
	var ev notifications.Event
	if err := json.Unmarshal(env.Payload, &ev); err != nil {
		return fmt.Errorf("unmarshal event: %w", err)
	}

	enabled, err := d.prefs.Enabled(ctx, ev.RecipientUserID, string(ev.Kind), "sse")
	if err != nil {
		return fmt.Errorf("prefs check: %w", err)
	}
	if !enabled {
		return nil
	}

	topic := fmt.Sprintf("notifications:%s", ev.RecipientUserID.String())
	payload, _ := json.Marshal(map[string]any{
		"type": "notification.created",
		"kind": string(ev.Kind),
	})
	d.hub.Publish(topic, payload)
	return nil
}
