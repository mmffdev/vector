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
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
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
func fabricateUserAndSession(t *testing.T, ctx context.Context, pool *pgxpool.Pool, boundJKT string) (uuid.UUID, uuid.UUID, func()) {
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
	// users_sessions_dpop_jkt is NOT NULL post-Phase-6 (migration 213).
	// The caller's mintDPoPBoundToken helper generates the keypair and
	// passes the thumbprint here, so the row's bound JKT matches the
	// access token's cnf.jkt and the WS handshake DPoP proof — that's
	// what RequireAuth needs to let the upgrade through.
	err = pool.QueryRow(ctx, `
		INSERT INTO users_sessions (
			users_sessions_id_user,
			users_sessions_token_hash,
			users_sessions_expires_at,
			users_sessions_dpop_jkt
		) VALUES ($1, $2, NOW() + INTERVAL '7 days', $3)
		RETURNING users_sessions_id
	`, userID, fmt.Sprintf("test-hash-%s", userID.String()), boundJKT).Scan(&sessionID)
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

// dpopFixture bundles an ECDSA-P256 keypair, its RFC 7638 thumbprint,
// and a minting function that returns a fresh DPoP proof for the given
// HTTP method + URL (with optional access-token ath). Used by the WS
// sweeper tests to produce Phase-6-compliant authenticated handshakes:
// each test generates one fixture, fabricates a session row bound to
// fixture.JKT, signs an access token with the same JKT, then uses
// fixture.MintProof to sign the actual WS handshake URL.
type dpopFixture struct {
	priv      *ecdsa.PrivateKey
	JKT       string
	MintProof func(method, url, accessToken string) string
}

func newDPoPFixture(t *testing.T) *dpopFixture {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa.GenerateKey: %v", err)
	}
	// Pad coordinates to 32 bytes so the JWK canonical form matches
	// what backend/internal/auth/dpop.go ComputeJKT would compute over
	// a browser-generated key.
	pad := func(b []byte) []byte {
		out := make([]byte, 32)
		copy(out[32-len(b):], b)
		return out
	}
	xB64 := base64.RawURLEncoding.EncodeToString(pad(priv.PublicKey.X.Bytes()))
	yB64 := base64.RawURLEncoding.EncodeToString(pad(priv.PublicKey.Y.Bytes()))
	canonical := fmt.Sprintf(`{"crv":"P-256","kty":"EC","x":%q,"y":%q}`, xB64, yB64)
	sum := sha256.Sum256([]byte(canonical))
	jkt := base64.RawURLEncoding.EncodeToString(sum[:])

	mint := func(method, url, accessToken string) string {
		claims := jwt.MapClaims{
			"jti": uuid.NewString(),
			"htm": method,
			"htu": stripURLQuery(url),
			"iat": time.Now().Unix(),
		}
		if accessToken != "" {
			ath := sha256.Sum256([]byte(accessToken))
			claims["ath"] = base64.RawURLEncoding.EncodeToString(ath[:])
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
		tok.Header["typ"] = "dpop+jwt"
		tok.Header["jwk"] = map[string]interface{}{
			"kty": "EC", "crv": "P-256", "x": xB64, "y": yB64,
		}
		signed, err := tok.SignedString(priv)
		if err != nil {
			t.Fatalf("DPoP proof sign: %v", err)
		}
		return signed
	}
	return &dpopFixture{priv: priv, JKT: jkt, MintProof: mint}
}

// stripURLQuery normalises a URL to its scheme://host/path form so
// the htu claim matches what RequireAuth reconstructs (RFC 9449 § 4.3
// requires query-stripped htu).
func stripURLQuery(u string) string {
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		return u[:i]
	}
	return u
}

// wsURLToHTTP converts the ws://host/ws URL the test will dial to the
// http://host/ws form the backend reconstructs for htu validation.
func wsURLToHTTP(wsURL string) string {
	httpURL := strings.Replace(wsURL, "ws://", "http://", 1)
	httpURL = strings.Replace(httpURL, "wss://", "https://", 1)
	return stripURLQuery(httpURL)
}

