package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/broker"
)

const (
	// DefaultBatchSize is the number of outbox rows claimed per drain cycle.
	DefaultBatchSize = 50

	// DefaultTickInterval is the safety-net poll cadence. LISTEN/NOTIFY
	// wakes the relay immediately on insert; the ticker catches anything
	// missed while the LISTEN connection was down.
	DefaultTickInterval = 5 * time.Second

	// listenChannel is the Postgres channel the relay listens on.
	// No NOTIFY trigger exists in migration 122 — kept for forward
	// compatibility; if a trigger is added later the relay wakes on it
	// automatically. Until then the ticker is the sole wakeup.
	// TD: add pg_notify trigger on notifications_outbox_v2 insert (S01 followup).
	listenChannel = "notifications_outbox_v2_inserted"
)

// deliveryPayload is the JSON body placed in the broker.Envelope.Payload.
// Dispatchers decode this to decide how to route the notification to the user.
type deliveryPayload struct {
	OutboxID      string `json:"outbox_id"`
	EventID       string `json:"event_id"`
	RecipientID   string `json:"recipient_id"`
	Channel       string `json:"channel"`
	RenderedTitle string `json:"rendered_title"`
	RenderedBody  string `json:"rendered_body"`
}

// Relay drains notifications_outbox_v2 into the v2 RabbitMQ broker.
// Run one Relay per server process. Multiple instances are safe —
// SKIP LOCKED in claimBatch prevents double-delivery.
type Relay struct {
	pool         *pgxpool.Pool
	broker       broker.Broker
	logger       *slog.Logger
	batchSize    int
	tickInterval time.Duration
}

// Option is a functional option for NewRelay.
type Option func(*Relay)

// WithBatchSize overrides the default batch size (50).
func WithBatchSize(n int) Option {
	return func(r *Relay) { r.batchSize = n }
}

// WithTickInterval overrides the default poll interval (5s).
func WithTickInterval(d time.Duration) Option {
	return func(r *Relay) { r.tickInterval = d }
}

// NewRelay constructs a Relay. logger may be nil — falls back to slog.Default().
func NewRelay(pool *pgxpool.Pool, b broker.Broker, logger *slog.Logger, opts ...Option) *Relay {
	if logger == nil {
		logger = slog.Default()
	}
	r := &Relay{
		pool:         pool,
		broker:       b,
		logger:       logger,
		batchSize:    DefaultBatchSize,
		tickInterval: DefaultTickInterval,
	}
	for _, o := range opts {
		o(r)
	}
	return r
}

// Run blocks until ctx is cancelled. Spawn in its own goroutine from main.go.
//
// Two wakeup sources:
//  1. Postgres LISTEN — fires whenever a NOTIFY arrives on
//     notifications_outbox_v2_inserted (currently requires a trigger;
//     see TD note in listenChannel const).
//  2. Periodic ticker — safety net that catches rows inserted while
//     the LISTEN connection was disconnected.
func (r *Relay) Run(ctx context.Context) error {
	// Initial drain catches anything queued before this process started.
	r.drainOnce(ctx)

	notify := make(chan struct{}, 1)
	listenCtx, listenCancel := context.WithCancel(ctx)
	defer listenCancel()
	go r.listen(listenCtx, notify)

	ticker := time.NewTicker(r.tickInterval)
	defer ticker.Stop()

	r.logger.Info("notifications/v2/relay: running",
		"batch_size", r.batchSize,
		"tick_interval", r.tickInterval,
	)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			r.drainOnce(ctx)
		case <-notify:
			r.drainOnce(ctx)
		}
	}
}

// listen holds a dedicated connection and fires into notify on each
// pg_notify. Re-dials automatically on connection loss.
func (r *Relay) listen(ctx context.Context, notify chan<- struct{}) {
	for {
		if ctx.Err() != nil {
			return
		}
		if err := r.listenLoop(ctx, notify); err != nil {
			if ctx.Err() != nil {
				return
			}
			r.logger.Warn("notifications/v2/relay: LISTEN dropped, reconnecting in 2s", "err", err)
			time.Sleep(2 * time.Second)
		}
	}
}

func (r *Relay) listenLoop(ctx context.Context, notify chan<- struct{}) error {
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire listen conn: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN "+listenChannel); err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	r.logger.Info("notifications/v2/relay: LISTEN " + listenChannel)

	for {
		if _, err := conn.Conn().WaitForNotification(ctx); err != nil {
			return err
		}
		select {
		case notify <- struct{}{}:
		default:
			// Coalesce — a drain is already queued.
		}
	}
}

