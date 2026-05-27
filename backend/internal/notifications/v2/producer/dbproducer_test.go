//go:build integration

package producer_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/producer"
)

// testPool returns a *pgxpool.Pool connected to the integration DB.
// Skips the test if DATABASE_URL is not set (swarm not running).
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set — skipping integration test (dev swarm not running)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("pool.Ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// realIDs fetches one subscriptions_id and one users_id from the dev DB.
// Required so we satisfy FK constraints when inserting test events.
func realIDs(t *testing.T, pool *pgxpool.Pool) (subID, userID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx,
		`SELECT subscriptions_id FROM subscriptions LIMIT 1`,
	).Scan(&subID); err != nil {
		t.Fatalf("fetch subscriptions_id: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT users_id FROM users LIMIT 1`,
	).Scan(&userID); err != nil {
		t.Fatalf("fetch users_id: %v", err)
	}
	return
}

// cleanupEvent deletes test events from both tables. Runs as t.Cleanup.
func cleanupEvent(t *testing.T, pool *pgxpool.Pool, eventIDs ...uuid.UUID) {
	t.Helper()
	if len(eventIDs) == 0 {
		return
	}
	ctx := context.Background()
	// event_recipients cascade-deletes on event delete; delete event directly.
	for _, id := range eventIDs {
		if _, err := pool.Exec(ctx,
			`DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`,
			id,
		); err != nil {
			t.Logf("cleanup: delete event %s: %v", id, err)
		}
	}
}

// TestEnqueue_DirectEvent_WritesEventAndRecipient verifies that a direct event
// inserts one row in notifications_events_v2 and one in
// notifications_event_recipients, with resolved_at populated and
// recipient_count=1.
func TestEnqueue_DirectEvent_WritesEventAndRecipient(t *testing.T) {
	pool := testPool(t)
	subID, userID := realIDs(t, pool)

	p := producer.NewDBProducer(pool)
	eventKey := fmt.Sprintf("TestDirectEvent-%s", uuid.NewString())

	ev := domain.Event{
		EventKey:        eventKey,
		Type:            domain.EventType{Domain: "test", Action: "direct"},
		Priority:        domain.PriorityMedium,
		FanoutMode:      domain.FanoutDirect,
		SubscriptionID:  &subID,
		RecipientUserID: &userID,
		SentBySystem:    true,
		Data:            map[string]any{"test": true},
	}

	ctx := context.Background()
	id, err := p.Enqueue(ctx, ev)
	if err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	if id == (uuid.UUID{}) {
		t.Fatal("Enqueue returned zero UUID")
	}
	t.Cleanup(func() { cleanupEvent(t, pool, id) })

	// Assert event row.
	var resolvedAt *time.Time
	var recipientCount *int
	if err := pool.QueryRow(ctx,
		`SELECT notifications_events_v2_resolved_at,
		        notifications_events_v2_recipient_count
		 FROM notifications_events_v2
		 WHERE notifications_events_v2_id = $1`, id,
	).Scan(&resolvedAt, &recipientCount); err != nil {
		t.Fatalf("query event: %v", err)
	}
	if resolvedAt == nil {
		t.Error("resolved_at should be set for direct events")
	}
	if recipientCount == nil || *recipientCount != 1 {
		t.Errorf("recipient_count: want 1, got %v", recipientCount)
	}

	// Assert recipient row.
	var recipientRows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_event_recipients
		 WHERE notifications_event_recipients_id_event = $1`, id,
	).Scan(&recipientRows); err != nil {
		t.Fatalf("count recipients: %v", err)
	}
	if recipientRows != 1 {
		t.Errorf("event_recipients count: want 1, got %d", recipientRows)
	}
}

// TestEnqueue_Idempotent verifies that enqueuing twice with the same
// (subscription_id, event_key) returns the same ID and only one row exists.
func TestEnqueue_Idempotent(t *testing.T) {
	pool := testPool(t)
	subID, userID := realIDs(t, pool)

	p := producer.NewDBProducer(pool)
	eventKey := fmt.Sprintf("TestIdempotent-%s", uuid.NewString())

	ev := domain.Event{
		EventKey:        eventKey,
		Type:            domain.EventType{Domain: "test", Action: "idempotent"},
		Priority:        domain.PriorityLow,
		FanoutMode:      domain.FanoutDirect,
		SubscriptionID:  &subID,
		RecipientUserID: &userID,
		SentBySystem:    true,
	}

	ctx := context.Background()

	id1, err := p.Enqueue(ctx, ev)
	if err != nil {
		t.Fatalf("first Enqueue: %v", err)
	}
	t.Cleanup(func() { cleanupEvent(t, pool, id1) })

	id2, err := p.Enqueue(ctx, ev)
	if err != nil {
		t.Fatalf("second Enqueue: %v", err)
	}

	if id1 != id2 {
		t.Errorf("idempotency: first=%s second=%s — expected same ID", id1, id2)
	}

	// Only one row must exist.
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2
		 WHERE notifications_events_v2_id_subscription = $1
		   AND notifications_events_v2_event_key = $2`,
		subID, eventKey,
	).Scan(&count); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 row, got %d", count)
	}
}

