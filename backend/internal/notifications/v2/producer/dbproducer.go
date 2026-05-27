package producer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// pgUniqueViolation is the Postgres SQLSTATE for unique_violation.
const pgUniqueViolation = "23505"

// dbProducer is the Postgres implementation of Producer.
// Callers construct it via NewDBProducer and hold it as the Producer interface.
type dbProducer struct {
	pool *pgxpool.Pool
}

// NewDBProducer creates a dbProducer backed by the given pgxpool.
// The pool must target the vector_artefacts database.
func NewDBProducer(pool *pgxpool.Pool) Producer {
	return &dbProducer{pool: pool}
}

// Enqueue validates the event, opens its own transaction, calls EnqueueTx,
// and commits. Rolls back automatically on error.
func (p *dbProducer) Enqueue(ctx context.Context, e domain.Event) (uuid.UUID, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("producer.Enqueue: begin tx: %w", err)
	}
	defer func() {
		// Rollback is a no-op if the transaction already committed.
		_ = tx.Rollback(ctx)
	}()

	id, err := p.EnqueueTx(ctx, tx, e)
	if err != nil {
		return uuid.UUID{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.UUID{}, fmt.Errorf("producer.Enqueue: commit: %w", err)
	}
	return id, nil
}

// EnqueueTx validates the event and writes it within the caller's transaction.
//
// Idempotency: if a row with the same (subscription_id, event_key) already
// exists the existing event ID is returned without inserting a new row.
// For platform events (subscription_id IS NULL) the idempotency key is matched
// using IS NOT DISTINCT FROM so that NULL = NULL semantics hold.
//
// For FanoutDirect events, also inserts one notifications_event_recipients row
// and marks the event as resolved (recipient_count=1, resolved_at=now()).
// All other fanout modes leave resolved_at NULL for the broadcast service /
// relay to handle fan-out.
func (p *dbProducer) EnqueueTx(ctx context.Context, tx pgx.Tx, e domain.Event) (uuid.UUID, error) {
	if err := e.Validate(); err != nil {
		return uuid.UUID{}, fmt.Errorf("producer.EnqueueTx: validate: %w", err)
	}

	// Idempotency check. Platform events use IS NOT DISTINCT FROM because
	// NULL = NULL is false in SQL but we want to treat two platform events
	// with the same event_key as the same event.
	existingID, found, err := lookupExisting(ctx, tx, e.SubscriptionID, e.EventKey)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("producer.EnqueueTx: idempotency lookup: %w", err)
	}
	if found {
		return existingID, nil
	}

	// Assign producer-controlled fields.
	e.ID = uuid.New()
	e.CreatedAt = time.Now().UTC()

	// Marshal event data to JSON bytes for the jsonb column.
	dataBytes, err := json.Marshal(e.Data)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("producer.EnqueueTx: marshal data: %w", err)
	}

	// INSERT into notifications_events_v2.
	// Nullable UUID pointer fields are passed directly; pgx v5 treats
	// *uuid.UUID(nil) as NULL automatically.
	const insertEvent = `
		INSERT INTO notifications_events_v2 (
			notifications_events_v2_id,
			notifications_events_v2_event_key,
			notifications_events_v2_type,
			notifications_events_v2_priority,
			notifications_events_v2_fanout_mode,
			notifications_events_v2_id_subscription,
			notifications_events_v2_id_workspace,
			notifications_events_v2_id_topology_node,
			notifications_events_v2_id_recipient_user,
			notifications_events_v2_id_sent_by_user,
			notifications_events_v2_sent_by_system,
			notifications_events_v2_data,
			notifications_events_v2_created_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
		)`

	_, err = tx.Exec(ctx, insertEvent,
		e.ID,
		e.EventKey,
		e.Type.String(),
		string(e.Priority),
		string(e.FanoutMode),
		e.SubscriptionID,    // *uuid.UUID → NULL when nil
		e.WorkspaceID,       // *uuid.UUID → NULL when nil
		e.TopologyNodeID,    // *uuid.UUID → NULL when nil
		e.RecipientUserID,   // *uuid.UUID → NULL when nil
		e.SentByUserID,      // *uuid.UUID → NULL when nil
		e.SentBySystem,
		dataBytes,
		e.CreatedAt,
	)
	if err != nil {
		// Idempotency race: two concurrent Enqueue calls with the same
		// (subscription_id, event_key) could both pass the existence check
		// then both attempt INSERT. The UNIQUE constraint protects us —
		// the second INSERT gets a unique_violation. We recover by fetching
		// the winner's ID.
		if isUniqueViolation(err) {
			winner, found, lookupErr := lookupExisting(ctx, tx, e.SubscriptionID, e.EventKey)
			if lookupErr != nil {
				return uuid.UUID{}, fmt.Errorf("producer.EnqueueTx: race recovery lookup: %w", lookupErr)
			}
			if found {
				return winner, nil
			}
			// Should not happen: unique violation but no existing row.
			return uuid.UUID{}, fmt.Errorf("producer.EnqueueTx: unique violation but no existing row (event_key=%s)", e.EventKey)
		}
		return uuid.UUID{}, fmt.Errorf("producer.EnqueueTx: insert event: %w", err)
	}

	// For direct fanout: write the single recipient row and resolve immediately.
	if e.FanoutMode == domain.FanoutDirect {
		if err := insertDirectRecipient(ctx, tx, e.ID, *e.RecipientUserID); err != nil {
			return uuid.UUID{}, fmt.Errorf("producer.EnqueueTx: insert recipient: %w", err)
		}
		if err := resolveEvent(ctx, tx, e.ID, 1); err != nil {
			return uuid.UUID{}, fmt.Errorf("producer.EnqueueTx: resolve event: %w", err)
		}
	}
	// All other fanout modes: leave resolved_at and recipient_count NULL.
	// The broadcast service or relay handles recipient resolution.

	return e.ID, nil
}

