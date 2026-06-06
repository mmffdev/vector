package auth

// A1 — integration test pinning the throttled activity-write contract
// against a real vector_artefacts DB. The unit tests in idle_test.go
// pin the pure idle DECISION; this pins the WRITE half of the mechanism:
// touchSessionActivity must advance users_sessions_last_used_at, but only
// once per ~60s window (the throttle that keeps it at ~1 write/min per
// active session). A regression that drops the throttle WHERE clause —
// turning every authenticated request into a row write — would pass the
// unit tests but fail here.
//
// Skips when VECTOR_ARTEFACTS_DB_URL is unset (CI without the tunnel),
// matching the repo's *_integration_test.go convention
// (see internal/ranking/service_integration_test.go).

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func idleTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		if abs, _ := filepath.Abs(rel); abs != "" {
			if _, err := os.Stat(abs); err == nil {
				_ = godotenv.Load(abs)
				break
			}
		}
	}
	vaURL := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if vaURL == "" {
		t.Skip("VECTOR_ARTEFACTS_DB_URL not set — skipping idle activity-write integration test")
	}
	pool, err := pgxpool.New(context.Background(), vaURL)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping DB (tunnel down?): %v", err)
	}
	return pool
}

// insertIdleTestSession creates a users_sessions row with last_used_at
// stamped `staleBy` in the past, and returns its id plus a cleanup func.
// users_sessions_id_user carries a real FK to users (post-merge into
// vector_artefacts), so we attach the session to an existing user read
// from the DB. We never write to the user row — only insert/delete OUR
// own session row — so this respects the human-accounts HARD RULE.
func insertIdleTestSession(t *testing.T, pool *pgxpool.Pool, staleBy time.Duration) (uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()

	var userID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT users_id FROM users LIMIT 1`).Scan(&userID); err != nil {
		t.Skipf("no users row available to attach a test session to: %v", err)
	}

	var sid uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO users_sessions (
			users_sessions_id_user, users_sessions_token_hash,
			users_sessions_expires_at, users_sessions_dpop_jkt,
			users_sessions_last_used_at
		) VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, NOW() - $4::interval)
		RETURNING users_sessions_id
	`,
		userID,
		"idle-test-"+uuid.NewString(),
		"idle-test-jkt",
		staleBy.String(),
	).Scan(&sid)
	if err != nil {
		t.Fatalf("insert test session: %v", err)
	}
	cleanup := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users_sessions WHERE users_sessions_id = $1`, sid)
	}
	return sid, cleanup
}

func lastUsedAt(t *testing.T, pool *pgxpool.Pool, sid uuid.UUID) time.Time {
	t.Helper()
	var ts time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT users_sessions_last_used_at FROM users_sessions WHERE users_sessions_id = $1`, sid,
	).Scan(&ts); err != nil {
		t.Fatalf("read last_used_at: %v", err)
	}
	return ts
}

// A session whose last_used_at is well past the 60s throttle window gets
// advanced by a single touch.
func TestTouchSessionActivity_AdvancesWhenStale(t *testing.T) {
	pool := idleTestPool(t)
	defer pool.Close()
	sid, cleanup := insertIdleTestSession(t, pool, 5*time.Minute)
	defer cleanup()

	before := lastUsedAt(t, pool, sid)
	svc := &Service{Pool: pool}
	svc.touchSessionActivity(context.Background(), sid)
	after := lastUsedAt(t, pool, sid)

	if !after.After(before) {
		t.Errorf("stale session: last_used_at must advance; before=%v after=%v", before, after)
	}
}

// Two touches inside the same 60s window advance last_used_at exactly
// ONCE — the second is throttled out. This is the contract a dropped
// WHERE clause would break.
func TestTouchSessionActivity_ThrottledWithinWindow(t *testing.T) {
	pool := idleTestPool(t)
	defer pool.Close()
	// Stamp it 5s ago — inside the 60s throttle window from the start.
	sid, cleanup := insertIdleTestSession(t, pool, 5*time.Second)
	defer cleanup()

	svc := &Service{Pool: pool}
	before := lastUsedAt(t, pool, sid)
	svc.touchSessionActivity(context.Background(), sid) // within window → no-op
	svc.touchSessionActivity(context.Background(), sid) // within window → no-op
	after := lastUsedAt(t, pool, sid)

	if !after.Equal(before) {
		t.Errorf("within 60s window: last_used_at must NOT advance (throttle); before=%v after=%v", before, after)
	}
}