// drainOnce loops until the outbox is empty for this tick. Each
// iteration claims a batch, commits (releases lock), then publishes
// each row individually.
func (r *Relay) drainOnce(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}

		tx, err := r.pool.Begin(ctx)
		if err != nil {
			r.logger.Error("notifications/v2/relay: begin tx", "err", err)
			return
		}

		rows, err := claimBatch(ctx, tx, r.batchSize)
		if err != nil {
			_ = tx.Rollback(ctx)
			r.logger.Error("notifications/v2/relay: claim batch", "err", err)
			return
		}

		// Commit immediately — claimed_at is persisted, row locks are released.
		// Subsequent failures un-claim the row (see markFailed) so the sweeper
		// or the next drain can retry.
		if err := tx.Commit(ctx); err != nil {
			r.logger.Error("notifications/v2/relay: commit claim tx", "err", err)
			return
		}

		if len(rows) == 0 {
			return
		}

		r.logger.Debug("notifications/v2/relay: claimed batch", "count", len(rows))
		for _, row := range rows {
			r.publishRow(ctx, row)
		}

		if len(rows) < r.batchSize {
			// Partial batch → outbox is empty.
			return
		}
	}
}

// publishRow publishes one outbox row to the broker and marks it
// delivered on success, or un-claims + bumps attempts on failure.
func (r *Relay) publishRow(ctx context.Context, row outboxRow) {
	// Split EventType "<domain>.<action>" into its two parts.
	domain, action, ok := splitEventType(row.EventType)
	if !ok {
		r.markFailed(ctx, row, fmt.Sprintf("invalid event type %q — expected <domain>.<action>", row.EventType))
		return
	}

	payload, err := json.Marshal(deliveryPayload{
		OutboxID:      row.ID.String(),
		EventID:       row.IDEvent.String(),
		RecipientID:   row.IDRecipient.String(),
		Channel:       row.Channel,
		RenderedTitle: row.RenderedTitle,
		RenderedBody:  row.RenderedBody,
	})
	if err != nil {
		r.markFailed(ctx, row, "marshal payload: "+err.Error())
		return
	}

	env := broker.Envelope{
		MessageID:  row.ID.String(),
		RoutingKey: broker.RoutingKey(domain, action, row.Channel),
		OutboxID:   row.ID.String(),
		Payload:    json.RawMessage(payload),
	}

	if err := r.broker.Publish(ctx, env); err != nil {
		r.logger.Warn("notifications/v2/relay: publish failed",
			"outbox_id", row.ID,
			"routing_key", env.RoutingKey,
			"attempts", row.Attempts,
			"err", err,
		)
		r.markFailed(ctx, row, err.Error())
		return
	}

	r.markDelivered(ctx, row)
}

// markDelivered sets delivered_at = now() for a successfully published row.
func (r *Relay) markDelivered(ctx context.Context, row outboxRow) {
	const q = `
		UPDATE notifications_outbox_v2
		SET    notifications_outbox_v2_delivered_at = now()
		WHERE  notifications_outbox_v2_id = $1
	`
	if _, err := r.pool.Exec(ctx, q, row.ID); err != nil {
		r.logger.Error("notifications/v2/relay: mark delivered", "outbox_id", row.ID, "err", err)
	}
}

// markFailed un-claims a row and bumps attempts so it re-enters the
// claimable queue. Rows with attempts >= 100 fall out of the partial
// index and are permanently parked.
func (r *Relay) markFailed(ctx context.Context, row outboxRow, msg string) {
	const q = `
		UPDATE notifications_outbox_v2
		SET    notifications_outbox_v2_claimed_at  = NULL,
		       notifications_outbox_v2_attempts     = notifications_outbox_v2_attempts + 1,
		       notifications_outbox_v2_last_error   = $2
		WHERE  notifications_outbox_v2_id = $1
	`
	if _, err := r.pool.Exec(ctx, q, row.ID, msg); err != nil {
		r.logger.Error("notifications/v2/relay: mark failed", "outbox_id", row.ID, "err", err)
	}
}

// splitEventType splits "<domain>.<action>" into its two parts.
// Returns false if the format is invalid.
func splitEventType(t string) (domain, action string, ok bool) {
	parts := strings.SplitN(t, ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}
