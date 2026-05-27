//go:build integration

// Integration test for the v2 relay drain loop.
//
// Requires a live vector_artefacts database. Set DATABASE_URL to a
// pgx-compatible connection string pointing at vector_artefacts, or
// derive it from the individual VA_DB_* env vars that backend/.env.dev
// exports (the test helper buildDSN does this automatically when
// DATABASE_URL is absent).
//
// Run:
//
//	go test -tags integration -run TestRelay ./internal/notifications/v2/relay/
//
// The test creates its own event + recipient + outbox row under a
// synthetic subscription / workspace / user that are rolled back via a
// deferred cleanup. It does NOT require real RabbitMQ — a mockBroker
// captures Publish calls in a slice.
package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/broker"
)

// ---------------------------------------------------------------------------
// Mock broker
// ---------------------------------------------------------------------------

type mockBroker struct {
	mu       sync.Mutex
	calls    []broker.Envelope
	failNext bool
	failErr  error
}

func (m *mockBroker) Publish(_ context.Context, env broker.Envelope) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failNext {
		m.failNext = false
		if m.failErr != nil {
			return m.failErr
		}
		return errors.New("mock publish error")
	}
	m.calls = append(m.calls, env)
	return nil
}

func (m *mockBroker) Consume(_ context.Context, _, _ string, _ broker.Handler) error {
	return nil
}

func (m *mockBroker) Close() error { return nil }

func (m *mockBroker) published() []broker.Envelope {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]broker.Envelope, len(m.calls))
	copy(out, m.calls)
	return out
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// buildDSN constructs a postgres DSN from VA_DB_* env vars when DATABASE_URL
// is not set. This mirrors how backend/.env.dev configures the app.
func buildDSN(t *testing.T) string {
	t.Helper()
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}
	host := envOrDefault("VA_DB_HOST", "localhost")
	port := envOrDefault("VA_DB_PORT", "5435")
	name := envOrDefault("VA_DB_NAME", "vector_artefacts")
	user := envOrDefault("VA_DB_USER", "mmff_dev")
	pass := os.Getenv("VA_DB_PASSWORD")
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", user, pass, host, port, name)
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// openPool opens a pgxpool for tests and registers cleanup.
func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := buildDSN(t)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Fatalf("pool.Ping: %v — is vector_artefacts reachable on %s?", err, dsn)
	}
	t.Cleanup(pool.Close)
	return pool
}