// dialWithDPoP opens a WebSocket against srvURL with both
// ?access_token= and ?dpop= so the connection completes a
// Phase-6-compliant handshake against the real RequireAuth.
func dialWithDPoP(t *testing.T, ctx context.Context, srvURL, token string, fx *dpopFixture) (*websocket.Conn, error) {
	t.Helper()
	wsBase := "ws" + strings.TrimPrefix(srvURL, "http") + "/ws"
	proof := fx.MintProof(http.MethodGet, wsURLToHTTP(wsBase), token)
	full := wsBase + "?access_token=" + token + "&dpop=" + proof
	conn, _, err := websocket.Dial(ctx, full, nil)
	return conn, err
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

	fx := newDPoPFixture(t)
	userID, sessionID, cleanup := fabricateUserAndSession(t, ctx, pool, fx.JKT)
	defer cleanup()

	// Mint a Phase-6-compliant access token: carries sid AND cnf.jkt
	// matching the session row's bound JKT. RequireAuth's DPoP gate
	// will demand a proof signed by the same key (fx.MintProof) on
	// every request — dialWithDPoP wires that into the WS handshake.
	token, err := auth.SignAccessToken(&roletypes.User{
		ID:             userID,
		SubscriptionID: uuid.New(), // value irrelevant to the sweeper path
		Email:          "ws-sweep@test.local",
	}, sessionID, fx.JKT)
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

	dialCtx, dialCancel := context.WithTimeout(ctx, 5*time.Second)
	defer dialCancel()
	conn, err := dialWithDPoP(t, dialCtx, srv.URL, token, fx)
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

	fx := newDPoPFixture(t)
	userID, sessionID, cleanup := fabricateUserAndSession(t, ctx, pool, fx.JKT)
	defer cleanup()

	token, err := auth.SignAccessToken(&roletypes.User{
		ID:             userID,
		SubscriptionID: uuid.New(),
		Email:          "ws-immediate@test.local",
	}, sessionID, fx.JKT)
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

	dialCtx, dialCancel := context.WithTimeout(ctx, 5*time.Second)
	defer dialCancel()
	conn, err := dialWithDPoP(t, dialCtx, srv.URL, token, fx)
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

// TestWSSessionSweeper_DeletedRowClosesConnection covers the case the
// original sweeper comment dismissed: a users_sessions row deleted out
// from under us (user account deletion via ON DELETE CASCADE, manual
// psql cleanup, or future user-delete endpoint). Pre-fix the sweeper
// silently ignored absent-from-SELECT sids, on the reasoning that
// RequireAuth would 401 the next refresh and the frontend would close
// the WS — but RequireAuth never re-runs on an open WebSocket, and an
// idle subscriber tab never makes the HTTP requests that would trigger
// the close path. Result: the WS stayed open until natural disconnect.
// Post-fix the sweeper treats absent rows as terminated and closes
// with code 4001 (same semantic as a revoked row — the session is
// gone, get the user out).
func TestWSSessionSweeper_DeletedRowClosesConnection(t *testing.T) {
	pool := sweeperTestPool(t)
	defer pool.Close()

	t.Setenv("WS_SESSION_CHECK_INTERVAL", "500ms")
	t.Setenv("JWT_ACCESS_SECRET", sweeperTestSecret)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	fx := newDPoPFixture(t)
	userID, sessionID, cleanup := fabricateUserAndSession(t, ctx, pool, fx.JKT)
	defer cleanup()

	token, err := auth.SignAccessToken(&roletypes.User{
		ID:             userID,
		SubscriptionID: uuid.New(),
		Email:          "ws-deleted@test.local",
	}, sessionID, fx.JKT)
	if err != nil {
		t.Fatalf("SignAccessToken: %v", err)
	}

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

	dialCtx, dialCancel := context.WithTimeout(ctx, 5*time.Second)
	defer dialCancel()
	conn, err := dialWithDPoP(t, dialCtx, srv.URL, token, fx)
	if err != nil {
		t.Fatalf("websocket.Dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	time.Sleep(100 * time.Millisecond)

	// DELETE — not UPDATE — the session row. This is the "out from
	// under us" case the original code's comment dismissed.
	if _, err := pool.Exec(ctx, `DELETE FROM users_sessions WHERE users_sessions_id = $1`, sessionID); err != nil {
		t.Fatalf("DELETE users_sessions: %v", err)
	}

	readCtx, readCancel := context.WithTimeout(ctx, 2*time.Second)
	defer readCancel()
	_, _, readErr := conn.Read(readCtx)
	if readErr == nil {
		t.Fatalf("connection still open after row deletion (sweeper ignored absent sid)")
	}
	var closeErr websocket.CloseError
	if !errors.As(readErr, &closeErr) {
		t.Fatalf("expected websocket.CloseError, got %T: %v", readErr, readErr)
	}
	if closeErr.Code != 4001 {
		t.Fatalf("close code = %d, want 4001 (deleted-row sessions are terminated, same wire semantic as revoked)", closeErr.Code)
	}
}
