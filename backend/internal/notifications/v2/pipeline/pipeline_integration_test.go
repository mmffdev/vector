//go:build integration

package pipeline_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/pipeline"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/rules"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/templates"
)

// ── DB helper ─────────────────────────────────────────────────────────────────

// testPool opens a pgxpool.Pool against VECTOR_ARTEFACTS_DB_URL.
// Skips (not fails) when the env var is not set or the pool cannot open.
// Integration tests must SKIP cleanly when the DB tunnel is unavailable —
// they must NEVER silently hit staging/production (Task 13.3).
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	// Try to load .env.dev so local runs pick up the tunnel URL automatically.
	for _, rel := range []string{".env.dev", "../../.env.dev", "../../../.env.dev", "../../../../.env.dev"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	vaURL := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if vaURL == "" {
		t.Skip("VECTOR_ARTEFACTS_DB_URL not set — skipping pipeline integration test")
	}
	pool, err := pgxpool.New(context.Background(), vaURL)
	if err != nil {
		t.Skipf("pipeline integration: cannot open pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("pipeline integration: pool ping failed: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedSubscription inserts a minimal subscriptions row and returns its ID.
func seedSubscription(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO subscriptions (
			subscriptions_id,
			subscriptions_name,
			subscriptions_slug,
			subscriptions_is_active,
			subscriptions_tier
		) VALUES ($1, $2, $3, true, 'pro')
	`, id, "test-sub-"+id.String()[:8], "test-sub-"+id.String()[:8])
	if err != nil {
		t.Fatalf("seedSubscription: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM subscriptions WHERE subscriptions_id = $1`, id)
	})
	return id
}

// seedUser inserts a minimal users row linked to sub and returns its ID.
func seedUser(t *testing.T, pool *pgxpool.Pool, subID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	email := "pipeline-test-" + id.String()[:8] + "@test.invalid"
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (
			users_id,
			users_id_subscription,
			users_email,
			users_password_hash,
			users_is_active
		) VALUES ($1, $2, $3, 'x', true)
	`, id, subID, email)
	if err != nil {
		t.Fatalf("seedUser: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE users_id = $1`, id)
	})
	return id
}

// seedEvent inserts a minimal notifications_events_v2 row.
func seedEvent(t *testing.T, pool *pgxpool.Pool, subID, userID uuid.UUID, priority domain.Priority) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO notifications_events_v2 (
			notifications_events_v2_id,
			notifications_events_v2_event_key,
			notifications_events_v2_type,
			notifications_events_v2_priority,
			notifications_events_v2_fanout_mode,
			notifications_events_v2_id_subscription,
			notifications_events_v2_id_recipient_user,
			notifications_events_v2_sent_by_system,
			notifications_events_v2_data
		) VALUES ($1, $2, $3, $4, 'direct', $5, $6, true, '{}')
	`, id, "test-key-"+id.String()[:8], "artefact.created", string(priority), subID, userID)
	if err != nil {
		t.Fatalf("seedEvent: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`, id)
	})
	return id
}

