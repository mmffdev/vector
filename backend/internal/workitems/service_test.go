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

// defaultFlowStateID returns the position-1 (default-on-create) flow_state_id
// for the subscription's execution_work_items flow. Direct INSERTs into
// obj_work_items must populate flow_state_id — the trigger
// rejects NULL/cross-tenant values. Mirrors workitems.Service.CreateWorkItem.
func defaultFlowStateID(t *testing.T, ctx context.Context, pool *pgxpool.Pool, subID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		SELECT ft.id FROM obj_flow_tenant ft
		JOIN obj_execution_types ats ON ats.id = ft.system_artefact_type_id
		WHERE ft.subscription_id = $1
		  AND ats.scope_key = 'execution_work_items'
		  AND ft.flow_position = 1
		  AND ft.archived_at IS NULL
		LIMIT 1`, subID).Scan(&id)
	if err != nil {
		t.Fatalf("resolve default flow_state_id: %v", err)
	}
	return id
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
		FROM obj_work_items
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
	flowID := defaultFlowStateID(t, ctx, pool, subID)
	ids := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		key := nextKey(t, ctx, pool, subID)
		var id uuid.UUID
		err := pool.QueryRow(ctx,
			`INSERT INTO obj_work_items
			   (subscription_id, key_num, item_type, title, status, flow_state_id,
			    owner_id, created_by, backlog_position, sprint_position, sprint_id)
			 VALUES ($1, $2, 'story', $3, 'open', $4,
			         $5, $5, $6, $7, $8)
			 RETURNING id`,
			subID, key, r.title, flowID, userID, r.backlogPos, r.sprintPos, r.sprintID,
		).Scan(&id)
		if err != nil {
			t.Fatalf("seed %q: %v", r.title, err)
		}
		ids[i] = id
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE obj_work_items
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

// TestListWorkItems_OwnerFilter seeds two rows with different owner_id
// values and confirms that ListWorkItems + CountWorkItems both narrow to
// the owner_id supplied in ListWorkItemsFilter.OwnerID. PLA-0021/00450 —
// underpins the front-end owner chip in WorkItemsFilterChips.
func TestListWorkItems_OwnerFilter(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)

	// Seed three rows: two owned by userID, one owned by a fresh second
	// user (so we can prove the filter excludes non-matchers).
	otherID := uuid.New()
	// SystemRoleUser UUID — see internal/roles/service.go. role_id is NOT
	// NULL after migration 088; legacy enum `role` is kept until PLA-0007 G4.
	systemRoleUser := uuid.MustParse("00000000-0000-0000-0000-00000000ad10")
	_, err := pool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, role, role_id, is_active, subscription_id)
		 VALUES ($1, $2, '!', 'user', $3, true, $4)
		 ON CONFLICT (id) DO NOTHING`,
		otherID, "owner-filter-"+otherID.String()+"@test.local", systemRoleUser, subID,
	)
	if err != nil {
		t.Skipf("cannot seed second user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, otherID)
	})

	pos1, pos2, pos3 := 1100, 1200, 1300
	rows := []seedRow{
		{title: "owner-filter-A (userID)", backlogPos: &pos1},
		{title: "owner-filter-B (other)", backlogPos: &pos2},
		{title: "owner-filter-C (userID)", backlogPos: &pos3},
	}
	ids := seedRows(t, ctx, pool, subID, userID, rows)

	// Re-owner row B to otherID (seedRows always seeds owner = userID).
	if _, err := pool.Exec(ctx,
		`UPDATE obj_work_items SET owner_id = $1 WHERE id = $2`,
		otherID, ids[1],
	); err != nil {
		t.Fatalf("re-owner: %v", err)
	}

	uid := userID.String()
	got, err := svc.ListWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{
		OwnerID: &uid,
		Limit:   200,
	})
	if err != nil {
		t.Fatalf("ListWorkItems(owner=userID): %v", err)
	}
	for _, w := range got {
		if w.ID == ids[1].String() {
			t.Errorf("row B (owned by other) leaked through OwnerID=userID filter")
		}
	}
	// The two userID-owned seeded rows must be present.
	seen := 0
	for _, w := range got {
		if w.ID == ids[0].String() || w.ID == ids[2].String() {
			seen++
		}
	}
	if seen != 2 {
		t.Errorf("expected 2 userID-owned seeded rows in result, saw %d", seen)
	}

	// Count parity.
	totalUser, err := svc.CountWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{OwnerID: &uid})
	if err != nil {
		t.Fatalf("CountWorkItems(owner=userID): %v", err)
	}
	totalAll, err := svc.CountWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{})
	if err != nil {
		t.Fatalf("CountWorkItems(no filter): %v", err)
	}
	if totalUser >= totalAll {
		t.Errorf("expected owner-filtered count < unfiltered count, got user=%d all=%d", totalUser, totalAll)
	}

	// Other-owner filter must include row B and exclude rows A,C.
	other := otherID.String()
	gotOther, err := svc.ListWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{
		OwnerID: &other,
		Limit:   200,
	})
	if err != nil {
		t.Fatalf("ListWorkItems(owner=other): %v", err)
	}
	hasB := false
	for _, w := range gotOther {
		if w.ID == ids[1].String() {
			hasB = true
		}
		if w.ID == ids[0].String() || w.ID == ids[2].String() {
			t.Errorf("userID-owned row %s leaked through OwnerID=other filter", w.ID)
		}
	}
	if !hasB {
		t.Errorf("row B (owned by other) missing from OwnerID=other result")
	}
}

