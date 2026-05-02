package workitems_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/workitems"
)

// Pins the canonical ORDER BY clause used across every work-items list
// path. The clause is `coalesce(sprint_position, backlog_position)
// NULLS LAST, key_num ASC` and is duplicated in two queries
// (ListWorkItems, ListChildren). If a future refactor swaps the column
// order or drops NULLS LAST, these tests fail and the regression is
// caught before users see scrambled lists.
//
// Tunnel-dependent: skipped if the dev DB is unreachable.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	envName := os.Getenv("BACKEND_ENV")
	if envName == "" {
		envName = "local"
	}
	candidates := []string{
		".env." + envName,
		"../../.env." + envName,
		".env.local",
		"../../.env.local",
	}
	for _, rel := range candidates {
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

// pickAnyUser returns (subscription_id, user_id) for the first user we
// can find. Both columns are needed for FK satisfaction on inserts.
func pickAnyUser(t *testing.T, pool *pgxpool.Pool) (uuid.UUID, uuid.UUID) {
	t.Helper()
	var subID, userID uuid.UUID
	err := pool.QueryRow(context.Background(),
		`SELECT subscription_id, id FROM users WHERE is_active = true LIMIT 1`).
		Scan(&subID, &userID)
	if err != nil {
		t.Skipf("no usable user found: %v", err)
	}
	return subID, userID
}

type seedRow struct {
	title       string
	backlogPos  *int
	sprintPos   *int
	sprintID    *uuid.UUID
	expectOrder int // 0-based position the row should appear at
}

// nextKey allocates a unique key_num for the work_item scope. It uses
// the same subscription_sequence upsert as workitems.Service.CreateWorkItem,
// but first heals the counter past any row that was inserted directly
// (e.g. by a fixture seed) so we never collide on the (subscription_id,
// key_num) unique constraint.
func nextKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, subID uuid.UUID) int64 {
	t.Helper()
	// Heal: advance next_num past MAX(key_num) if rows exist.
	_, _ = pool.Exec(ctx, `
		INSERT INTO subscription_sequence (subscription_id, scope, next_num)
		SELECT $1, 'work_item', coalesce(MAX(key_num), 0) + 1
		FROM o_artefacts_execution_work_items
		WHERE subscription_id = $1
		ON CONFLICT (subscription_id, scope) DO UPDATE
			SET next_num = GREATEST(
				subscription_sequence.next_num,
				EXCLUDED.next_num
			)`,
		subID,
	)
	var n int64
	err := pool.QueryRow(ctx, `
		INSERT INTO subscription_sequence (subscription_id, scope, next_num)
		VALUES ($1, 'work_item', 2)
		ON CONFLICT (subscription_id, scope) DO UPDATE
			SET next_num = subscription_sequence.next_num + 1
		RETURNING next_num - 1`,
		subID,
	).Scan(&n)
	if err != nil {
		t.Fatalf("nextKey: %v", err)
	}
	return n
}

func seedRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, subID, userID uuid.UUID, rows []seedRow) []uuid.UUID {
	t.Helper()
	ids := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		key := nextKey(t, ctx, pool, subID)
		var id uuid.UUID
		err := pool.QueryRow(ctx,
			`INSERT INTO o_artefacts_execution_work_items
			   (subscription_id, key_num, item_type, title, status,
			    owner_id, created_by, backlog_position, sprint_position, sprint_id)
			 VALUES ($1, $2, 'story', $3, 'open',
			         $4, $4, $5, $6, $7)
			 RETURNING id`,
			subID, key, r.title, userID, r.backlogPos, r.sprintPos, r.sprintID,
		).Scan(&id)
		if err != nil {
			t.Fatalf("seed %q: %v", r.title, err)
		}
		ids[i] = id
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE o_artefacts_execution_work_items
			 SET archived_at = now()
			 WHERE id = ANY($1)`, ids)
	})
	return ids
}

// TestListWorkItems_OrderByCanonical seeds three backlog rows with
// out-of-key-order positions and asserts ListWorkItems returns them in
// position order, not key_num order. If the ORDER BY were "key_num
// ASC" alone, this test would fail.
func TestListWorkItems_OrderByCanonical(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)

	// Positions 300, 100, 200 → expected display order is rows[1], rows[2], rows[0].
	pos300, pos100, pos200 := 300, 100, 200
	rows := []seedRow{
		{title: "order-test-A (pos 300)", backlogPos: &pos300, expectOrder: 2},
		{title: "order-test-B (pos 100)", backlogPos: &pos100, expectOrder: 0},
		{title: "order-test-C (pos 200)", backlogPos: &pos200, expectOrder: 1},
	}
	ids := seedRows(t, ctx, pool, subID, userID, rows)

	got, err := svc.ListWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{Limit: 200})
	if err != nil {
		t.Fatalf("ListWorkItems: %v", err)
	}

	// Project the result down to just our seeded rows, preserving order.
	wanted := map[string]int{}
	for i, id := range ids {
		wanted[id.String()] = rows[i].expectOrder
	}
	var observed []string
	for _, w := range got {
		if _, ok := wanted[w.ID]; ok {
			observed = append(observed, w.ID)
		}
	}
	if len(observed) != 3 {
		t.Fatalf("expected 3 seeded rows back, got %d", len(observed))
	}

	// Map each observed position back to expectOrder; the sequence must
	// be 0, 1, 2 (i.e. ascending position).
	for i, id := range observed {
		want := i
		if got := wanted[id]; got != want {
			t.Errorf("row at index %d had expectOrder %d, want %d", i, got, want)
		}
	}
}

// TestListWorkItems_NullsLast confirms that a row with NULL position
// (no backlog_position and no sprint_position) sorts after rows with
// non-NULL positions. Pre-rank-rollout rows are the canonical
// motivation for NULLS LAST; without it a NULL would sort first under
// Postgres defaults.
func TestListWorkItems_NullsLast(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)

	// NULL-position rows are not allowed by the table CHECK in the
	// general case (exactly one of backlog/sprint must be non-NULL),
	// but the schema currently permits NULL/NULL via the partial-index
	// constraint. Insert one such row directly via raw SQL and bypass
	// the API's CreateWorkItem path which auto-populates positions.
	pos500 := 500
	rows := []seedRow{
		{title: "nulls-test-positioned", backlogPos: &pos500},
		{title: "nulls-test-null-pos"}, // both pos columns nil
	}

	// Direct insert that allows NULL/NULL — uses the same column list
	// as seedRows but with explicit NULLs.
	ids := make([]uuid.UUID, 0, 2)
	for _, r := range rows {
		key := nextKey(t, ctx, pool, subID)
		var id uuid.UUID
		err := pool.QueryRow(ctx,
			`INSERT INTO o_artefacts_execution_work_items
			   (subscription_id, key_num, item_type, title, status,
			    owner_id, created_by, backlog_position, sprint_position)
			 VALUES ($1, $2, 'story', $3, 'open',
			         $4, $4, $5, $6)
			 RETURNING id`,
			subID, key, r.title, userID, r.backlogPos, r.sprintPos,
		).Scan(&id)
		if err != nil {
			t.Skipf("cannot seed NULL/NULL row (CHECK rejects?): %v", err)
		}
		ids = append(ids, id)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE o_artefacts_execution_work_items
			 SET archived_at = now()
			 WHERE id = ANY($1)`, ids)
	})

	got, err := svc.ListWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{Limit: 200})
	if err != nil {
		t.Fatalf("ListWorkItems: %v", err)
	}

	var positionedIdx, nullIdx = -1, -1
	for i, w := range got {
		if w.ID == ids[0].String() {
			positionedIdx = i
		}
		if w.ID == ids[1].String() {
			nullIdx = i
		}
	}
	if positionedIdx < 0 || nullIdx < 0 {
		t.Fatalf("rows not found: positioned=%d null=%d", positionedIdx, nullIdx)
	}
	if !(positionedIdx < nullIdx) {
		t.Errorf("expected NULL-position row to sort after positioned row, got positioned=%d null=%d", positionedIdx, nullIdx)
	}
}

// TestListChildren_OrderByCanonical exercises the second ORDER BY
// caller — ListChildren on a parent row. Same contract: positions
// before key_num.
func TestListChildren_OrderByCanonical(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)

	// Seed parent first (no position needed for the parent itself in
	// this test — we only assert child ordering).
	pos1 := 1
	parentIDs := seedRows(t, ctx, pool, subID, userID, []seedRow{
		{title: "children-parent", backlogPos: &pos1},
	})
	parentID := parentIDs[0]

	// Seed three children with out-of-key-order positions.
	posA, posB, posC := 30, 10, 20
	var childIDs []uuid.UUID
	for _, c := range []struct {
		title string
		pos   int
	}{
		{"child-A (pos 30)", posA},
		{"child-B (pos 10)", posB},
		{"child-C (pos 20)", posC},
	} {
		var id uuid.UUID
		p := c.pos
		key := nextKey(t, ctx, pool, subID)
		err := pool.QueryRow(ctx,
			`INSERT INTO o_artefacts_execution_work_items
			   (subscription_id, key_num, item_type, title, status,
			    owner_id, created_by, backlog_position, parent_id)
			 VALUES ($1, $2, 'story', $3, 'open',
			         $4, $4, $5, $6)
			 RETURNING id`,
			subID, key, c.title, userID, p, parentID,
		).Scan(&id)
		if err != nil {
			t.Fatalf("seed child %q: %v", c.title, err)
		}
		childIDs = append(childIDs, id)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE o_artefacts_execution_work_items
			 SET archived_at = now()
			 WHERE id = ANY($1)`, childIDs)
	})

	got, err := svc.ListChildren(ctx, subID.String(), parentID)
	if err != nil {
		t.Fatalf("ListChildren: %v", err)
	}

	if len(got) != 3 {
		t.Fatalf("expected 3 children, got %d", len(got))
	}
	// Expected order: B (pos 10), C (pos 20), A (pos 30) → indices 1, 2, 0
	expected := []uuid.UUID{childIDs[1], childIDs[2], childIDs[0]}
	for i, want := range expected {
		if got[i].ID != want.String() {
			t.Errorf("child at index %d: got %s, want %s", i, got[i].ID, want.String())
		}
	}
}

// Compile-time guard: pgx import is used by helpers above. If pgx is
// removed by a future refactor, we want this file to fail to compile
// rather than silently lose its DB-connectivity preamble.
var _ = pgx.ErrNoRows