// TestEnqueue_Broadcast_NoRecipientYet verifies that a workspace broadcast
// inserts the event row but leaves recipient_count NULL and writes no
// recipient rows — the broadcast service resolves fan-out separately.
func TestEnqueue_Broadcast_NoRecipientYet(t *testing.T) {
	pool := testPool(t)
	subID, _ := realIDs(t, pool)

	p := producer.NewDBProducer(pool)
	eventKey := fmt.Sprintf("TestBroadcast-%s", uuid.NewString())

	ev := domain.Event{
		EventKey:       eventKey,
		Type:           domain.EventType{Domain: "test", Action: "broadcast"},
		Priority:       domain.PriorityHigh,
		FanoutMode:     domain.FanoutWorkspace,
		SubscriptionID: &subID,
		// WorkspaceID is nullable — leave nil to avoid FK constraint on synthetic ID.
		SentBySystem: true,
	}

	ctx := context.Background()
	id, err := p.Enqueue(ctx, ev)
	if err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	t.Cleanup(func() { cleanupEvent(t, pool, id) })

	// recipient_count must be NULL (unresolved).
	var recipientCount *int
	var resolvedAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT notifications_events_v2_recipient_count,
		        notifications_events_v2_resolved_at
		 FROM notifications_events_v2
		 WHERE notifications_events_v2_id = $1`, id,
	).Scan(&recipientCount, &resolvedAt); err != nil {
		t.Fatalf("query event: %v", err)
	}
	if recipientCount != nil {
		t.Errorf("recipient_count: want NULL for broadcast, got %d", *recipientCount)
	}
	if resolvedAt != nil {
		t.Errorf("resolved_at: want NULL for broadcast, got %v", *resolvedAt)
	}

	// No recipient rows.
	var recRows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_event_recipients
		 WHERE notifications_event_recipients_id_event = $1`, id,
	).Scan(&recRows); err != nil {
		t.Fatalf("count recipients: %v", err)
	}
	if recRows != 0 {
		t.Errorf("expected 0 recipient rows for broadcast, got %d", recRows)
	}
}

// TestEnqueue_ValidationFailure verifies that an invalid event (FanoutDirect
// with nil RecipientUserID) returns an error and writes no rows.
func TestEnqueue_ValidationFailure(t *testing.T) {
	pool := testPool(t)
	subID, _ := realIDs(t, pool)

	p := producer.NewDBProducer(pool)
	eventKey := fmt.Sprintf("TestValidationFail-%s", uuid.NewString())

	ev := domain.Event{
		EventKey:       eventKey,
		Type:           domain.EventType{Domain: "test", Action: "invalid"},
		Priority:       domain.PriorityMedium,
		FanoutMode:     domain.FanoutDirect,
		SubscriptionID: &subID,
		// RecipientUserID intentionally nil — should fail validation
	}

	ctx := context.Background()
	_, err := p.Enqueue(ctx, ev)
	if err == nil {
		t.Fatal("expected validation error, got nil")
	}

	// No rows should be written.
	var count int
	if err2 := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2
		 WHERE notifications_events_v2_event_key = $1`, eventKey,
	).Scan(&count); err2 != nil {
		t.Fatalf("count events: %v", err2)
	}
	if count != 0 {
		t.Errorf("expected 0 rows after validation failure, got %d", count)
	}
}

// TestEnqueueTx_RollbackOnCallerError verifies that if the caller rolls back
// the transaction after EnqueueTx, no rows survive.
func TestEnqueueTx_RollbackOnCallerError(t *testing.T) {
	pool := testPool(t)
	subID, userID := realIDs(t, pool)

	p := producer.NewDBProducer(pool)
	eventKey := fmt.Sprintf("TestTxRollback-%s", uuid.NewString())

	ev := domain.Event{
		EventKey:        eventKey,
		Type:            domain.EventType{Domain: "test", Action: "rollback"},
		Priority:        domain.PriorityMedium,
		FanoutMode:      domain.FanoutDirect,
		SubscriptionID:  &subID,
		RecipientUserID: &userID,
		SentBySystem:    true,
	}

	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}

	_, err = p.EnqueueTx(ctx, tx, ev)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("EnqueueTx: %v", err)
	}

	// Caller rolls back — event must not persist.
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2
		 WHERE notifications_events_v2_event_key = $1`, eventKey,
	).Scan(&count); err != nil {
		t.Fatalf("count events after rollback: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 rows after rollback, got %d", count)
	}
}
