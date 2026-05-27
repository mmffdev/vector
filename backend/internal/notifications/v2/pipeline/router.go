package pipeline

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/templates"
)

// routeDecision converts a single Decision for one (recipient, channel) pair
// into one of three outcomes:
//
//  1. ActionDeliver / ActionSchedule → render template → insert outbox row.
//  2. ActionDigest → push PendingEntry to PendingStore.
//  3. ActionSuppress → call writeSuppression (outbox companion + attempt row).
//
// All DB writes for one decision happen inside tx. The caller commits tx
// after routeDecision returns.
func routeDecision(
	ctx context.Context,
	tx pgx.Tx,
	event domain.Event,
	recipient Recipient,
	d Decision,
	templateSvc templates.Service,
	pendingStore PendingStore,
) (outboxWritten, pendingPushed, suppressionWritten bool, err error) {

	switch d.Action {
	case ActionSuppress:
		if err := writeSuppression(ctx, tx, event.ID, recipient.UserID, d.Channel, d.SuppressReason, d.BypassReason, d.EffectivePriority); err != nil {
			return false, false, false, fmt.Errorf("router: writeSuppression: %w", err)
		}
		return false, false, true, nil

	case ActionDigest:
		// Push to PendingStore (Valkey in S12, memory fake in S06 tests).
		dueAt := time.Now().Add(1 * time.Hour)
		if d.ScheduledFor != nil {
			dueAt = *d.ScheduledFor
		}
		entry := PendingEntry{
			EventID:            event.ID,
			RecipientUserID:    recipient.UserID,
			Channel:            d.Channel,
			DigestBucket:       d.DigestBucket,
			DueAt:              dueAt,
			TemplateOverrideID: d.TemplateOverrideID,
			EffectivePriority:  d.EffectivePriority,
			EnqueuedAt:         time.Now().UTC(),
		}
		pushErr := pendingStore.Push(ctx, entry)
		if errors.Is(pushErr, ErrPendingUnavailable) {
			// Pending store unavailable:
			// - Critical events: fall back to immediate outbox.
			// - Non-critical events: write suppression audit row.
			if d.EffectivePriority == domain.PriorityCritical {
				fallback := d
				fallback.Action = ActionDeliver
				fallback.ScheduledFor = nil
				written, _, _, ferr := routeDecision(ctx, tx, event, recipient, fallback, templateSvc, pendingStore)
				return written, false, false, ferr
			}
			// Non-critical: suppress.
			if serr := writeSuppression(ctx, tx, event.ID, recipient.UserID, d.Channel, SuppressReasonPendingStoreUnavailable, d.BypassReason, d.EffectivePriority); serr != nil {
				return false, false, false, fmt.Errorf("router: pending unavailable suppression: %w", serr)
			}
			return false, false, true, nil
		}
		if pushErr != nil {
			return false, false, false, fmt.Errorf("router: pending push: %w", pushErr)
		}
		return false, true, false, nil

	case ActionDeliver, ActionSchedule:
		// Render template.
		title, body, rerr := renderForDecision(ctx, event, d, templateSvc)
		if errors.Is(rerr, templates.ErrTemplateMissing) || errors.Is(rerr, templates.ErrTemplateNotFound) {
			// Template missing: write suppression audit row.
			if serr := writeSuppression(ctx, tx, event.ID, recipient.UserID, d.Channel, SuppressReasonTemplateMissing, d.BypassReason, d.EffectivePriority); serr != nil {
				return false, false, false, fmt.Errorf("router: template missing suppression: %w", serr)
			}
			return false, false, true, nil
		}
		if rerr != nil {
			return false, false, false, fmt.Errorf("router: render: %w", rerr)
		}

		// Determine scheduled_for.
		scheduledFor := time.Now().UTC()
		if d.Action == ActionSchedule && d.ScheduledFor != nil {
			scheduledFor = *d.ScheduledFor
		}

		// Insert outbox row (idempotent: check for existing row first to satisfy
		// Task 10.3). TD: add DB-level UNIQUE (id_event, id_recipient_user, channel,
		// scheduled_for) to close the race window between check and insert.
		exists, exErr := outboxRowExists(ctx, tx, event.ID, recipient.UserID, d.Channel, scheduledFor)
		if exErr != nil {
			return false, false, false, fmt.Errorf("router: idempotency check: %w", exErr)
		}
		if exists {
			// Already written — idempotent repeat; count as written.
			return true, false, false, nil
		}

		if err := insertOutboxRow(ctx, tx, event.ID, recipient.UserID, d.Channel, title, body, scheduledFor); err != nil {
			return false, false, false, fmt.Errorf("router: insertOutboxRow: %w", err)
		}
		return true, false, false, nil

	default:
		return false, false, false, fmt.Errorf("router: unknown action %q", d.Action)
	}
}

// renderForDecision calls templates.Service.Render or RenderOverride.
// Uses event.Type.String() + string(channel) + "en-GB" locale.
// Returns (title, body, error).
func renderForDecision(ctx context.Context, event domain.Event, d Decision, svc templates.Service) (string, string, error) {
	if d.TemplateOverrideID != nil {
		return svc.RenderOverride(ctx, *d.TemplateOverrideID, event.Data)
	}
	return svc.Render(ctx, event.Type.String(), string(d.Channel), "en-GB", event.Data)
}

// insertOutboxRow writes one notifications_outbox_v2 row.
func insertOutboxRow(
	ctx context.Context,
	tx pgx.Tx,
	eventID, recipientUserID uuid.UUID,
	channel domain.Channel,
	renderedTitle, renderedBody string,
	scheduledFor time.Time,
) error {
	const q = `
		INSERT INTO notifications_outbox_v2 (
			notifications_outbox_v2_id_event,
			notifications_outbox_v2_id_recipient_user,
			notifications_outbox_v2_channel,
			notifications_outbox_v2_scheduled_for,
			notifications_outbox_v2_rendered_title,
			notifications_outbox_v2_rendered_body
		) VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := tx.Exec(ctx, q,
		eventID,
		recipientUserID,
		string(channel),
		scheduledFor,
		renderedTitle,
		renderedBody,
	)
	return err
}

// outboxRowExists checks whether an outbox row already exists for the given
// (event, recipient, channel, scheduled_for) tuple. Used for idempotency.
// TD: replace with DB-level UNIQUE constraint (Task 10.3 requirement).
func outboxRowExists(
	ctx context.Context,
	tx pgx.Tx,
	eventID, recipientUserID uuid.UUID,
	channel domain.Channel,
	scheduledFor time.Time,
) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM notifications_outbox_v2
			WHERE notifications_outbox_v2_id_event          = $1
			  AND notifications_outbox_v2_id_recipient_user = $2
			  AND notifications_outbox_v2_channel           = $3
			  AND notifications_outbox_v2_scheduled_for     = $4
		)
	`
	var exists bool
	err := tx.QueryRow(ctx, q, eventID, recipientUserID, string(channel), scheduledFor).Scan(&exists)
	return exists, err
}
