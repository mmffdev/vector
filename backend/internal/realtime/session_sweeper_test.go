package realtime_test

// B16.8.12 — WS session sweeper integration.
//
// Pins the end-to-end contract that fills the long-lived-connection gap
// B16.8.11's per-request HTTP check left open: an open WebSocket dies
// within WS_SESSION_CHECK_INTERVAL of its users_sessions row being
// revoked. Any future refactor that drops the ticker or breaks the
// register-on-accept path fails this test before merge.
//
// Pattern mirrors backend/internal/ranking/service_integration_test.go:
//   - Skip when the dev DB tunnel is unavailable (no DB_* env).
//   - Each run fabricates a fresh subscription_id + user + session so
//     there is no shared-fixture pollution.
//   - Cleanup is best-effort via DEFER DELETE on the same row.
//
// The test deliberately uses real RequireAuth, a real Pool, a real
// access token with sid, and the realtime.NewHubWithRegistry +
// StartSessionSweeper wiring — the same wiring main.go installs in
// production.

import (
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/realtime"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

const sweeperTestSecret = "test-secret-do-not-use-in-prod-do-not-use-in-prod"

func sweeperTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local", "../../.env.dev"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	name := os.Getenv("DB_NAME")
	user := os.Getenv("DB_USER")
	pass := os.Getenv("DB_PASSWORD")
	if host == "" || port == "" || name == "" {
		t.Skip("DB_HOST/DB_PORT/DB_NAME not set — skipping WS session sweeper integration test")
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, pass, name,
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping DB (tunnel down?): %v", err)
	}
	return pool
}