// lookupExisting checks whether an event with the given (subscriptionID, eventKey)
// already exists. Returns (id, true, nil) if found, (zero, false, nil) if not,
// or (zero, false, err) on a query error.
//
// Platform events have a nil subscriptionID; we use IS NOT DISTINCT FROM so
// that NULL IS NOT DISTINCT FROM NULL evaluates to true.
func lookupExisting(ctx context.Context, tx pgx.Tx, subscriptionID *uuid.UUID, eventKey string) (uuid.UUID, bool, error) {
	const q = `
		SELECT notifications_events_v2_id
		FROM notifications_events_v2
		WHERE notifications_events_v2_id_subscription IS NOT DISTINCT FROM $1
		  AND notifications_events_v2_event_key = $2
		LIMIT 1`

	var id uuid.UUID
	err := tx.QueryRow(ctx, q, subscriptionID, eventKey).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, false, nil
	}
	if err != nil {
		return uuid.UUID{}, false, err
	}
	return id, true, nil
}

// insertDirectRecipient writes one row to notifications_event_recipients for a
// direct fanout event. The reason is always "direct".
func insertDirectRecipient(ctx context.Context, tx pgx.Tx, eventID, userID uuid.UUID) error {
	const q = `
		INSERT INTO notifications_event_recipients (
			notifications_event_recipients_id,
			notifications_event_recipients_id_event,
			notifications_event_recipients_id_user,
			notifications_event_recipients_resolved_at,
			notifications_event_recipients_resolved_reason
		) VALUES (
			gen_random_uuid(), $1, $2, now(), 'direct'
		)`
	_, err := tx.Exec(ctx, q, eventID, userID)
	return err
}

// resolveEvent marks an event as fan-out-complete by setting resolved_at and
// recipient_count. Must be called within the same transaction as the event
// insert (or recipient writes) for atomicity.
func resolveEvent(ctx context.Context, tx pgx.Tx, eventID uuid.UUID, recipientCount int) error {
	const q = `
		UPDATE notifications_events_v2
		SET
			notifications_events_v2_resolved_at    = now(),
			notifications_events_v2_recipient_count = $2
		WHERE notifications_events_v2_id = $1`
	_, err := tx.Exec(ctx, q, eventID, recipientCount)
	return err
}

// isUniqueViolation returns true when err is a Postgres unique_violation (23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation
}
