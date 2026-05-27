package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// ── Suppression reasons (stable string constants) ─────────────────────────────

// Suppression error_class values written to notifications_delivery_attempts.
// These must stay stable — they are queryable compliance dimensions.
const (
	SuppressReasonPrefsDisabled         = "prefs_disabled"
	SuppressReasonPriorityBelowFloor    = "priority_below_floor"
	SuppressReasonQuietHours            = "quiet_hours"
	SuppressReasonChannelDisabledPlatform = "channel_disabled_platform"
	SuppressReasonTemplateMissing       = "template_missing"
	SuppressReasonPendingStoreUnavailable = "pending_store_unavailable"
	SuppressReasonSentinelScopeMismatch = "sentinel_scope_mismatch"
)

// ── writeSuppression ──────────────────────────────────────────────────────────

// writeSuppression writes the two-row suppression audit trail in one transaction:
//
//  1. A non-deliverable notifications_outbox_v2 row with delivered_at=now()
//     so the relay never claims it (fulfilled_at prevents relay pickup).
//  2. A notifications_delivery_attempts row with status='suppressed' and
//     error_class describing why the notification was suppressed.
//
// The outbox FK requirement on notifications_delivery_attempts_id_outbox is
// satisfied by the companion outbox row. See brief §Suppression audit.
func writeSuppression(
	ctx context.Context,
	tx pgx.Tx,
	eventID uuid.UUID,
	recipientUserID uuid.UUID,
	channel domain.Channel,
	reason string,
	bypassReason string,
	effectivePriority domain.Priority,
) error {
	// Step 1: insert non-deliverable outbox row.
	outboxID, err := insertSuppressionOutboxRow(ctx, tx, eventID, recipientUserID, channel)
	if err != nil {
		return fmt.Errorf("writeSuppression: outbox row: %w", err)
	}

	// Step 2: insert delivery_attempts row with status='suppressed'.
	if err := insertSuppressionAttemptRow(ctx, tx, eventID, outboxID, recipientUserID, channel, reason, bypassReason); err != nil {
		return fmt.Errorf("writeSuppression: attempt row: %w", err)
	}
	return nil
}

// insertSuppressionOutboxRow inserts a non-deliverable outbox row.
// delivered_at=now() ensures the relay partial index ignores it
// (WHERE delivered_at IS NULL). rendered_title='suppressed', rendered_body=''.
func insertSuppressionOutboxRow(
	ctx context.Context,
	tx pgx.Tx,
	eventID, recipientUserID uuid.UUID,
	channel domain.Channel,
) (uuid.UUID, error) {
	const q = `
		INSERT INTO notifications_outbox_v2 (
			notifications_outbox_v2_id_event,
			notifications_outbox_v2_id_recipient_user,
			notifications_outbox_v2_channel,
			notifications_outbox_v2_scheduled_for,
			notifications_outbox_v2_rendered_title,
			notifications_outbox_v2_rendered_body,
			notifications_outbox_v2_delivered_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING notifications_outbox_v2_id
	`
	var outboxID uuid.UUID
	err := tx.QueryRow(ctx, q,
		eventID,
		recipientUserID,
		string(channel),
		time.Now().UTC(),     // scheduled_for
		"suppressed",          // rendered_title
		"",                    // rendered_body
		time.Now().UTC(),     // delivered_at = now() → relay skips it
	).Scan(&outboxID)
	return outboxID, err
}

// insertSuppressionAttemptRow appends a delivery_attempts row with status=suppressed.
func insertSuppressionAttemptRow(
	ctx context.Context,
	tx pgx.Tx,
	eventID, outboxID, recipientUserID uuid.UUID,
	channel domain.Channel,
	errorClass, bypassReason string,
) error {
	bypassReasonPtr := (*string)(nil)
	if bypassReason != "" {
		bypassReasonPtr = &bypassReason
	}

	const q = `
		INSERT INTO notifications_delivery_attempts (
			notifications_delivery_attempts_id_event,
			notifications_delivery_attempts_id_outbox,
			notifications_delivery_attempts_id_recipient_user,
			notifications_delivery_attempts_channel,
			notifications_delivery_attempts_attempt_number,
			notifications_delivery_attempts_status,
			notifications_delivery_attempts_bypass_reason,
			notifications_delivery_attempts_error_class
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := tx.Exec(ctx, q,
		eventID,
		outboxID,
		recipientUserID,
		string(channel),
		1, // attempt_number=1 for suppression rows
		"suppressed",
		bypassReasonPtr,
		errorClass,
	)
	return err
}
