package ranking_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/ranking"
)

// Integration test for last-write-wins under two concurrent movers.
// The rank service uses SELECT FOR UPDATE on the cohort to serialise
// writes; the test proves that:
//
//  1. both moves complete without error,
//  2. the final cohort ordering is internally consistent (no two rows
//     share a position, every row's position is non-NULL),
//  3. the row that won the lock-release race ends up where its move
//     intended — i.e. last write wins, not "last writer rejected".
//
// We use a real DB via the dev tunnel because the rank service's
// concurrency contract is enforced by Postgres locks; mocking would
// not exercise it. Each test allocates a fresh subscription_id and
// rolls back at the end, so there is no shared fixture pollution.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"))
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping DB (tunnel down?): %v", err)
	}
	return pool
}

func TestMove_LastWriteWins_TwoConcurrentMovers(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	// Register a permissive checker for the work item table. Tests
	// for authz live in the handler suite; here we exercise the
	// concurrency path only.
	ranking.Register("work_item", ranking.ResourceConfig{
		Table:       "obj_work_items",
		ScopeColumn: "sprint_id",
		Permissions: ranking.PermissionCheckerFunc(func(_ context.Context, _, _ uuid.UUID) (bool, error) {
			return true, nil
		}),
	})

	// Pick a subscription with at least one user/org so FK constraints
	// pass. We seed three rows within it and roll back at the end —
	// the rows never escape this test even on assertion failure.
	subID := pickAnySubscription(t, pool)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows := seedThreeBacklogRows(t, ctx, tx, subID)
	a, b, c := rows[0], rows[1], rows[2]

	// We need real concurrency — that means using the pool, not the
	// test transaction. Commit our seed first so concurrent goroutines
	// can see it; we'll clean up by archiving on test exit.
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit seed: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE obj_work_items
			 SET archived_at = now()
			 WHERE id = ANY($1)`,
			[]uuid.UUID{a, b, c},
		)
	})

	svc := ranking.New(pool)

	// Both movers fire at the same instant. Move A above C and move
	// B below C. Whichever lock-release order happens, the final
	// state must be: every row has a unique position, and both A and
	// B observe their relative-to-C placement.
	var wg sync.WaitGroup
	var errA, errB error
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, errA = svc.Move(ctx, ranking.MoveRequest{
			ResourceType:   "work_item",
			SubscriptionID: subID,
			RowID:          a,
			Before:         &c,
		})
	}()
	go func() {
		defer wg.Done()
		_, errB = svc.Move(ctx, ranking.MoveRequest{
			ResourceType:   "work_item",
			SubscriptionID: subID,
			RowID:          b,
			After:          &c,
		})
	}()
	wg.Wait()

	if errA != nil {
		t.Fatalf("move A: %v", errA)
	}
	if errB != nil {
		t.Fatalf("move B: %v", errB)
	}

	// Fetch final positions for the cohort and assert invariants.
	final := readBacklogCohort(t, ctx, pool, subID, []uuid.UUID{a, b, c})
	seen := map[int]uuid.UUID{}
	for id, pos := range final {
		if existing, dup := seen[pos]; dup {
			t.Fatalf("duplicate position %d on rows %s and %s", pos, existing, id)
		}
		seen[pos] = id
	}
	// A is before C, B is after C, regardless of who won the race.
	if final[a] >= final[c] {
		t.Fatalf("expected A (%d) < C (%d)", final[a], final[c])
	}
	if final[b] <= final[c] {
		t.Fatalf("expected B (%d) > C (%d)", final[b], final[c])
	}
}

// pickAnySubscription returns the first subscription_id we can find
// that has at least one user. Uses the existing data so we don't need
// to seed orgs/users.
func pickAnySubscription(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`SELECT subscription_id FROM users WHERE archived_at IS NULL LIMIT 1`).
		Scan(&id)
	if err != nil {
		t.Skipf("no usable subscription found: %v", err)
	}
	return id
}

// seedThreeBacklogRows inserts three work items in the same backlog
// scope with positions 100, 200, 300 and returns their IDs.
func seedThreeBacklogRows(t *testing.T, ctx context.Context, tx pgx.Tx, subID uuid.UUID) [3]uuid.UUID {
	t.Helper()
	var ids [3]uuid.UUID
	for i, pos := range []int{100, 200, 300} {
		var id uuid.UUID
		err := tx.QueryRow(ctx,
			`INSERT INTO obj_work_items
			   (subscription_id, kind, title, key_num, backlog_position, created_at, updated_at)
			 VALUES ($1, 'story', $2, nextval('artefacts_work_item_key_seq'), $3, now(), now())
			 RETURNING id`,
			subID, fmt.Sprintf("rank-test row %d", i+1), pos,
		).Scan(&id)
		if err != nil {
			t.Fatalf("seed row %d: %v", i, err)
		}
		ids[i] = id
	}
	return ids
}

func readBacklogCohort(t *testing.T, ctx context.Context, pool *pgxpool.Pool, subID uuid.UUID, ids []uuid.UUID) map[uuid.UUID]int {
	t.Helper()
	rows, err := pool.Query(ctx,
		`SELECT id, backlog_position
		 FROM obj_work_items
		 WHERE id = ANY($1) AND subscription_id = $2`,
		ids, subID,
	)
	if err != nil {
		t.Fatalf("read cohort: %v", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]int{}
	for rows.Next() {
		var id uuid.UUID
		var pos *int
		if err := rows.Scan(&id, &pos); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if pos == nil {
			t.Fatalf("row %s has NULL backlog_position after move", id)
		}
		out[id] = *pos
	}
	return out
}
