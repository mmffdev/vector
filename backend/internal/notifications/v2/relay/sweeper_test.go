//go:build integration

// Integration test for the v2 stuck-claim sweeper.
//
// Same DATABASE_URL / VA_DB_* wiring as relay_test.go.
//
// Run:
//
//	go test -tags integration -run TestSweeper ./internal/notifications/v2/relay/
package relay

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/broker"
)

// TestSweeperRunOnce_stale inserts an outbox row with claimed_at = 10 minutes
// ago (clearly stale under a 5-minute threshold), runs one sweeper tick, and
// asserts claimed_at is reset to NULL and the stuck-claim marker is appended
// to last_error.
func TestSweeperRunOnce_stale(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()

	// Resolve real parent rows from the dev seed data.
	var subID, wsID, userID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT subscriptions_id FROM subscriptions LIMIT 1`).Scan(&subID); err != nil {
		t.Fatalf("resolve subscription: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT master_record_workspaces_id FROM master_record_workspaces LIMIT 1`).Scan(&wsID); err != nil {
		t.Fatalf("resolve workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT users_id FROM users LIMIT 1`).Scan(&userID); err != nil {
		t.Fatalf("resolve user: %v", err)
	}

	// Insert a test event.
	eventKey := "sweeper-test-stale-" + uuid.New().String()
	var eventID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO notifications_events_v2 (
		    notifications_events_v2_event_key,
		    notifications_events_v2_type,
		    notifications_events_v2_priority,
		    notifications_events_v2_fanout_mode,
		    notifications_events_v2_id_subscription,
		    notifications_events_v2_id_workspace,
		    notifications_events_v2_id_recipient_user,
		    notifications_events_v2_sent_by_system
		) VALUES ($1, 'test.sweeper', 'low', 'direct', $2, $3, $4, true)
		RETURNING notifications_events_v2_id`,
		eventKey, subID, wsID, userID,
	).Scan(&eventID); err != nil {
		t.Fatalf("insert event: %v", err)
	}

	// Insert a recipient row.
	var recipID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO notifications_event_recipients (
		    notifications_event_recipients_id_event,
		    notifications_event_recipients_id_user,
		    notifications_event_recipients_resolved_reason
		) VALUES ($1, $2, 'direct')
		RETURNING notifications_event_recipients_id`,
		eventID, userID,
	).Scan(&recipID); err != nil {
		t.Fatalf("insert recipient: %v", err)
	}

	// Insert outbox row with claimed_at = 10 minutes ago — stale under 5min threshold.
	var outboxID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO notifications_outbox_v2 (
		    notifications_outbox_v2_id_event,
		    notifications_outbox_v2_id_recipient_user,
		    notifications_outbox_v2_channel,
		    notifications_outbox_v2_rendered_title,
		    notifications_outbox_v2_rendered_body,
		    notifications_outbox_v2_scheduled_for,
		    notifications_outbox_v2_claimed_at
		) VALUES ($1, $2, $3, 'Sweeper stale test', '', now(), now() - interval '10 minutes')
		RETURNING notifications_outbox_v2_id`,
		eventID, userID, broker.ChannelInApp,
	).Scan(&outboxID); err != nil {
		t.Fatalf("insert outbox row: %v", err)
	}

	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM notifications_outbox_v2 WHERE notifications_outbox_v2_id = $1`, outboxID)
		pool.Exec(bg, `DELETE FROM notifications_event_recipients WHERE notifications_event_recipients_id = $1`, recipID)
		pool.Exec(bg, `DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`, eventID)
	})

	// Run sweeper with 5-minute stale threshold — our row qualifies (10 min > 5 min).
	sweeper := NewSweeper(pool, nil,
		WithSweeperInterval(time.Hour), // prevent automatic ticking in tests
		WithStaleThreshold(5*time.Minute),
	)
	sweeper.runOnce(ctx)

	// Assert claimed_at IS NULL after sweep.
	state := queryOutboxState(t, pool, outboxID)
	if state.ClaimedAt != nil {
		t.Errorf("expected claimed_at IS NULL after sweep, got %v", *state.ClaimedAt)
	}

	// Assert last_error contains the stuck-claim marker.
	if state.LastError == nil || *state.LastError == "" {
		t.Error("expected last_error to contain stuck-claim marker, got nil/empty")
	} else {
		t.Logf("last_error after sweep: %q", *state.LastError)
	}
}