// fabricateUserAndSession inserts a throwaway user + session row, returns
// (userID, sessionID, cleanup). Cleanup deletes both rows; safe to call
// even if the test failed partway.
func fabricateUserAndSession(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, uuid.UUID, func()) {
	t.Helper()

	// users.subscription_id + users.role_id are non-null in dev; pick any
	// live subscription and any system role so the FKs hold. Match the
	// well-known MMFFDev seed subscription if it exists (id 0…001) to
	// keep the fabrication deterministic across reruns.
	var subID uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM subscriptions WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1`).Scan(&subID)
	if err != nil {
		t.Skipf("no live subscription available for fabrication: %v", err)
	}

	var roleID uuid.UUID
	err = pool.QueryRow(ctx, `SELECT users_roles_id FROM users_roles WHERE users_roles_code = 'grp_team_member' AND users_roles_id_subscription IS NULL LIMIT 1`).Scan(&roleID)
	if err != nil {
		t.Skipf("no fallback role available for fabrication: %v", err)
	}

	userID := uuid.New()
	email := fmt.Sprintf("ws-sweep-%s@test.local", userID.String()[:8])
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, subscription_id, email, password_hash, role, role_id, is_active, auth_method, force_password_change)
		VALUES ($1, $2, $3, '$argon2id$v=19$m=65536,t=3,p=2$dGVzdA$dGVzdA', 'user', $4, TRUE, 'local', FALSE)
	`, userID, subID, email, roleID)
	if err != nil {
		t.Fatalf("INSERT users: %v", err)
	}

	var sessionID uuid.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO users_sessions (
			users_sessions_id_user,
			users_sessions_token_hash,
			users_sessions_expires_at
		) VALUES ($1, $2, NOW() + INTERVAL '7 days')
		RETURNING users_sessions_id
	`, userID, fmt.Sprintf("test-hash-%s", userID.String())).Scan(&sessionID)
	if err != nil {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		t.Fatalf("INSERT users_sessions: %v", err)
	}

	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = pool.Exec(ctx, `DELETE FROM users_sessions WHERE users_sessions_id = $1`, sessionID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}
	return userID, sessionID, cleanup
}

// TestWSSessionSweeper_RevokeClosesConnection is the contract-pin
// integration test: open WS through real RequireAuth, SQL-revoke the
// session, assert the connection closes with code 4001 within
// WS_SESSION_CHECK_INTERVAL + 1s.
func TestWSSessionSweeper_RevokeClosesConnection(t *testing.T) {
	pool := sweeperTestPool(t)
	defer pool.Close()

	// Short sweep interval keeps the test snappy. Defaults to 30s in
	// production; 500ms here so the test completes in ~1s.
	t.Setenv("WS_SESSION_CHECK_INTERVAL", "500ms")
	t.Setenv("JWT_ACCESS_SECRET", sweeperTestSecret)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	userID, sessionID, cleanup := fabricateUserAndSession(t, ctx, pool)
	defer cleanup()

	// Mint a real access token carrying sid.
	token, err := auth.SignAccessToken(&roletypes.User{
		ID:             userID,
		SubscriptionID: uuid.New(), // value irrelevant to the sweeper path
		Email:          "ws-sweep@test.local",
	}, sessionID)
	if err != nil {
		t.Fatalf("SignAccessToken: %v", err)
	}

	// Build the same wiring main.go uses: hub-with-registry + sweeper.
	registry := realtime.NewSessionRegistry()
	hub := realtime.NewHubWithRegistry(registry)
	realtime.StartSessionSweeper(ctx, pool, registry)

	svc := &auth.Service{Pool: pool}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(svc.RequireAuth)
		r.Get("/ws", realtime.ServeWS(hub))
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?access_token=" + token
	dialCtx, dialCancel := context.WithTimeout(ctx, 5*time.Second)
	defer dialCancel()
	conn, _, err := websocket.Dial(dialCtx, wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	// Give the registry a moment to register the new connection. The
	// sweeper snapshot reads under lock; without this the very first
	// sweep can race the post-Accept registration.
	time.Sleep(100 * time.Millisecond)

	if _, err := pool.Exec(ctx, `UPDATE users_sessions SET users_sessions_revoked = TRUE WHERE users_sessions_id = $1`, sessionID); err != nil {
		t.Fatalf("UPDATE users_sessions_revoked: %v", err)
	}

	// Wait for the sweep to close the connection. Budget = interval
	// (500ms) + 1s slack.
	readCtx, readCancel := context.WithTimeout(ctx, 2*time.Second)
	defer readCancel()
	_, _, readErr := conn.Read(readCtx)
	if readErr == nil {
		t.Fatalf("connection still open after revoke + sweep")
	}
	var closeErr websocket.CloseError
	if !errors.As(readErr, &closeErr) {
		t.Fatalf("expected websocket.CloseError, got %T: %v", readErr, readErr)
	}
	if closeErr.Code != 4001 {
		t.Fatalf("close code = %d, want 4001 (session terminated)", closeErr.Code)
	}
}

// TestWSSessionSweeper_ImmediateCloseFiresWithoutWaitingForSweep pins the
// immediate-close path the future B16.8.10 revoke endpoint calls. Bypasses
// the ticker entirely.
func TestWSSessionSweeper_ImmediateCloseFiresWithoutWaitingForSweep(t *testing.T) {
	pool := sweeperTestPool(t)
	defer pool.Close()

	// Interval set high so the only way the WS can die is via the
	// immediate-close path.
	t.Setenv("WS_SESSION_CHECK_INTERVAL", "10m")
	t.Setenv("JWT_ACCESS_SECRET", sweeperTestSecret)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	userID, sessionID, cleanup := fabricateUserAndSession(t, ctx, pool)
	defer cleanup()

	token, err := auth.SignAccessToken(&roletypes.User{
		ID:             userID,
		SubscriptionID: uuid.New(),
		Email:          "ws-immediate@test.local",
	}, sessionID)
	if err != nil {
		t.Fatalf("SignAccessToken: %v", err)
	}

	registry := realtime.NewSessionRegistry()
	hub := realtime.NewHubWithRegistry(registry)
	// Sweeper started but with a 10m interval, so it will not fire.
	realtime.StartSessionSweeper(ctx, pool, registry)

	svc := &auth.Service{Pool: pool}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(svc.RequireAuth)
		r.Get("/ws", realtime.ServeWS(hub))
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?access_token=" + token
	dialCtx, dialCancel := context.WithTimeout(ctx, 5*time.Second)
	defer dialCancel()
	conn, _, err := websocket.Dial(dialCtx, wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	time.Sleep(100 * time.Millisecond)

	// Future B16.8.10 endpoint surface: hub.CloseSession() (or
	// registry.CloseSession via Hub accessor) closes the matching socket
	// synchronously.
	hub.CloseSession(sessionID, 4001, "session terminated")

	readCtx, readCancel := context.WithTimeout(ctx, 1*time.Second)
	defer readCancel()
	_, _, readErr := conn.Read(readCtx)
	if readErr == nil {
		t.Fatalf("connection still open after immediate close")
	}
	var closeErr websocket.CloseError
	if !errors.As(readErr, &closeErr) {
		t.Fatalf("expected websocket.CloseError, got %T: %v", readErr, readErr)
	}
	if closeErr.Code != 4001 {
		t.Fatalf("close code = %d, want 4001", closeErr.Code)
	}
}