// TestListWorkItems_SortWhitelist exercises the ORDER BY whitelist
// (PLA-0021/00452): every documented SortKey ("id", "title", "status",
// "priority", "points", "sprint", "due") must produce a successful query,
// and an unknown key must fall back to the default position-ordered
// clause (silently — never interpolated as raw SQL).
func TestListWorkItems_SortWhitelist(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, _ := pickAnyUser(t, pool)
	svc := workitems.New(pool)

	keys := []string{"id", "title", "status", "priority", "points", "sprint", "due"}
	dirs := []string{"asc", "desc"}
	for _, k := range keys {
		for _, d := range dirs {
			f := workitems.ListWorkItemsFilter{Sort: k, Dir: d, Limit: 25}
			if _, err := svc.ListWorkItems(ctx, subID.String(), f); err != nil {
				t.Errorf("ListWorkItems(sort=%s,dir=%s): %v", k, d, err)
			}
		}
	}

	// Unknown key must NOT inject SQL — the safe fallback is the default
	// position-ordered query. We assert the call succeeds and a known key
	// (id) returns the same first-page rows when called twice; if the
	// switch were leaking the raw string into ORDER BY, the unknown sort
	// would either error or scramble the order.
	bogus, err := svc.ListWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{
		Sort:  "title; DROP TABLE users; --",
		Dir:   "asc",
		Limit: 5,
	})
	if err != nil {
		t.Fatalf("unknown sort key should fall back, got error: %v", err)
	}
	defaultRows, err := svc.ListWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{Limit: 5})
	if err != nil {
		t.Fatalf("default ListWorkItems: %v", err)
	}
	if len(bogus) != len(defaultRows) {
		t.Fatalf("unknown sort length=%d, default length=%d", len(bogus), len(defaultRows))
	}
	for i := range bogus {
		if bogus[i].ID != defaultRows[i].ID {
			t.Errorf("unknown sort changed row order at i=%d: bogus=%s default=%s",
				i, bogus[i].ID, defaultRows[i].ID)
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
	flowID := defaultFlowStateID(t, ctx, pool, subID)
	ids := make([]uuid.UUID, 0, 2)
	for _, r := range rows {
		key := nextKey(t, ctx, pool, subID)
		var id uuid.UUID
		err := pool.QueryRow(ctx,
			`INSERT INTO obj_work_items
			   (subscription_id, key_num, item_type, title, status, flow_state_id,
			    owner_id, created_by, backlog_position, sprint_position)
			 VALUES ($1, $2, 'story', $3, 'open', $4,
			         $5, $5, $6, $7)
			 RETURNING id`,
			subID, key, r.title, flowID, userID, r.backlogPos, r.sprintPos,
		).Scan(&id)
		if err != nil {
			t.Skipf("cannot seed NULL/NULL row (CHECK rejects?): %v", err)
		}
		ids = append(ids, id)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE obj_work_items
			 SET archived_at = now()
			 WHERE id = ANY($1)`, ids)
	})

	// Limit is large enough to span the dev fixture's full work-item set —
	// the null-position row sorts last under NULLS LAST, so a small limit
	// would page it out before the assertion.
	got, err := svc.ListWorkItems(ctx, subID.String(), workitems.ListWorkItemsFilter{Limit: 10000})
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
		t.Fatalf("rows not found: positioned=%d null=%d (total returned=%d)", positionedIdx, nullIdx, len(got))
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
	flowID := defaultFlowStateID(t, ctx, pool, subID)
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
			`INSERT INTO obj_work_items
			   (subscription_id, key_num, item_type, title, status, flow_state_id,
			    owner_id, created_by, backlog_position, parent_id)
			 VALUES ($1, $2, 'story', $3, 'open', $4,
			         $5, $5, $6, $7)
			 RETURNING id`,
			subID, key, c.title, flowID, userID, p, parentID,
		).Scan(&id)
		if err != nil {
			t.Fatalf("seed child %q: %v", c.title, err)
		}
		childIDs = append(childIDs, id)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE obj_work_items
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

// TestRollupPoints_SumsDescendants seeds an epic → story → story tree
// where the two leaf stories have 3 points each, and asserts the epic's
// RollupPoints comes back as 6. Also confirms the rollup overrides the
// epic's own manually-entered story_points value (per product rule:
// rollup wins once any descendant exists).
func TestRollupPoints_SumsDescendants(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)

	// Insert epic with manual story_points=99 and two leaf-story children
	// with 3 points each. The epic's RollupPoints must equal 6, not 99.
	flowID := defaultFlowStateID(t, ctx, pool, subID)
	epicKey := nextKey(t, ctx, pool, subID)
	pos := 1
	manual := 99
	var epicID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO obj_work_items
		  (subscription_id, key_num, item_type, title, status, flow_state_id,
		   owner_id, created_by, backlog_position, story_points)
		VALUES ($1, $2, 'epic', 'rollup-epic', 'open', $3,
		        $4, $4, $5, $6)
		RETURNING id`,
		subID, epicKey, flowID, userID, pos, manual,
	).Scan(&epicID)
	if err != nil {
		t.Fatalf("seed epic: %v", err)
	}

	childIDs := make([]uuid.UUID, 0, 2)
	for i, label := range []string{"rollup-story-A", "rollup-story-B"} {
		key := nextKey(t, ctx, pool, subID)
		p := i + 1
		pts := 3
		var id uuid.UUID
		if err := pool.QueryRow(ctx, `
			INSERT INTO obj_work_items
			  (subscription_id, key_num, item_type, title, status, flow_state_id,
			   owner_id, created_by, backlog_position, parent_id, story_points)
			VALUES ($1, $2, 'story', $3, 'open', $4,
			        $5, $5, $6, $7, $8)
			RETURNING id`,
			subID, key, label, flowID, userID, p, epicID, pts,
		).Scan(&id); err != nil {
			t.Fatalf("seed child %s: %v", label, err)
		}
		childIDs = append(childIDs, id)
	}
	t.Cleanup(func() {
		all := append([]uuid.UUID{epicID}, childIDs...)
		_, _ = pool.Exec(context.Background(),
			`UPDATE obj_work_items SET archived_at = now() WHERE id = ANY($1)`, all)
	})

	wi, err := svc.GetWorkItem(ctx, subID.String(), epicID)
	if err != nil {
		t.Fatalf("GetWorkItem epic: %v", err)
	}
	if wi.RollupPoints == nil {
		t.Fatalf("expected RollupPoints to be set on epic with children, got nil")
	}
	if *wi.RollupPoints != 6 {
		t.Errorf("epic RollupPoints = %d, want 6", *wi.RollupPoints)
	}
	// Manual value is preserved in DB but shadowed by rollup on the wire — confirm both.
	if wi.StoryPoints == nil || *wi.StoryPoints != 99 {
		t.Errorf("epic StoryPoints = %v, want 99 (manual value preserved)", wi.StoryPoints)
	}

	// Leaf stories with no children should have RollupPoints == nil so
	// the UI falls back to the manually-entered story_points.
	leaf, err := svc.GetWorkItem(ctx, subID.String(), childIDs[0])
	if err != nil {
		t.Fatalf("GetWorkItem leaf: %v", err)
	}
	if leaf.RollupPoints != nil {
		t.Errorf("leaf RollupPoints = %v, want nil (no children)", *leaf.RollupPoints)
	}
}

// TestPatchWorkItem_RejectsPointsOnTask confirms the service refuses a
// story_points patch when the row is a task. Stories, epics, and defects
// must continue to accept the same patch.
func TestPatchWorkItem_RejectsPointsOnTask(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)

	// Seed one row of each type. Tasks need a parent (FK chain via
	// migration 063 XOR), so create a parent story first.
	flowID := defaultFlowStateID(t, ctx, pool, subID)
	pos := 1
	parentKey := nextKey(t, ctx, pool, subID)
	var parentID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO obj_work_items
		  (subscription_id, key_num, item_type, title, status, flow_state_id,
		   owner_id, created_by, backlog_position)
		VALUES ($1, $2, 'story', 'task-parent', 'open', $3,
		        $4, $4, $5)
		RETURNING id`,
		subID, parentKey, flowID, userID, pos,
	).Scan(&parentID); err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	type tc struct {
		itemType   string
		parent     *uuid.UUID
		shouldFail bool
	}
	cases := []tc{
		{"task", &parentID, true},
		{"story", nil, false},
		{"defect", &parentID, false},
		{"epic", nil, false},
	}

	ids := []uuid.UUID{parentID}
	defer func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE obj_work_items SET archived_at = now() WHERE id = ANY($1)`, ids)
	}()

	for _, c := range cases {
		key := nextKey(t, ctx, pool, subID)
		var id uuid.UUID
		if err := pool.QueryRow(ctx, `
			INSERT INTO obj_work_items
			  (subscription_id, key_num, item_type, title, status, flow_state_id,
			   owner_id, created_by, backlog_position, parent_id)
			VALUES ($1, $2, $3, $4, 'open', $5,
			        $6, $6, $7, $8)
			RETURNING id`,
			subID, key, c.itemType, "points-gate-"+c.itemType, flowID, userID, key, c.parent,
		).Scan(&id); err != nil {
			t.Fatalf("seed %s: %v", c.itemType, err)
		}
		ids = append(ids, id)

		pts := 5
		_, err := svc.PatchWorkItem(ctx, subID.String(), id, workitems.PatchWorkItemInput{
			StoryPoints: &pts,
		})
		if c.shouldFail {
			if err == nil {
				t.Errorf("%s: expected ErrInvalidInput, got nil", c.itemType)
			}
		} else {
			if err != nil {
				t.Errorf("%s: expected success, got %v", c.itemType, err)
			}
		}
	}
}

// Compile-time guard: pgx import is used by helpers above. If pgx is
// removed by a future refactor, we want this file to fail to compile
// rather than silently lose its DB-connectivity preamble.
var _ = pgx.ErrNoRows
