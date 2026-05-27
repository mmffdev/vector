package pipeline

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// PendingStore holds digest-scheduled notification entries until they are
// due for batching. The Valkey ZSET implementation ships in S12.
// S06 ships the interface + InMemoryPendingStore (test-only) only.
//
// Callers MUST handle ErrPendingUnavailable explicitly:
//   - Critical events: fall back to immediate outbox delivery.
//   - Non-critical events: write suppression audit row with
//     error_class='pending_store_unavailable'.
//
// See: docs/superpowers/specs/2026-05-26-notifications-v2-design.md
// §Interfaces (pipeline.PendingStore).
type PendingStore interface {
	// Push adds an entry to the store, keyed by (UserID, DigestBucket, DueAt).
	// Implementations MUST be idempotent on (UserID, DigestBucket, EventID, Channel).
	// Returns ErrPendingUnavailable when the backing store is unreachable.
	Push(ctx context.Context, entry PendingEntry) error

	// PopDue returns up to limit entries whose DueAt <= now().
	// Returned entries are removed from the store atomically.
	// Returns ErrPendingUnavailable when the backing store is unreachable.
	PopDue(ctx context.Context, limit int) ([]PendingEntry, error)

	// PeekDigestBucket returns all entries for (userID, bucket) without removing
	// them. Used to preview digest content before committing a send.
	// Returns ErrPendingUnavailable when the backing store is unreachable.
	PeekDigestBucket(ctx context.Context, userID uuid.UUID, bucket string) ([]PendingEntry, error)
}

// PendingEntry is one digest-pending notification.
type PendingEntry struct {
	// EventID links back to notifications_events_v2.
	EventID uuid.UUID

	// RecipientUserID is the intended recipient.
	RecipientUserID uuid.UUID

	// Channel is the delivery channel for this digest item.
	Channel domain.Channel

	// DigestBucket groups entries for the same user + cadence window.
	// Format: "<userID>:<cadence>" e.g. "abc123:daily_9am".
	DigestBucket string

	// DueAt is when this entry should be included in a digest flush.
	DueAt time.Time

	// TemplateOverrideID, when non-nil, directs the router to use RenderOverride
	// when the digest is flushed to outbox rows.
	TemplateOverrideID *uuid.UUID

	// EffectivePriority at the time of scheduling.
	EffectivePriority domain.Priority

	// EnqueuedAt is when this entry was pushed (for ordering within a bucket).
	EnqueuedAt time.Time
}