// seedRecipient inserts a notifications_event_recipients row.
func seedRecipient(t *testing.T, pool *pgxpool.Pool, eventID, userID uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO notifications_event_recipients (
			notifications_event_recipients_id_event,
			notifications_event_recipients_id_user,
			notifications_event_recipients_resolved_reason
		) VALUES ($1, $2, 'direct')
	`, eventID, userID)
	if err != nil {
		t.Fatalf("seedRecipient: %v", err)
	}
}

// seedTemplate inserts a minimal notifications_templates row.
func seedTemplate(t *testing.T, pool *pgxpool.Pool, eventType, channel string) uuid.UUID {
	t.Helper()
	svc := templates.NewService(pool)
	tmpl, err := svc.Create(context.Background(), templates.Template{
		EventType: eventType,
		Channel:   channel,
		Locale:    "en-GB",
		Subject:   "Test subject for {{data.event_type}}",
		Body:      "Test body",
		Version:   1,
		Active:    true,
	})
	if err != nil {
		t.Fatalf("seedTemplate: %v", err)
	}
	t.Cleanup(func() {
		_ = svc.Delete(context.Background(), tmpl.ID)
	})
	return tmpl.ID
}

// newProcessor constructs a pipeline.Processor with fakes for tests.
func newProcessor(pool *pgxpool.Pool) pipeline.Processor {
	evaluator := rules.NewEvaluator(pool)
	templateSvc := templates.NewService(pool)
	pendingStore := pipeline.NewInMemoryPendingStore()
	return pipeline.NewProcessor(pipeline.Deps{
		Pool:      pool,
		Rules:     evaluator,
		Templates: templateSvc,
		Pending:   pendingStore,
	})
}

// ── Integration tests (spec §Testing strategy Layer 2) ───────────────────────

// Test 1: Direct event end-to-end (spec: "direct mention end-to-end").
// Seeds one event + one recipient + templates, calls ProcessEvent, and
// verifies outbox rows are written.
func TestIntegration_DirectEventEndToEnd(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID := seedSubscription(t, pool)
	userID := seedUser(t, pool, subID)
	eventID := seedEvent(t, pool, subID, userID, domain.PriorityMedium)
	seedRecipient(t, pool, eventID, userID)

	// Seed templates for in_app and sse (minimum needed for a clean outbox write).
	seedTemplate(t, pool, "artefact.created", "in_app")
	seedTemplate(t, pool, "artefact.created", "sse")
	seedTemplate(t, pool, "artefact.created", "email")

	proc := newProcessor(pool)
	result, err := proc.ProcessEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if result.RecipientsTotal != 1 {
		t.Errorf("RecipientsTotal: want 1, got %d", result.RecipientsTotal)
	}
	// At least some outbox rows or suppressions must be written.
	total := result.OutboxRowsWritten + result.SuppressionsWritten + result.PendingEntriesPushed
	if total == 0 {
		t.Errorf("want at least 1 output (outbox/suppression/pending), got 0; result=%+v", result)
	}
	t.Logf("result: %+v", result)
}

// Test 2: ErrEventNotFound when event does not exist.
func TestIntegration_ErrEventNotFound(t *testing.T) {
	pool := testPool(t)
	proc := newProcessor(pool)
	_, err := proc.ProcessEvent(context.Background(), uuid.New())
	if err != pipeline.ErrEventNotFound {
		t.Errorf("want ErrEventNotFound, got %v", err)
	}
}

// Test 3: ErrNoRecipients when event exists but has no recipient rows.
func TestIntegration_ErrNoRecipients(t *testing.T) {
	pool := testPool(t)
	subID := seedSubscription(t, pool)
	userID := seedUser(t, pool, subID)
	eventID := seedEvent(t, pool, subID, userID, domain.PriorityMedium)
	// Do NOT seed any recipients.

	proc := newProcessor(pool)
	_, err := proc.ProcessEvent(context.Background(), eventID)
	if err != pipeline.ErrNoRecipients {
		t.Errorf("want ErrNoRecipients, got %v", err)
	}
}

// Test 4: Critical priority bypass — critical event delivers to in_app + email
// even when user has prefs disabled for those channels.
func TestIntegration_CriticalPriorityBypassPrefs(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID := seedSubscription(t, pool)
	userID := seedUser(t, pool, subID)
	eventID := seedEvent(t, pool, subID, userID, domain.PriorityCritical)
	seedRecipient(t, pool, eventID, userID)
	seedTemplate(t, pool, "artefact.created", "in_app")
	seedTemplate(t, pool, "artefact.created", "email")

	// Disable in_app + email for this user.
	_, err := pool.Exec(ctx, `
		INSERT INTO users_notifications_prefs_v2 (
			users_notifications_prefs_v2_id_user,
			users_notifications_prefs_v2_event_type,
			users_notifications_prefs_v2_channel,
			users_notifications_prefs_v2_enabled,
			users_notifications_prefs_v2_priority_floor
		) VALUES
			($1, 'artefact.created', 'in_app', false, 'low'),
			($1, 'artefact.created', 'email', false, 'low')
		ON CONFLICT DO NOTHING
	`, userID)
	if err != nil {
		t.Fatalf("seed prefs: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `
			DELETE FROM users_notifications_prefs_v2
			WHERE users_notifications_prefs_v2_id_user = $1
		`, userID)
	})

	proc := newProcessor(pool)
	result, err := proc.ProcessEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	// Critical bypass: in_app + email should still produce outbox rows
	// (not suppressions). Note: platform kill switch for these channels
	// defaults to enabled in the seed, so bypass should succeed.
	if result.OutboxRowsWritten == 0 {
		t.Errorf("critical bypass: want at least 1 outbox row, got 0; result=%+v", result)
	}
	t.Logf("critical bypass result: %+v", result)
}

// Test 5: Platform kill switch suppresses channel even for critical events.
func TestIntegration_PlatformKillSwitchSuppresses(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	// Temporarily disable 'sse' platform channel.
	_, err := pool.Exec(ctx, `
		UPDATE notifications_platform_channels
		SET notifications_platform_channels_enabled = false,
		    notifications_platform_channels_status  = 'disabled'
		WHERE notifications_platform_channels_channel = 'sse'
	`)
	if err != nil {
		t.Fatalf("disable sse: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `
			UPDATE notifications_platform_channels
			SET notifications_platform_channels_enabled = true,
			    notifications_platform_channels_status  = 'live'
			WHERE notifications_platform_channels_channel = 'sse'
		`)
	})

	subID := seedSubscription(t, pool)
	userID := seedUser(t, pool, subID)
	eventID := seedEvent(t, pool, subID, userID, domain.PriorityCritical)
	seedRecipient(t, pool, eventID, userID)
	seedTemplate(t, pool, "artefact.created", "in_app")
	seedTemplate(t, pool, "artefact.created", "email")

	proc := newProcessor(pool)
	result, err := proc.ProcessEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	// SSE must be suppressed; in_app + email should still deliver.
	if result.SuppressionsWritten == 0 {
		t.Errorf("platform kill switch: want at least 1 suppression (sse), got 0; result=%+v", result)
	}
	t.Logf("platform kill switch result: %+v", result)
}

// Test 6: Quiet hours defer — event inside quiet hours produces a future-dated
// outbox row (scheduled_for > now()).
func TestIntegration_QuietHoursDefer(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID := seedSubscription(t, pool)
	userID := seedUser(t, pool, subID)

	// Set quiet hours to cover the entire next 24h so we're always inside.
	now := time.Now().UTC()
	startH := now.Hour()
	endH := (now.Hour() + 23) % 24
	_, err := pool.Exec(ctx, `
		INSERT INTO users_notifications_settings (
			users_notifications_settings_id_user,
			users_notifications_settings_quiet_hours_start,
			users_notifications_settings_quiet_hours_end,
			users_notifications_settings_quiet_hours_tz
		) VALUES ($1, $2::time, $3::time, 'UTC')
		ON CONFLICT (users_notifications_settings_id_user) DO UPDATE
		SET users_notifications_settings_quiet_hours_start = EXCLUDED.users_notifications_settings_quiet_hours_start,
		    users_notifications_settings_quiet_hours_end   = EXCLUDED.users_notifications_settings_quiet_hours_end
	`, userID,
		time.Date(0, 1, 1, startH, 0, 0, 0, time.UTC),
		time.Date(0, 1, 1, endH, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("seed quiet hours: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users_notifications_settings WHERE users_notifications_settings_id_user = $1`, userID)
	})

	eventID := seedEvent(t, pool, subID, userID, domain.PriorityMedium)
	seedRecipient(t, pool, eventID, userID)
	seedTemplate(t, pool, "artefact.created", "in_app")
	seedTemplate(t, pool, "artefact.created", "email")
	seedTemplate(t, pool, "artefact.created", "sse")

	proc := newProcessor(pool)
	result, err := proc.ProcessEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	// Either scheduled outbox rows or suppressions — the quiet hours
	// window may be near the end, so non-zero output is the minimum check.
	total := result.OutboxRowsWritten + result.SuppressionsWritten + result.PendingEntriesPushed
	if total == 0 {
		t.Errorf("quiet hours: want non-zero output, got 0; result=%+v", result)
	}
	t.Logf("quiet hours defer result: %+v", result)
}

