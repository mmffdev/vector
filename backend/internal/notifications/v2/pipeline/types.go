// Package pipeline is the orchestration core for notifications v2.
//
// Given a resolved event + its recipients (from notifications_event_recipients),
// it walks enrich → filter → router per recipient and produces:
//   - notifications_outbox_v2 rows for relay to drain (immediate or scheduled),
//   - PendingStore entries for digest batches (S12 Valkey impl), or
//   - notifications_delivery_attempts rows with status='suppressed' (audit trail).
//
// Hard boundaries:
//   - No imports from v1 notifications (strangler-fig rule).
//   - Pipeline does NOT publish to RabbitMQ — relay owns that.
//   - Pipeline does NOT call channel dispatchers — S09 owns that.
//   - S06 ships PendingStore interface + InMemoryPendingStore only.
//     The Valkey ZSET implementation is deferred to S12.
//
// See: docs/superpowers/specs/2026-05-26-notifications-v2-design.md
// §End-to-end flow (steps 3a/3b/3c), §Interfaces (PendingStore),
// §Critical-priority bypass, §Testing strategy Layer 2.
package pipeline

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/rules"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/templates"
)

// ── Sentinel errors ───────────────────────────────────────────────────────────

var (
	// ErrEventNotFound is returned by ProcessEvent when the eventID does not
	// exist in notifications_events_v2.
	ErrEventNotFound = errors.New("pipeline: event not found")

	// ErrNoRecipients is returned when notifications_event_recipients has zero
	// rows for the given event. No outbox rows are written.
	ErrNoRecipients = errors.New("pipeline: event has no recipients")

	// ErrTemplateMissing is surfaced when templates.ErrTemplateMissing is
	// returned and the pipeline cannot produce a rendered title/body.
	// The router writes a suppression audit row instead.
	ErrTemplateMissing = errors.New("pipeline: template missing for channel")

	// ErrPendingUnavailable is returned by PendingStore implementations when
	// the backing store (Valkey in S12) cannot be reached.
	ErrPendingUnavailable = errors.New("pipeline: pending store unavailable")
)

// ── Processor ─────────────────────────────────────────────────────────────────

// Processor is the public surface of the pipeline package.
// Implementations are safe for concurrent use.
type Processor interface {
	// ProcessEvent loads the event row and all recipient rows for eventID,
	// then evaluates each recipient independently (enrich → filter → router).
	// Each recipient's decision is committed in its own transaction so one
	// recipient failure does not corrupt another.
	//
	// Returns ErrEventNotFound if the event row does not exist.
	// Returns ErrNoRecipients if the event has zero resolved recipients.
	// Any other error is a DB failure; partial results are not returned —
	// the caller should re-enqueue the eventID.
	ProcessEvent(ctx context.Context, eventID uuid.UUID) (Result, error)
}

// ── Result ────────────────────────────────────────────────────────────────────

// Result carries the aggregate counters for a ProcessEvent call.
// Useful for logging and integration-test assertions.
type Result struct {
	// RecipientsTotal is the number of recipient rows loaded.
	RecipientsTotal int

	// OutboxRowsWritten is the number of notifications_outbox_v2 rows inserted
	// (immediate + scheduled; excludes suppression companion rows).
	OutboxRowsWritten int

	// PendingEntriesPushed is the number of PendingStore entries pushed
	// (digest-scheduled notifications).
	PendingEntriesPushed int

	// SuppressionsWritten is the number of suppression audit rows written.
	SuppressionsWritten int

	// Errors is the number of per-recipient errors that were logged and
	// counted but did not abort the remaining recipients.
	Errors int
}

// ── Recipient ─────────────────────────────────────────────────────────────────

// Recipient is the pipeline's view of one notifications_event_recipients row.
type Recipient struct {
	// ID is notifications_event_recipients_id.
	ID uuid.UUID

	// EventID is notifications_event_recipients_id_event.
	EventID uuid.UUID

	// UserID is notifications_event_recipients_id_user.
	UserID uuid.UUID

	// ResolvedReason is notifications_event_recipients_resolved_reason.
	// Values: direct / workspace_clamp / topology_node / topology_subtree /
	//         tenant_member / platform_member.
	ResolvedReason string
}

// ── Decision ──────────────────────────────────────────────────────────────────

// Decision is the filter stage's output for one (recipient, channel) pair.
// The router converts a slice of Decisions into outbox rows, pending entries,
// or suppression audit rows.
type Decision struct {
	// Channel is the target delivery channel.
	Channel domain.Channel

	// Action is what the router should do.
	Action DecisionAction

	// ScheduledFor, when non-nil, sets the outbox row's scheduled_for.
	// Nil means "now" (immediate delivery, ActionDeliver).
	// Non-nil means quiet-hours defer or rule-driven delay (ActionSchedule).
	ScheduledFor *time.Time

	// SuppressReason is the error_class written to delivery_attempts when
	// Action == ActionSuppress.
	SuppressReason string

	// BypassReason is the bypass_reason written to delivery_attempts when
	// critical priority overrides user prefs. Empty for non-bypassed decisions.
	BypassReason string

	// TemplateOverrideID, when non-nil, directs the router to call
	// templates.RenderOverride instead of templates.Render.
	TemplateOverrideID *uuid.UUID

	// EffectivePriority is the priority after any rule PriorityOverride.
	EffectivePriority domain.Priority

	// DigestBucket is the bucket key for PendingStore when Action == ActionDigest.
	DigestBucket string
}

// DecisionAction is what the router should do with a Decision.
type DecisionAction string

const (
	// ActionDeliver writes an immediate notifications_outbox_v2 row.
	ActionDeliver DecisionAction = "deliver"

	// ActionSchedule writes a future-dated notifications_outbox_v2 row
	// (quiet-hours defer or rule-driven delay).
	ActionSchedule DecisionAction = "schedule"

	// ActionDigest pushes a PendingEntry to PendingStore for digest batching.
	ActionDigest DecisionAction = "digest"

	// ActionSuppress writes a suppression notifications_delivery_attempts row
	// with a non-deliverable outbox companion (delivered_at=now()).
	ActionSuppress DecisionAction = "suppress"
)

// ── Deps + constructor ────────────────────────────────────────────────────────

// Deps are the dependencies injected into NewProcessor.
// All interface fields allow test fakes to be substituted.
type Deps struct {
	// Pool must target vector_artefacts.
	Pool *pgxpool.Pool

	// Rules evaluates matching rules for an event.
	Rules rules.Evaluator

	// Templates renders title/body for a channel.
	Templates templates.Service

	// Pending stores digest-scheduled entries.
	Pending PendingStore
}

// processorImpl is the concrete Processor implementation.
type processorImpl struct {
	deps Deps
}

// NewProcessor constructs a Processor. All deps fields are required.
func NewProcessor(deps Deps) Processor {
	return &processorImpl{deps: deps}
}
