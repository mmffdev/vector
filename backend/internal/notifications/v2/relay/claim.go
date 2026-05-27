// Package relay drains the notifications_outbox_v2 table, publishing
// each claimed row to the v2 RabbitMQ broker. It is the sole writer
// of delivered_at and the un-claimer on publish failure.
//
// v2 routing keys are "<domain>.<action>.<channel>" — three segments —
// and are never confused with v1's two-segment "<kind>.<channel>".
//
// Build tag: no tag required. Integration tests carry //go:build integration.
package relay

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// outboxRow is the relay's view of notifications_outbox_v2.
// Only the columns needed to publish are included; delivered_at and
// last_error are written back by drainOnce, not read here.
type outboxRow struct {
	ID            uuid.UUID
	IDEvent       uuid.UUID
	IDRecipient   uuid.UUID
	Channel       string
	RenderedTitle string
	RenderedBody  string
	ScheduledFor  time.Time
	Attempts      int

	// Joined from notifications_events_v2 to build the routing key.
	EventType string // "<domain>.<action>"
}

// sqlClaimBatch is the SKIP LOCKED claim query.
// Column aliases keep the pgx scan list short and readable.
const sqlClaimBatch = `
UPDATE notifications_outbox_v2
SET notifications_outbox_v2_claimed_at = now()
WHERE notifications_outbox_v2_id IN (
    SELECT notifications_outbox_v2_id
    FROM   notifications_outbox_v2
    JOIN   notifications_events_v2
           ON notifications_events_v2_id = notifications_outbox_v2_id_event
    WHERE  notifications_outbox_v2_claimed_at   IS NULL
      AND  notifications_outbox_v2_delivered_at  IS NULL
      AND  notifications_outbox_v2_scheduled_for <= now()
      AND  notifications_outbox_v2_attempts       < 100
    ORDER BY notifications_outbox_v2_created_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
)
RETURNING
    notifications_outbox_v2_id,
    notifications_outbox_v2_id_event,
    notifications_outbox_v2_id_recipient_user,
    notifications_outbox_v2_channel,
    notifications_outbox_v2_rendered_title,
    notifications_outbox_v2_rendered_body,
    notifications_outbox_v2_scheduled_for,
    notifications_outbox_v2_attempts,
    (
        SELECT notifications_events_v2_type
        FROM   notifications_events_v2
        WHERE  notifications_events_v2_id = notifications_outbox_v2_id_event
    ) AS event_type
`

// claimBatch atomically claims up to limit rows from
// notifications_outbox_v2 and returns them. The caller is responsible
// for marking each row delivered or failed. tx must have been started
// before calling claimBatch; the UPDATE holds locks for the duration
// of the transaction, so commit promptly.
func claimBatch(ctx context.Context, tx pgx.Tx, limit int) ([]outboxRow, error) {
	rows, err := tx.Query(ctx, sqlClaimBatch, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]outboxRow, 0, limit)
	for rows.Next() {
		var r outboxRow
		if err := rows.Scan(
			&r.ID,
			&r.IDEvent,
			&r.IDRecipient,
			&r.Channel,
			&r.RenderedTitle,
			&r.RenderedBody,
			&r.ScheduledFor,
			&r.Attempts,
			&r.EventType,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
