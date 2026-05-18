package realtime

// B16.8.12 — WebSocket session sweeper.
//
// The HTTP path (RequireAuth) re-checks users_sessions on every request:
// any commit setting users_sessions_revoked=TRUE evicts the next call.
// WebSockets run RequireAuth once at upgrade, so without a server-side
// ticker the auth context inside the WS handler is frozen forever.
//
// The sweeper closes that gap. Every WS_SESSION_CHECK_INTERVAL (default
// 30s — matched to docs/c_security.md "Session model — revocation
// timeliness") it:
//
//   1. Snapshots the registry's live sid set under-lock.
//   2. Runs one batched SELECT against users_sessions:
//        WHERE users_sessions_id = ANY($1)
//      — keeps it to a single roundtrip per tick regardless of socket
//      count. Empty snapshot skips the query entirely.
//   3. For each row:
//        - users_sessions_revoked=TRUE  → close with code 4001
//          ("session terminated"), Problem.code session_revoked
//        - NOW() - last_activity > SESSION_IDLE_TTL → close with code
//          4002 ("session idle expired"), Problem.code
//          session_idle_expired
//      last_activity = COALESCE(users_sessions_rotated_at,
//                               users_sessions_created_at) —
//      same column the HTTP path's FindUserBySessionID query uses.
//
// Close codes 4001 / 4002 are in the private 4000–4999 range RFC 6455
// reserves for application use. They sit alongside the existing 4401
// (auth-rejection at upgrade) which lives in the same range.

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// Close codes emitted by the sweeper. Wire-stable — the frontend's
// app/lib/wsClose.ts maps these to hardLogout reasons by exact value,
// and an integration test pins them. Don't renumber.
const (
	WSCloseSessionRevoked     websocket.StatusCode = 4001
	WSCloseSessionIdleExpired websocket.StatusCode = 4002
)

// StartSessionSweeper spawns the registry sweep goroutine. Mirrors
// StartRankListener's shape: one goroutine, exits when ctx is done. The
// caller (main.go) passes the long-lived server context so the sweeper
// dies with the process. Test code can pass a t.Context() that the
// test harness cancels on completion.
func StartSessionSweeper(ctx context.Context, pool *pgxpool.Pool, registry *SessionRegistry) {
	interval := parseDurationEnv("WS_SESSION_CHECK_INTERVAL", 30*time.Second)
	idleTTL := parseDurationEnv("SESSION_IDLE_TTL", 30*time.Minute)

	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				sweepOnce(ctx, pool, registry, idleTTL)
			}
		}
	}()
}

func sweepOnce(ctx context.Context, pool *pgxpool.Pool, registry *SessionRegistry, idleTTL time.Duration) {
	sids := registry.SnapshotSIDs()
	if len(sids) == 0 {
		return
	}

	rows, err := pool.Query(ctx, sqlSelectSessionStatesBatch, sids)
	if err != nil {
		log.Printf("realtime: session sweeper query: %v", err)
		return
	}
	defer rows.Close()

	// Track which snapshot sids the SELECT actually returned. Anything
	// absent at the end has been DELETE'd out from under us (account
	// deletion via ON DELETE CASCADE, manual cleanup, or a future
	// user-delete endpoint) — those sockets need to die the same way a
	// revoked row's would, because RequireAuth NEVER re-runs on an open
	// WebSocket and an idle subscriber will never trigger the HTTP path
	// that would otherwise close them.
	seen := make(map[uuid.UUID]struct{}, len(sids))

	now := time.Now()
	for rows.Next() {
		var sid uuid.UUID
		var revoked bool
		var lastActivity time.Time
		if err := rows.Scan(&sid, &revoked, &lastActivity); err != nil {
			log.Printf("realtime: session sweeper scan: %v", err)
			continue
		}
		seen[sid] = struct{}{}
		switch {
		case revoked:
			registry.CloseSession(sid, WSCloseSessionRevoked, auth.CodeSessionRevoked)
		case now.Sub(lastActivity) > idleTTL:
			registry.CloseSession(sid, WSCloseSessionIdleExpired, auth.CodeSessionIdleExpired)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("realtime: session sweeper rows: %v", err)
		// If the result stream broke mid-iteration we don't know which
		// rows we missed, so skip the absent-sweep this tick rather
		// than mass-closing connections whose rows might be fine.
		return
	}

	for _, sid := range sids {
		if _, ok := seen[sid]; !ok {
			// Deleted-not-revoked: the session is gone, treat it as
			// terminated. Same wire code (4001) as a revoked row —
			// frontend wsClose handler routes both to hardLogout with
			// reason session_revoked.
			registry.CloseSession(sid, WSCloseSessionRevoked, auth.CodeSessionRevoked)
		}
	}
}

// parseDurationEnv mirrors the helper in internal/auth/tokens.go but
// avoids a cross-package dep cycle (auth imports nothing from realtime,
// and we want to keep it that way).
func parseDurationEnv(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}
