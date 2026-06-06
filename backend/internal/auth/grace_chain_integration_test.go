package auth

// B1/B2 — integration test for the grace-window chain-walk against a real
// vector_artefacts DB. The unit tests in grace_chain_test.go pin the pure
// walk; this proves refreshFromSuccessor resolves a 2-hops-stale chain
// end-to-end (the actual TD-AUTH-MULTITAB-STALE-RT-COOKIE repro) AND that
// the DPoP binding check still nukes the family on a wrong-key token
// (the security pin — the walk must not relax theft detection).
//
// Skips when VECTOR_ARTEFACTS_DB_URL is unset, matching the repo's
// *_integration_test.go convention.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/audit"
)

const chainTestSecret = "test-secret-do-not-use-in-prod-do-not-use-in-prod"

// pickIsolatableUser returns a synthetic seed user (@example.com) that
// currently has ZERO non-test sessions, so the wrong-JKT security-pin
// test's family-wide revoke cannot disturb any real session. We never
// modify the user row (HUMAN-ACCOUNTS HARD RULE) — we only attach and
// later delete our own chain-test session rows. Skips if no such user
// exists rather than risking a user with live sessions.
func pickIsolatableUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var userID uuid.UUID
	err := pool.QueryRow(context.Background(), `
		SELECT u.users_id
		  FROM users u
		 WHERE u.users_email LIKE '%@example.com'
		   AND NOT EXISTS (
		         SELECT 1 FROM users_sessions s
		          WHERE s.users_sessions_id_user = u.users_id
		            AND s.users_sessions_revoked = FALSE
		            AND s.users_sessions_token_hash NOT LIKE 'chain-test-%'
		            AND s.users_sessions_token_hash NOT LIKE 'idle-test-%'
		       )
		 LIMIT 1
	`).Scan(&userID)
	if err != nil {
		t.Skipf("no isolatable synthetic user (no live real sessions) available: %v", err)
	}
	return userID
}

// insertChainSession inserts one users_sessions row for the chain fixture
// and returns its token hash. revoked rows carry a successor_hash to the
// next link; the live head has successorHash "".
func insertChainSession(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, jkt string, revoked bool, successorHash string) string {
	t.Helper()
	hash := "chain-test-" + uuid.NewString()
	var succ any
	if successorHash != "" {
		succ = successorHash
	}
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users_sessions (
			users_sessions_id_user, users_sessions_token_hash,
			users_sessions_expires_at, users_sessions_dpop_jkt,
			users_sessions_revoked, users_sessions_rotated_at,
			users_sessions_successor_hash
		) VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4,
		          CASE WHEN $4 THEN NOW() ELSE NULL END, $5)
	`, userID, hash, jkt, revoked, succ)
	if err != nil {
		t.Fatalf("insert chain session: %v", err)
	}
	return hash
}

// buildStaleChain creates O(revoked)→A(revoked)→B(revoked)→C(live), all
// bound to the same jkt and user, mimicking a tab that is several
// rotations behind the live head C. Returns the entry hash the grace path
// receives (A = O's successor) and a cleanup func. Also returns userID.
func buildStaleChain(t *testing.T, pool *pgxpool.Pool, jkt string) (entryHash string, userID uuid.UUID, cleanup func()) {
	t.Helper()
	userID = pickIsolatableUser(t, pool)
	cHash := insertChainSession(t, pool, userID, jkt, false, "")     // live head
	bHash := insertChainSession(t, pool, userID, jkt, true, cHash)   // revoked → C
	aHash := insertChainSession(t, pool, userID, jkt, true, bHash)   // revoked → B (entry)
	hashes := []string{aHash, bHash, cHash}
	cleanup = func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM users_sessions WHERE users_sessions_token_hash = ANY($1)`, hashes)
	}
	return aHash, userID, cleanup
}

// THE BUG REPRO: a 2-hops-stale token (entry A, with A→B both revoked)
// must resolve to the live head C via the chain-walk, returning a valid
// access token — not ErrTokenExpired (the pre-fix behaviour that logged
// out the first tab).
func TestRefreshFromSuccessor_WalksStaleChainToLiveHead(t *testing.T) {
	pool := idleTestPool(t)
	defer pool.Close()
	t.Setenv("JWT_ACCESS_SECRET", chainTestSecret)

	const jkt = "chain-test-jkt-live"
	entry, _, cleanup := buildStaleChain(t, pool, jkt)
	defer cleanup()

	svc := &Service{Pool: pool, Audit: audit.New(pool)}
	res, err := svc.refreshFromSuccessor(context.Background(), entry, "1.2.3.4", "ua", jkt)
	if err != nil {
		t.Fatalf("2-hops-stale token within grace must resolve to live head, got error: %v", err)
	}
	if res == nil || res.AccessToken == "" {
		t.Fatal("expected a re-emitted access token from the live head")
	}
}

// SECURITY PIN: the same stale chain, but the inbound proof carries the
// WRONG jkt. The walk resolves the live head, then the binding check must
// fire — revoke the whole family and return ErrTokenExpired. The walk
// must NOT let a wrong-key holder ride a legitimate chain to a token.
func TestRefreshFromSuccessor_WrongJKTRevokesFamily(t *testing.T) {
	pool := idleTestPool(t)
	defer pool.Close()
	t.Setenv("JWT_ACCESS_SECRET", chainTestSecret)

	const jkt = "chain-test-jkt-bound"
	entry, userID, cleanup := buildStaleChain(t, pool, jkt)
	defer cleanup()

	svc := &Service{Pool: pool, Audit: audit.New(pool)}
	_, err := svc.refreshFromSuccessor(context.Background(), entry, "1.2.3.4", "ua", "ATTACKER-WRONG-JKT")
	if err != ErrTokenExpired {
		t.Fatalf("wrong-JKT stale token must be rejected with ErrTokenExpired, got: %v", err)
	}

	// The family must be revoked — assert the live head C is now revoked.
	var liveCount int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM users_sessions
		   WHERE users_sessions_id_user = $1 AND users_sessions_dpop_jkt = $2
		     AND users_sessions_revoked = FALSE`, userID, jkt,
	).Scan(&liveCount); err != nil {
		t.Fatalf("count live sessions: %v", err)
	}
	if liveCount != 0 {
		t.Errorf("wrong-JKT binding violation must revoke the family; %d live session(s) remain", liveCount)
	}
}

// BOUNDARY: a fully-revoked chain with NO live head returns ErrTokenExpired
// (genuine-reuse handling unchanged — no resurrection of a dead chain).
func TestRefreshFromSuccessor_NoLiveHeadReturnsExpired(t *testing.T) {
	pool := idleTestPool(t)
	defer pool.Close()
	t.Setenv("JWT_ACCESS_SECRET", chainTestSecret)

	const jkt = "chain-test-jkt-dead"
	userID := pickIsolatableUser(t, pool)
	// Two revoked links, no live head: B(revoked)→nowhere, A(revoked)→B.
	bHash := insertChainSession(t, pool, userID, jkt, true, "")
	aHash := insertChainSession(t, pool, userID, jkt, true, bHash)
	defer func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM users_sessions WHERE users_sessions_token_hash = ANY($1)`, []string{aHash, bHash})
	}()

	svc := &Service{Pool: pool, Audit: audit.New(pool)}
	_, err := svc.refreshFromSuccessor(context.Background(), aHash, "1.2.3.4", "ua", jkt)
	if err != ErrTokenExpired {
		t.Fatalf("fully-revoked chain must return ErrTokenExpired, got: %v", err)
	}
}
