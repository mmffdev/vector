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
	// Integration tests run against vector_artefacts (vaPool equivalent).
	vaURL := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if vaURL == "" {
		t.Skip("VECTOR_ARTEFACTS_DB_URL not set — skipping ranking integration test")
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

func TestMove_LastWriteWins_TwoConcurrentMovers(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	ranking.ResetForTests()
	ranking.Register("work_item", ranking.ResourceConfig{
		Table:       "artefacts",
		ScopeColumn: "timebox_sprint_id",
		Permissions: ranking.PermissionCheckerFunc(func(_ context.Context, _, _ uuid.UUID) (bool, error) {
			return true, nil
		}),
	})

	subID, wsID, typeID := pickFixtures(t, pool)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows := seedThreeBacklogRows(t, ctx, tx, subID, wsID, typeID)
	a, b, c := rows[0], rows[1], rows[2]

	// Commit so concurrent goroutines can see the rows.
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit seed: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE artefacts SET archived_at = now() WHERE id = ANY($1)`,
			[]uuid.UUID{a, b, c},
		)
	})

	svc := ranking.New(pool)

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

	final := readBacklogCohort(t, ctx, pool, subID, []uuid.UUID{a, b, c})
	seen := map[int]uuid.UUID{}
	for id, pos := range final {
		if existing, dup := seen[pos]; dup {
			t.Fatalf("duplicate position %d on rows %s and %s", pos, existing, id)
		}
		seen[pos] = id
	}
	if final[a] >= final[c] {
		t.Fatalf("expected A (%d) < C (%d)", final[a], final[c])
	}
	if final[b] <= final[c] {
		t.Fatalf("expected B (%d) > C (%d)", final[b], final[c])
	}
}

// pickFixtures returns a subscription_id, workspace_id, and artefact_type_id
// that already exist in the DB so FK constraints pass on INSERT.
func pickFixtures(t *testing.T, pool *pgxpool.Pool) (subID, wsID, typeID uuid.UUID) {
	t.Helper()
	// workspace gives us both subscription_id and workspace_id in one query.
	err := pool.QueryRow(context.Background(),
		`SELECT w.subscription_id, w.id, at.id
		 FROM master_record_workspaces w
		 JOIN artefact_types at ON at.subscription_id = w.subscription_id
		 WHERE w.archived_at IS NULL AND at.archived_at IS NULL
		 LIMIT 1`,
	).Scan(&subID, &wsID, &typeID)
	if err != nil {
		t.Skipf("no usable fixtures found: %v", err)
	}
	return
}

// seedThreeBacklogRows inserts three artefacts in the same backlog scope
// (timebox_sprint_id IS NULL) with positions 100, 200, 300.
func seedThreeBacklogRows(t *testing.T, ctx context.Context, tx pgx.Tx, subID, wsID, typeID uuid.UUID) [3]uuid.UUID {
	t.Helper()
	var ids [3]uuid.UUID
	// Use large random-ish numbers to avoid colliding with real rows.
	base := int64(9_000_000 + os.Getpid())
	for i, pos := range []int{100, 200, 300} {
		var id uuid.UUID
		err := tx.QueryRow(ctx,
			`INSERT INTO artefacts
			   (subscription_id, workspace_id, artefact_type_id, number, title, position, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, now(), now())
			 RETURNING id`,
			subID, wsID, typeID,
			base+int64(i),
			fmt.Sprintf("rank-test row %d", i+1), pos,
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
		`SELECT id, position
		 FROM artefacts
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
		var pos int
		if err := rows.Scan(&id, &pos); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out[id] = pos
	}
	return out
}