// insertTestFixtures creates a minimal event + recipient + outbox row and
// returns cleanup. All inserts target real tables; the cleanup deletes only
// the rows it created, leaving other data intact.
func insertTestFixtures(t *testing.T, pool *pgxpool.Pool, channel string) (outboxID uuid.UUID, cleanup func()) {
	t.Helper()
	ctx := context.Background()

	// Resolve a real subscription_id, workspace_id, and user_id from
	// the live DB rather than inserting new parent rows. Tests run
	// against the dev DB which always has seeded data.
	var subID, wsID, userID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT subscriptions_id FROM subscriptions LIMIT 1`,
	).Scan(&subID); err != nil {
		t.Fatalf("resolve subscription: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT master_record_workspaces_id FROM master_record_workspaces LIMIT 1`,
	).Scan(&wsID); err != nil {
		t.Fatalf("resolve workspace: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT users_id FROM users LIMIT 1`,
	).Scan(&userID); err != nil {
		t.Fatalf("resolve user: %v", err)
	}

	// Insert a test event.
	eventKey := "relay-test-" + uuid.New().String()
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
		) VALUES ($1, 'test.relay', 'medium', 'direct', $2, $3, $4, true)
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

	// Insert an outbox row scheduled for now.
	if err := pool.QueryRow(ctx, `
		INSERT INTO notifications_outbox_v2 (
		    notifications_outbox_v2_id_event,
		    notifications_outbox_v2_id_recipient_user,
		    notifications_outbox_v2_channel,
		    notifications_outbox_v2_rendered_title,
		    notifications_outbox_v2_rendered_body,
		    notifications_outbox_v2_scheduled_for
		) VALUES ($1, $2, $3, 'Test notification', 'test body', now())
		RETURNING notifications_outbox_v2_id`,
		eventID, userID, channel,
	).Scan(&outboxID); err != nil {
		t.Fatalf("insert outbox row: %v", err)
	}

	cleanup = func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM notifications_outbox_v2 WHERE notifications_outbox_v2_id = $1`, outboxID)
		pool.Exec(bg, `DELETE FROM notifications_event_recipients WHERE notifications_event_recipients_id = $1`, recipID)
		pool.Exec(bg, `DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`, eventID)
	}
	return outboxID, cleanup
}

// queryOutboxRow fetches claimed_at, delivered_at, attempts, last_error for an outbox row.
type outboxState struct {
	ClaimedAt   *time.Time
	DeliveredAt *time.Time
	Attempts    int
	LastError   *string
}

func queryOutboxState(t *testing.T, pool *pgxpool.Pool, outboxID uuid.UUID) outboxState {
	t.Helper()
	var s outboxState
	err := pool.QueryRow(context.Background(), `
		SELECT
		    notifications_outbox_v2_claimed_at,
		    notifications_outbox_v2_delivered_at,
		    notifications_outbox_v2_attempts,
		    notifications_outbox_v2_last_error
		FROM notifications_outbox_v2
		WHERE notifications_outbox_v2_id = $1`, outboxID,
	).Scan(&s.ClaimedAt, &s.DeliveredAt, &s.Attempts, &s.LastError)
	if err != nil {
		t.Fatalf("queryOutboxState: %v", err)
	}
	return s
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestRelayDrainOnce_success inserts one outbox row, runs drainOnce, and
// asserts the mock broker received the envelope and delivered_at is set.
func TestRelayDrainOnce_success(t *testing.T) {
	pool := openPool(t)
	outboxID, cleanup := insertTestFixtures(t, pool, broker.ChannelInApp)
	defer cleanup()

	mb := &mockBroker{}
	relay := NewRelay(pool, mb, nil, WithBatchSize(10), WithTickInterval(time.Hour))

	relay.drainOnce(context.Background())

	// Assert broker received exactly one envelope.
	published := mb.published()
	if len(published) != 1 {
		t.Fatalf("expected 1 published envelope, got %d", len(published))
	}
	env := published[0]

	// RoutingKey must be "test.relay.in_app" (domain=test, action=relay, channel=in_app).
	wantRK := broker.RoutingKey("test", "relay", broker.ChannelInApp)
	if env.RoutingKey != wantRK {
		t.Errorf("routing key: got %q, want %q", env.RoutingKey, wantRK)
	}

	// OutboxID must match our row.
	if env.OutboxID != outboxID.String() {
		t.Errorf("outbox_id: got %q, want %q", env.OutboxID, outboxID.String())
	}

	// Decode payload and verify fields.
	var pl deliveryPayload
	if err := json.Unmarshal(env.Payload, &pl); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if pl.Channel != broker.ChannelInApp {
		t.Errorf("payload channel: got %q, want %q", pl.Channel, broker.ChannelInApp)
	}
	if pl.RenderedTitle != "Test notification" {
		t.Errorf("payload title: got %q", pl.RenderedTitle)
	}

	// Assert database state.
	state := queryOutboxState(t, pool, outboxID)
	if state.DeliveredAt == nil {
		t.Error("expected delivered_at IS NOT NULL after successful drain")
	}
}

// TestRelayDrainOnce_publishFails simulates a broker error and asserts
// the outbox row is un-claimed with attempts incremented.
func TestRelayDrainOnce_publishFails(t *testing.T) {
	pool := openPool(t)
	outboxID, cleanup := insertTestFixtures(t, pool, broker.ChannelInApp)
	defer cleanup()

	mb := &mockBroker{failNext: true, failErr: errors.New("rabbitmq unavailable")}
	relay := NewRelay(pool, mb, nil, WithBatchSize(10), WithTickInterval(time.Hour))

	relay.drainOnce(context.Background())

	// Broker should NOT have stored any successful calls.
	if got := mb.published(); len(got) != 0 {
		t.Errorf("expected 0 published envelopes on failure, got %d", len(got))
	}

	state := queryOutboxState(t, pool, outboxID)
	if state.DeliveredAt != nil {
		t.Error("expected delivered_at IS NULL after failed drain")
	}
	if state.ClaimedAt != nil {
		t.Error("expected claimed_at IS NULL after failed drain (row should be un-claimed for retry)")
	}
	if state.Attempts != 1 {
		t.Errorf("expected attempts=1 after one failure, got %d", state.Attempts)
	}
	if state.LastError == nil || *state.LastError == "" {
		t.Error("expected last_error to be populated after failure")
	}
}
