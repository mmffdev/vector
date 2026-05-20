package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/notifications/broker"
)

// Relay drains notifications_outbox into the broker. It runs as a
// single goroutine started from main.go. Two wakeup sources:
//
//   1. Postgres LISTEN — the 230 migration trigger fires
//      pg_notify('notifications_outbox_inserted') on every insert.
//      The relay's LISTEN connection wakes up and drains immediately.
//
//   2. Periodic tick — a 30s safety net in case the LISTEN connection
//      drops or a row was inserted while it wasn't connected.
//
// On each wakeup the relay claims a batch (atomic UPDATE ... RETURNING
// + FOR UPDATE SKIP LOCKED, so multiple relays would coordinate
// safely), publishes each row to the broker, and marks delivered or
// failed-with-retry.
type Relay struct {
	pool   *pgxpool.Pool
	broker broker.Broker
	logger *slog.Logger
}

func NewRelay(pool *pgxpool.Pool, b broker.Broker, logger *slog.Logger) *Relay {
	if logger == nil {
		logger = slog.Default()
	}
	return &Relay{pool: pool, broker: b, logger: logger}
}

// Run blocks until ctx is cancelled. Spawn in a goroutine.
func (r *Relay) Run(ctx context.Context) error {
	// First drain catches anything left behind from a previous boot.
	r.drainOnce(ctx)

	// Two parallel concerns:
	//   - listen() blocks on LISTEN, calling drainOnce on each NOTIFY.
	//   - the for-loop below ticks every 30s as a safety net.
	notify := make(chan struct{}, 1)
	listenCtx, listenCancel := context.WithCancel(ctx)
	defer listenCancel()
	go r.listen(listenCtx, notify)

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	r.logger.Info("notifications.relay: running")
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

// listen holds a single dedicated connection on LISTEN
// notifications_outbox_inserted. Re-dials on connection loss.
func (r *Relay) listen(ctx context.Context, notify chan<- struct{}) {
	for {
		if ctx.Err() != nil {
			return
		}
		err := r.listenLoop(ctx, notify)
		if ctx.Err() != nil {
			return
		}
		r.logger.Warn("notifications.relay: LISTEN dropped, reconnecting in 2s", "err", err)
		time.Sleep(2 * time.Second)
	}
}

func (r *Relay) listenLoop(ctx context.Context, notify chan<- struct{}) error {
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire listen conn: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN notifications_outbox_inserted"); err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	r.logger.Info("notifications.relay: LISTEN notifications_outbox_inserted")

	for {
		_, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		select {
		case notify <- struct{}{}:
		default:
			// Already a wakeup queued — coalesce.
		}
	}
}

// drainOnce claims a batch and publishes each row. Logs and returns
// on transient errors; the next tick (or NOTIFY) will retry.
func (r *Relay) drainOnce(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		rows, err := r.claimBatch(ctx, 50)
		if err != nil {
			r.logger.Error("notifications.relay: claim batch", "err", err)
			return
		}
		if len(rows) == 0 {
			return
		}
		for _, row := range rows {
			r.publish(ctx, row)
		}
	}
}

type outboxRow struct {
	ID             uuid.UUID
	SubscriptionID uuid.UUID
	RecipientID    uuid.UUID
	Kind           string
	Payload        json.RawMessage
	Attempts       int
}

func (r *Relay) claimBatch(ctx context.Context, n int) ([]outboxRow, error) {
	rows, err := r.pool.Query(ctx, sqlClaimOutboxBatch, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]outboxRow, 0, n)
	for rows.Next() {
		var ob outboxRow
		if err := rows.Scan(&ob.ID, &ob.SubscriptionID, &ob.RecipientID, &ob.Kind, &ob.Payload, &ob.Attempts); err != nil {
			return nil, err
		}
		out = append(out, ob)
	}
	return out, rows.Err()
}

// publish sends one row to the broker, then marks delivered or
// failed-with-retry. Failed rows un-claim themselves so the next
// drain re-attempts; after 5 attempts the partial index drops them.
func (r *Relay) publish(ctx context.Context, row outboxRow) {
	// Fan out one event per channel — in_app, email, sse — by routing
	// key. Each dispatcher consumes the channel it cares about and
	// honours the per-user prefs check before actually delivering.
	channels := []string{"in_app", "email", "sse"}
	for _, ch := range channels {
		env := broker.Envelope{
			MessageID:  row.ID.String() + ":" + ch,
			RoutingKey: row.Kind + "." + ch,
			OutboxID:   row.ID.String(),
			Payload:    row.Payload,
		}
		if err := r.broker.Publish(ctx, env); err != nil {
			r.markFailed(ctx, row.ID, err.Error())
			return
		}
	}
	r.markDelivered(ctx, row.ID)
}

func (r *Relay) markDelivered(ctx context.Context, id uuid.UUID) {
	if _, err := r.pool.Exec(ctx, sqlMarkOutboxDelivered, id); err != nil {
		r.logger.Error("notifications.relay: mark delivered", "id", id, "err", err)
	}
}

func (r *Relay) markFailed(ctx context.Context, id uuid.UUID, msg string) {
	if _, err := r.pool.Exec(ctx, sqlMarkOutboxFailed, id, msg); err != nil {
		r.logger.Error("notifications.relay: mark failed", "id", id, "err", err)
	}
}

// Compile-time check — relay relies on pgx.Tx free helpers.
var _ pgx.Tx = (pgx.Tx)(nil)
