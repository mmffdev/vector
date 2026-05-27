// Package producer is the v2 doorway for firing notifications.
// External code (mentions service, artefact lifecycle, auth) calls
// Producer.Enqueue or .EnqueueTx; it never touches the outbox or
// broker directly.
//
// Idempotency: Producer is idempotent on (subscription_id, event_key).
// Re-firing the same event with the same key returns the original
// event ID — no duplicate row.
package producer

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// Producer is the only public surface external packages use to fire
// notifications v2 events. Do not bypass this to write to
// notifications_events_v2 or notifications_outbox_v2 directly
// (see lint:no-direct-outbox-write).
type Producer interface {
	// Enqueue writes the event to notifications_events_v2 in its own
	// transaction. For direct events also writes the single
	// notifications_event_recipients row. Returns the event ID.
	//
	// Idempotent: if (subscription_id, event_key) already exists,
	// returns the original event ID without inserting a duplicate.
	Enqueue(ctx context.Context, e domain.Event) (uuid.UUID, error)

	// EnqueueTx writes inside the caller's transaction. Use this when
	// the event must be atomic with a domain write (e.g. mention
	// creation must be atomic with users_mentions INSERT).
	//
	// Idempotent: same guarantee as Enqueue.
	EnqueueTx(ctx context.Context, tx pgx.Tx, e domain.Event) (uuid.UUID, error)
}
