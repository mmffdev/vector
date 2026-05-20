package notifications

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DBNotifier is the production Notifier impl. Enqueue writes one row
// to notifications_outbox in the SAME transaction as the producer's
// domain write — that's the transactional-outbox pattern in one
// sentence: durable hand-off without dual-write inconsistency.
//
// The mentions service calls Enqueue from inside its own tx; this
// notifier accepts an explicit pgx.Tx via EnqueueTx so producers can
// hand it their existing tx. For producers that DON'T have a tx
// (background jobs, dev tools), Enqueue opens a one-row tx on the
// shared pool — still durable, just without the producer-write
// atomicity guarantee.
type DBNotifier struct {
	pool *pgxpool.Pool
}

func NewDBNotifier(pool *pgxpool.Pool) *DBNotifier {
	return &DBNotifier{pool: pool}
}

// Enqueue writes one outbox row using the notifier's own pool. Safe
// when the caller has no tx; if they do, they should use EnqueueTx
// instead so the outbox write commits with the producer write.
func (d *DBNotifier) Enqueue(ctx context.Context, e Event) error {
	payload, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	_, err = d.pool.Exec(ctx, sqlInsertOutbox,
		e.SubscriptionID, e.RecipientUserID, string(e.Kind), payload,
	)
	if err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}
	return nil
}

// EnqueueTx writes the outbox row inside the caller's transaction.
// Use this when the producer is itself in a tx (e.g. mentions
// service writing users_mentions + the outbox in one go). Commits
// or rolls back with the producer.
func (d *DBNotifier) EnqueueTx(ctx context.Context, tx pgx.Tx, e Event) error {
	payload, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	_, err = tx.Exec(ctx, sqlInsertOutbox,
		e.SubscriptionID, e.RecipientUserID, string(e.Kind), payload,
	)
	if err != nil {
		return fmt.Errorf("insert outbox (tx): %w", err)
	}
	return nil
}