// TestSweeperRunOnce_fresh inserts an outbox row with claimed_at = 1 minute
// ago (NOT stale under the 5-minute threshold) and asserts the sweeper leaves
// it untouched.
func TestSweeperRunOnce_fresh(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()

	var subID, wsID, userID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT subscriptions_id FROM subscriptions LIMIT 1`).Scan(&subID); err != nil {
		t.Fatalf("resolve subscription: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT master_record_workspaces_id FROM master_record_workspaces LIMIT 1`).Scan(&wsID); err != nil {
		t.Fatalf("resolve workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT users_id FROM users LIMIT 1`).Scan(&userID); err != nil {
		t.Fatalf("resolve user: %v", err)
	}

	// Insert test event.
	eventKey := "sweeper-test-fresh-" + uuid.New().String()
	var eventID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO notifications_events_v2 (
		    notifications_events_v2_event_key,
		    notifications_events_v2_type,
		    notifications_events_v2_priority,
		    notifications_events_v2_fanout_mode,
		    notifications_events_v2_id_subscription,
		    notifications_events_v2_id_workspace,
		    notifications_events_v2_id_recipient_user,
		    notifications_events_v2_sent_by_system
		) VALUES ($1, 'test.sweeper_fresh', 'low', 'direct', $2, $3, $4, true)
		RETURNING notifications_events_v2_id`,
		eventKey, subID, wsID, userID,
	).Scan(&eventID); err != nil {
		t.Fatalf("insert event: %v", err)
	}

	var recipID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO notifications_event_recipients (
		    notifications_event_recipients_id_event,
		    notifications_event_recipients_id_user,
		    notifications_event_recipients_resolved_reason
		) VALUES ($1, $2, 'direct')
		RETURNING notifications_event_recipients_id`,
		eventID, userID,
	).Scan(&recipID); err != nil {
		t.Fatalf("insert recipient: %v", err)
	}

	// Insert outbox row with claimed_at = 1 minute ago — NOT stale under 5min threshold.
	var outboxID uuid.UUID
	var claimedAtBefore time.Time
	if err := pool.QueryRow(ctx, `
		INSERT INTO notifications_outbox_v2 (
		    notifications_outbox_v2_id_event,
		    notifications_outbox_v2_id_recipient_user,
		    notifications_outbox_v2_channel,
		    notifications_outbox_v2_rendered_title,
		    notifications_outbox_v2_rendered_body,
		    notifications_outbox_v2_scheduled_for,
		    notifications_outbox_v2_claimed_at
		) VALUES ($1, $2, $3, 'Sweeper fresh test', '', now(), now() - interval '1 minute')
		RETURNING notifications_outbox_v2_id, notifications_outbox_v2_claimed_at`,
		eventID, userID, broker.ChannelInApp,
	).Scan(&outboxID, &claimedAtBefore); err != nil {
		t.Fatalf("insert outbox row: %v", err)
	}

	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM notifications_outbox_v2 WHERE notifications_outbox_v2_id = $1`, outboxID)
		pool.Exec(bg, `DELETE FROM notifications_event_recipients WHERE notifications_event_recipients_id = $1`, recipID)
		pool.Exec(bg, `DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`, eventID)
	})

	// Run sweeper with 5-minute threshold — our row (1 min) should NOT be touched.
	sweeper := NewSweeper(pool, nil,
		WithSweeperInterval(time.Hour),
		WithStaleThreshold(5*time.Minute),
	)
	sweeper.runOnce(ctx)

	// claimed_at must still be set (row is active, not stale).
	state := queryOutboxState(t, pool, outboxID)
	if state.ClaimedAt == nil {
		t.Error("sweeper reset claimed_at on a non-stale row — threshold guard is broken")
	} else {
		t.Logf("claimed_at preserved: %v (expected, row is only 1 min old)", *state.ClaimedAt)
	}
}