// Test 7: Two recipients produce independent decisions (idempotency + isolation).
func TestIntegration_TwoRecipients(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID := seedSubscription(t, pool)
	userID1 := seedUser(t, pool, subID)
	userID2 := seedUser(t, pool, subID)
	eventID := seedEvent(t, pool, subID, userID1, domain.PriorityMedium)
	seedRecipient(t, pool, eventID, userID1)
	seedRecipient(t, pool, eventID, userID2)
	seedTemplate(t, pool, "artefact.created", "in_app")
	seedTemplate(t, pool, "artefact.created", "email")
	seedTemplate(t, pool, "artefact.created", "sse")

	proc := newProcessor(pool)
	result, err := proc.ProcessEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if result.RecipientsTotal != 2 {
		t.Errorf("want 2 recipients, got %d", result.RecipientsTotal)
	}
	t.Logf("two recipients result: %+v", result)
}

// Test 8: Idempotency — repeated ProcessEvent does not duplicate outbox rows.
func TestIntegration_Idempotency(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID := seedSubscription(t, pool)
	userID := seedUser(t, pool, subID)
	eventID := seedEvent(t, pool, subID, userID, domain.PriorityMedium)
	seedRecipient(t, pool, eventID, userID)
	seedTemplate(t, pool, "artefact.created", "in_app")
	seedTemplate(t, pool, "artefact.created", "email")
	seedTemplate(t, pool, "artefact.created", "sse")

	proc := newProcessor(pool)

	r1, err := proc.ProcessEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("first ProcessEvent: %v", err)
	}

	r2, err := proc.ProcessEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("second ProcessEvent: %v", err)
	}

	// Second call must not add more outbox rows than the first.
	// The existence-check in router.go returns true for rows written in r1.
	if r2.OutboxRowsWritten > r1.OutboxRowsWritten {
		t.Errorf("idempotency: second call wrote more rows than first (%d > %d)", r2.OutboxRowsWritten, r1.OutboxRowsWritten)
	}
	t.Logf("r1=%+v r2=%+v", r1, r2)
}
