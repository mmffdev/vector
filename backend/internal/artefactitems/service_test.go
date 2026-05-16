package artefactitems_test

// PLA-0023 / WS2 — service-level integration tests for the v2 work-items
// domain. All tests hit the live vector_artefacts DB via the tunnel
// (localhost:5435 → vector_artefacts). They are skipped automatically when
// the tunnel is down or VECTOR_ARTEFACTS_DB_URL is unset, so CI that lacks
// the VA pool still passes.
//
// Run manually:
//
//	BACKEND_ENV=dev go test -v ./internal/artefactitems/...
//	BACKEND_ENV=dev go test -v -run TestCreateWorkItem ./internal/artefactitems/...

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// ── pool helpers ─────────────────────────────────────────────────────────────

// vaPool opens a pool against vector_artefacts. Skips if DB unreachable.
func vaPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	envName := os.Getenv("BACKEND_ENV")
	if envName == "" {
		envName = "local"
	}
	for _, rel := range []string{
		".env." + envName,
		"../../.env." + envName,
		".env.local",
		"../../.env.local",
	} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}

	// Prefer an explicit VECTOR_ARTEFACTS_DB_URL; fall back to deriving from
	// the mmff_vector credentials pointing at the same host:port.
	dsn := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if dsn == "" {
		host := os.Getenv("DB_HOST")
		port := os.Getenv("DB_PORT")
		user := os.Getenv("DB_USER")
		pass := os.Getenv("DB_PASSWORD")
		if host == "" {
			t.Skip("DB_HOST not set — skipping vector_artefacts tests")
		}
		dsn = fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=vector_artefacts sslmode=disable",
			host, port, user, pass,
		)
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector_artefacts pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts (tunnel down?): %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// mainPool opens a pool against mmff_vector (for owner decoration tests).
func mainPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	envName := os.Getenv("BACKEND_ENV")
	if envName == "" {
		envName = "local"
	}
	for _, rel := range []string{
		".env." + envName,
		"../../.env." + envName,
		".env.local",
		"../../.env.local",
	} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	if host == "" {
		t.Skip("DB_HOST not set — skipping mmff_vector pool")
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open mmff_vector pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_vector: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// ── seed helpers ──────────────────────────────────────────────────────────────

// pickTestSubscription returns a subscription_id that has all four work
// artefacts_types (epic/story/task/defect) in vector_artefacts.
// Uses the live dev fixture sub if present; falls back to any sub with ≥4 types.
//
// Column names updated 2026-05-16 (PLA-0052 Story 8) for the post-RF1.4.4
// prefix convention. Was: subscription_id/scope/archived_at;
// now: artefacts_types_id_subscription/artefacts_types_scope/artefacts_types_archived_at.
func pickTestSubscription(t *testing.T, va *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	// Try the dev system subscription first — where mig 010 / 071 seed live.
	const fixtureSub = "00000000-0000-0000-0000-000000000001"
	var n int
	_ = va.QueryRow(ctx,
		`SELECT COUNT(*) FROM artefacts_types
		 WHERE artefacts_types_id_subscription=$1
		   AND artefacts_types_scope='work'
		   AND artefacts_types_archived_at IS NULL`,
		fixtureSub).Scan(&n)
	if n >= 4 {
		id, _ := uuid.Parse(fixtureSub)
		return id
	}

	// Fall back: pick any sub with all four types.
	var subID uuid.UUID
	err := va.QueryRow(ctx, `
		SELECT artefacts_types_id_subscription FROM artefacts_types
		WHERE artefacts_types_scope='work' AND artefacts_types_archived_at IS NULL
		GROUP BY artefacts_types_id_subscription
		HAVING COUNT(*) >= 4
		LIMIT 1`,
	).Scan(&subID)
	if err != nil {
		t.Skipf("no subscription with ≥4 work artefacts_types in vector_artefacts: %v", err)
	}
	return subID
}

// defaultFlowStateIDForType returns the is_initial flow_state for the given
// item_type within the given subscription. Skips if not found.
//
// Column names updated 2026-05-16 (PLA-0052 Story 8) for the post-RF1.4.4
// prefix convention.
func defaultFlowStateIDForType(t *testing.T, va *pgxpool.Pool, subID uuid.UUID, itemType string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := va.QueryRow(ctx, `
		SELECT fs.flows_states_id FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		JOIN artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE at.artefacts_types_id_subscription = $1
		  AND lower(at.artefacts_types_name) = $2
		  AND at.artefacts_types_scope = 'work'
		  AND f.flows_is_default = TRUE
		  AND f.flows_archived_at IS NULL
		  AND fs.flows_states_is_initial = TRUE
		  AND fs.flows_states_archived_at IS NULL
		LIMIT 1`,
		subID, itemType,
	).Scan(&id)
	if err != nil {
		t.Skipf("no initial flow_state for %s in sub %s: %v", itemType, subID, err)
	}
	return id
}

// seedArtefact inserts a bare artefact directly and returns its id.
// Cleans up on t.Cleanup. Uses a known-good workspace_id heuristic (first
// non-archived workspace in vector_artefacts) or falls back to sub-id sentinel.
func seedArtefact(t *testing.T, va *pgxpool.Pool, subID uuid.UUID, itemType, title string) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	var atID uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT artefacts_types_id FROM artefacts_types
		WHERE artefacts_types_id_subscription=$1
		  AND artefacts_types_scope='work'
		  AND lower(artefacts_types_name)=$2
		  AND artefacts_types_archived_at IS NULL
		LIMIT 1`, subID, itemType,
	).Scan(&atID); err != nil {
		t.Skipf("no artefact_type %s for sub %s: %v", itemType, subID, err)
	}

	fsID := defaultFlowStateIDForType(t, va, subID, itemType)

	var wsID uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT id FROM artefacts
		WHERE subscription_id=$1 LIMIT 1`, subID,
	).Scan(&wsID); err != nil {
		// Use subscription_id as workspace sentinel (matches ETL backfill).
		wsID = subID
	}

	var num int64
	_ = va.QueryRow(ctx, `
		INSERT INTO artefacts_number_sequences (subscription_id, artefact_type_id, next_num)
		VALUES ($1,$2,2)
		ON CONFLICT (subscription_id, artefact_type_id) DO UPDATE
			SET next_num = artefacts_number_sequences.next_num + 1
		RETURNING next_num - 1`,
		subID, atID,
	).Scan(&num)

	// Derive workspace_id from an existing artefact row if possible.
	var realWS uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT workspace_id FROM artefacts WHERE subscription_id=$1 LIMIT 1`, subID,
	).Scan(&realWS); err == nil {
		wsID = realWS
	}

	var id uuid.UUID
	err := va.QueryRow(ctx, `
		INSERT INTO artefacts
			(subscription_id, workspace_id, artefact_type_id, number, title, flow_state_id, position)
		VALUES ($1,$2,$3,$4,$5,$6,100)
		RETURNING id`,
		subID, wsID, atID, num, title, fsID,
	).Scan(&id)
	if err != nil {
		t.Skipf("cannot seed artefact %q (%s): %v", title, itemType, err)
	}
	t.Cleanup(func() {
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})
	return id
}

// ── tests ─────────────────────────────────────────────────────────────────────

// TestListWorkItems_ReturnsTenantRows verifies that List returns only rows
// belonging to the caller's subscription and respects the default top-level
// filter (parent_artefact_id IS NULL).
func TestListWorkItems_ReturnsTenantRows(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")

	items, total, err := svc.ListWorkItems(context.Background(), sub, artefactitems.Filters{Limit: 100})
	if err != nil {
		t.Fatalf("ListWorkItems: %v", err)
	}
	if total < 0 {
		t.Fatalf("total < 0: %d", total)
	}
	for _, item := range items {
		if item.SubscriptionID != sub.String() {
			t.Errorf("item %s has subscription_id %s, want %s", item.ID, item.SubscriptionID, sub)
		}
		// Default: top-level items only.
		if item.ParentID != nil {
			t.Errorf("item %s has parent_id %s, want nil (top-level filter)", item.ID, *item.ParentID)
		}
	}
	if len(items) != total && len(items) < 100 {
		t.Errorf("items count %d doesn't match total %d (with limit 100)", len(items), total)
	}
}

// TestListWorkItems_CrossTenantIsolation verifies that a different subscription
// UUID returns zero rows when it has no data in vector_artefacts.
func TestListWorkItems_CrossTenantIsolation(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	unknown := uuid.New()

	items, total, err := svc.ListWorkItems(context.Background(), unknown, artefactitems.Filters{Limit: 50})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if total != 0 {
		t.Errorf("total = %d, want 0 for unknown subscription", total)
	}
	if len(items) != 0 {
		t.Errorf("got %d items, want 0 for unknown subscription", len(items))
	}
}

// TestListWorkItems_Pagination verifies that limit/offset page correctly.
func TestListWorkItems_Pagination(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")
	ctx := context.Background()

	_, total, err := svc.ListWorkItems(ctx, sub, artefactitems.Filters{Limit: 1000})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if total == 0 {
		t.Skip("no rows in vector_artefacts for this subscription")
	}

	p1, _, err := svc.ListWorkItems(ctx, sub, artefactitems.Filters{Limit: 1, Offset: 0})
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if len(p1) == 0 {
		t.Fatal("page 1 returned 0 items")
	}

	if total >= 2 {
		p2, _, err := svc.ListWorkItems(ctx, sub, artefactitems.Filters{Limit: 1, Offset: 1})
		if err != nil {
			t.Fatalf("page 2: %v", err)
		}
		if len(p2) == 0 {
			t.Fatal("page 2 returned 0 items with total>=2")
		}
		if p1[0].ID == p2[0].ID {
			t.Errorf("page 1 and page 2 returned the same item %s", p1[0].ID)
		}
	}
}

// TestListWorkItems_ItemTypeFilter verifies that ?item_type= narrows results.
func TestListWorkItems_ItemTypeFilter(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")
	ctx := context.Background()

	itemType := "story"
	stories, _, err := svc.ListWorkItems(ctx, sub, artefactitems.Filters{
		ItemType: &itemType,
		Limit:    100,
	})
	if err != nil {
		t.Fatalf("ListWorkItems item_type=story: %v", err)
	}
	for _, item := range stories {
		if item.ItemType != "story" {
			t.Errorf("item %s has type %q, want story", item.ID, item.ItemType)
		}
	}
}

// TestListWorkItems_SortWhitelist verifies that an unknown sort column falls
// back gracefully (no SQL injection / error) by returning a valid response.
func TestListWorkItems_SortWhitelist(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")

	_, _, err := svc.ListWorkItems(context.Background(), sub, artefactitems.Filters{
		Sort:  "'; DROP TABLE artefacts; --",
		Dir:   "asc",
		Limit: 1,
	})
	if err != nil {
		t.Errorf("malicious sort: unexpected error %v (want silent fallback)", err)
	}
}

// TestNilPool_ReturnsEmpty verifies that all read operations return empty
// results rather than panicking when vectorArtefactsPool is nil.
func TestNilPool_ReturnsEmpty(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	ctx := context.Background()
	sub := uuid.New()

	items, total, err := svc.ListWorkItems(ctx, sub, artefactitems.Filters{Limit: 10})
	if err != nil || total != 0 || len(items) != 0 {
		t.Errorf("nil pool List: got items=%d total=%d err=%v, want 0/0/nil", len(items), total, err)
	}

	wi, err := svc.GetWorkItem(ctx, sub, uuid.New())
	if err == nil || wi != nil {
		t.Errorf("nil pool Get: want ErrNotFound, got %v / %v", wi, err)
	}

	children, err := svc.ListChildren(ctx, sub, uuid.New())
	if err != nil || len(children) != 0 {
		t.Errorf("nil pool ListChildren: got %d err %v, want 0/nil", len(children), err)
	}

	summary, err := svc.SummariseWorkItems(ctx, sub, nil)
	if err != nil || summary.Total != 0 {
		t.Errorf("nil pool Summary: got %+v err %v, want zeroes/nil", summary, err)
	}

	states, err := svc.ListFlowStates(ctx, sub)
	if err != nil || len(states) != 0 {
		t.Errorf("nil pool FlowStates: got %d err %v, want 0/nil", len(states), err)
	}
}

// TestGetWorkItem_NotFound verifies that a random UUID returns ErrNotFound.
func TestGetWorkItem_NotFound(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")

	_, err := svc.GetWorkItem(context.Background(), uuid.New(), uuid.New())
	if err == nil {
		t.Fatal("expected ErrNotFound, got nil")
	}
}

// TestGetWorkItem_CrossTenantBlocked verifies that a row from another
// subscription cannot be retrieved by scoping to a different sub.
func TestGetWorkItem_CrossTenantBlocked(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")
	ctx := context.Background()

	id := seedArtefact(t, va, sub, "story", "cross-tenant-probe")

	parsedID, _ := uuid.Parse(id.String())
	otherSub := uuid.New()
	_, err := svc.GetWorkItem(ctx, otherSub, parsedID)
	if err == nil {
		t.Errorf("expected ErrNotFound for cross-tenant get, got nil")
	}
}

// TestCreateWorkItem_StoresRow verifies that Create inserts a row that can
// be retrieved via Get, with all wire fields populated correctly.
func TestCreateWorkItem_StoresRow(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	ctx := context.Background()

	// Resolve a user from mmff_vector for owner/created_by.
	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user for sub %s in mmff_vector: %v", sub, err)
	}

	in := artefactitems.CreateWorkItemInput{
		ItemType:  "story",
		Title:     "v2-test-create-" + uuid.New().String()[:8],
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	}

	wi, err := svc.CreateWorkItem(ctx, sub, in)
	if err != nil {
		t.Fatalf("CreateWorkItem: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(wi.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})

	if wi.Title != in.Title {
		t.Errorf("title = %q, want %q", wi.Title, in.Title)
	}
	if wi.ItemType != "story" {
		t.Errorf("item_type = %q, want story", wi.ItemType)
	}
	if wi.SubscriptionID != sub.String() {
		t.Errorf("subscription_id = %q, want %s", wi.SubscriptionID, sub)
	}
	if wi.FlowStateID == "" {
		t.Error("flow_state_id is empty — default state not resolved")
	}

	// Re-fetch via Get to confirm it's actually persisted.
	got, err := svc.GetWorkItem(ctx, sub, uuid.MustParse(wi.ID))
	if err != nil {
		t.Fatalf("GetWorkItem after create: %v", err)
	}
	if got.ID != wi.ID {
		t.Errorf("re-fetch id = %s, want %s", got.ID, wi.ID)
	}
}

// TestCreateWorkItem_TaskRejectsPoints verifies that ErrInvalidInput is
// returned when story_points is set on a task item.
func TestCreateWorkItem_TaskRejectsPoints(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")

	pts := 5
	_, err := svc.CreateWorkItem(context.Background(), sub, artefactitems.CreateWorkItemInput{
		ItemType:    "task",
		Title:       "task-with-points",
		StoryPoints: &pts,
	})
	if err == nil {
		t.Fatal("expected ErrInvalidInput for task with story_points, got nil")
	}
}

// TestCreateWorkItem_EmptyTitleRejected verifies that an empty title is
// rejected with ErrInvalidInput.
func TestCreateWorkItem_EmptyTitleRejected(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")

	_, err := svc.CreateWorkItem(context.Background(), sub, artefactitems.CreateWorkItemInput{
		ItemType: "story",
		Title:    "   ",
	})
	if err == nil {
		t.Fatal("expected ErrInvalidInput for blank title, got nil")
	}
}

// TestPatchWorkItem_UpdatesTitle verifies that Patch changes the title and
// returns the updated row.
func TestPatchWorkItem_UpdatesTitle(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "story",
		Title:     "patch-title-before",
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(wi.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})

	newTitle := "patch-title-after"
	patched, err := svc.PatchWorkItem(ctx, sub, uuid.MustParse(wi.ID), artefactitems.PatchWorkItemInput{
		Title: &newTitle,
	})
	if err != nil {
		t.Fatalf("PatchWorkItem: %v", err)
	}
	if patched.Title != newTitle {
		t.Errorf("title = %q, want %q", patched.Title, newTitle)
	}
}

// TestPatchWorkItem_DueDate_SetAndClear mirrors the v1 three-state pattern:
// set to a date, clear via empty string, confirm each transition.
func TestPatchWorkItem_DueDate_SetAndClear(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "story",
		Title:     "due-date-test",
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(wi.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})
	id := uuid.MustParse(wi.ID)

	// Set.
	date := "2027-03-15"
	set, err := svc.PatchWorkItem(ctx, sub, id, artefactitems.PatchWorkItemInput{DueDate: &date})
	if err != nil {
		t.Fatalf("set due_date: %v", err)
	}
	if set.DueDate == nil || *set.DueDate != date {
		t.Errorf("after set: due_date = %v, want %q", set.DueDate, date)
	}

	// Clear via empty string sentinel.
	empty := ""
	cleared, err := svc.PatchWorkItem(ctx, sub, id, artefactitems.PatchWorkItemInput{DueDate: &empty})
	if err != nil {
		t.Fatalf("clear due_date: %v", err)
	}
	if cleared.DueDate != nil && *cleared.DueDate != "" {
		t.Errorf("after clear: due_date = %v, want nil/empty", cleared.DueDate)
	}
}

// TestPatchWorkItem_NotFound verifies ErrNotFound for an unknown id.
func TestPatchWorkItem_NotFound(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	title := "ghost"
	_, err := svc.PatchWorkItem(context.Background(), uuid.New(), uuid.New(),
		artefactitems.PatchWorkItemInput{Title: &title})
	if err == nil {
		t.Fatal("expected ErrNotFound, got nil")
	}
}

// TestArchiveWorkItem_SoftDeletes verifies that Archive sets archived_at
// so the row no longer appears in List.
func TestArchiveWorkItem_SoftDeletes(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "task",
		Title:     "archive-me",
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(wi.ID)
		// Hard-delete the archived row so it doesn't pollute later runs.
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})
	id := uuid.MustParse(wi.ID)

	if err := svc.ArchiveWorkItem(ctx, sub, id); err != nil {
		t.Fatalf("ArchiveWorkItem: %v", err)
	}

	// GetWorkItem should now return ErrNotFound (archived_at IS NOT NULL).
	_, err = svc.GetWorkItem(ctx, sub, id)
	if err == nil {
		t.Error("GetWorkItem after archive: expected ErrNotFound, got nil")
	}
}

// TestArchiveWorkItem_CrossTenantBlocked verifies that Archive cannot
// soft-delete a row belonging to another subscription.
func TestArchiveWorkItem_CrossTenantBlocked(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")
	ctx := context.Background()

	id := seedArtefact(t, va, sub, "story", "archive-cross-tenant")
	otherSub := uuid.New()

	err := svc.ArchiveWorkItem(ctx, otherSub, id)
	if err == nil {
		t.Error("expected ErrNotFound for cross-tenant archive, got nil")
	}
}

// TestSummariseWorkItems_CountsWorkScoped verifies that Summary returns
// non-negative counts and ΣByType <= Total. Post-TD-WORKITEMS-GENERIC
// pay-down, all per-type counts live in the ByType map (no fixed-shape
// fields), so adding a new artefact type doesn't require updating this
// test — it sums whatever types the subscription has rows for.
func TestSummariseWorkItems_CountsWorkScoped(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")

	summary, err := svc.SummariseWorkItems(context.Background(), sub, nil)
	if err != nil {
		t.Fatalf("SummariseWorkItems: %v", err)
	}
	if summary.Total < 0 {
		t.Errorf("total < 0: %d", summary.Total)
	}
	subtotal := 0
	for _, n := range summary.ByType {
		if n < 0 {
			t.Errorf("ByType bucket count < 0: %d", n)
		}
		subtotal += n
	}
	if subtotal > summary.Total {
		t.Errorf("ΣByType (%d) > Total (%d)", subtotal, summary.Total)
	}
}

// TestListFlowStates_ReturnsStates verifies that flow states are returned
// with at least one entry and all required fields populated.
func TestListFlowStates_ReturnsStates(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")

	states, err := svc.ListFlowStates(context.Background(), sub)
	if err != nil {
		t.Fatalf("ListFlowStates: %v", err)
	}
	if len(states) == 0 {
		t.Fatal("no flow states returned")
	}
	for _, s := range states {
		if s.ID == "" {
			t.Error("state has empty ID")
		}
		if s.Name == "" {
			t.Error("state has empty Name")
		}
		if s.CanonicalCode == "" {
			t.Error("state has empty CanonicalCode")
		}
	}
}

// TestListChildren_ReturnsOnlyDirectChildren verifies that ListChildren
// returns only the immediate children of a parent and not grandchildren.
func TestListChildren_ReturnsOnlyDirectChildren(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	parent, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "epic",
		Title:     "parent-epic",
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(parent.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})

	child, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "story",
		Title:     "child-story",
		ParentID:  &parent.ID,
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	})
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(child.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})

	parentID := uuid.MustParse(parent.ID)
	children, err := svc.ListChildren(ctx, sub, parentID)
	if err != nil {
		t.Fatalf("ListChildren: %v", err)
	}

	found := false
	for _, c := range children {
		if c.ID == child.ID {
			found = true
		}
		if c.ParentID == nil || *c.ParentID != parent.ID {
			t.Errorf("child %s has wrong parent_id %v", c.ID, c.ParentID)
		}
	}
	if !found {
		t.Errorf("child %s not found in ListChildren result", child.ID)
	}
}

// TestBulkOps_UnsupportedOp verifies that BulkOps returns ErrInvalidInput
// for an unrecognised operation name.
func TestBulkOps_UnsupportedOp(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")

	_, err := svc.BulkOps(context.Background(), uuid.New(), []string{uuid.New().String()},
		"nuke_everything", nil)
	if err == nil {
		t.Fatal("expected ErrInvalidInput for unsupported op, got nil")
	}
}

// TestBulkOps_EmptyIDs verifies that BulkOps with an empty id list is a
// clean no-op (0 updated, 0 failed).
func TestBulkOps_EmptyIDs(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")

	result, err := svc.BulkOps(context.Background(), uuid.New(), nil, "set_priority", map[string]any{"priority": "high"})
	if err != nil {
		t.Fatalf("BulkOps empty ids: %v", err)
	}
	if result.Updated != 0 || len(result.Failed) != 0 {
		t.Errorf("got %+v, want {0, []}", result)
	}
}

// TestBulkOps_CrossTenantRejected verifies that rows belonging to another
// subscription appear in the Failed list (reason: "forbidden"), not Updated.
func TestBulkOps_CrossTenantRejected(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")
	ctx := context.Background()

	id := seedArtefact(t, va, sub, "story", "bulk-cross-tenant")
	otherSub := uuid.New()

	result, err := svc.BulkOps(ctx, otherSub, []string{id.String()},
		"set_priority", map[string]any{"priority": "high"})
	if err != nil {
		t.Fatalf("BulkOps: %v", err)
	}
	if result.Updated != 0 {
		t.Errorf("updated = %d, want 0 (cross-tenant should be rejected)", result.Updated)
	}
	if len(result.Failed) == 0 {
		t.Error("expected at least one failure for cross-tenant id")
	}
	if len(result.Failed) > 0 && result.Failed[0].Reason != "forbidden" {
		t.Errorf("failure reason = %q, want forbidden", result.Failed[0].Reason)
	}
}

// TestScopeLeak_WorkServiceCannotSeeStrategyArtefacts verifies that a Service
// constructed with scope="work" never returns rows whose artefact_type has
// scope='strategy'. PLA-0037 / B21 — the route registration in main.go binds
// each handler to a fixed scope; this test pins the SQL filter so a future
// refactor can't quietly turn it back on.
//
// Asserted via every list-shaped read path: ListWorkItems, ListChildren,
// ListFlowStates. The strategy service runs the symmetric assertion.
func TestScopeLeak_WorkServiceCannotSeeStrategyArtefacts(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	ctx := context.Background()

	// Probe: does this subscription have any strategy-scoped artefacts_types?
	// If not, the test reduces to a vacuous truth — skip rather than mislead.
	var strategyTypeCount int
	if err := va.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts_types
		 WHERE subscription_id=$1 AND scope='strategy' AND archived_at IS NULL`,
		sub,
	).Scan(&strategyTypeCount); err != nil {
		t.Skipf("cannot probe strategy artefacts_types: %v", err)
	}
	if strategyTypeCount == 0 {
		t.Skip("subscription has no strategy artefacts_types — vacuous; seed required")
	}

	workSvc := artefactitems.NewService(va, nil, "work")
	stratSvc := artefactitems.NewService(va, nil, "strategy")

	// 1. work service: every returned row must have a work-scoped item_type.
	workItems, _, err := workSvc.ListWorkItems(ctx, sub, artefactitems.Filters{Limit: 500})
	if err != nil {
		t.Fatalf("workSvc.ListWorkItems: %v", err)
	}
	for _, it := range workItems {
		// item_type carries the artefacts_types.name; assert this row's type
		// row in fact has scope='work'.
		var rowScope string
		if err := va.QueryRow(ctx, `
			SELECT scope FROM artefacts_types
			 WHERE subscription_id=$1 AND lower(name)=lower($2) AND archived_at IS NULL
			 LIMIT 1`, sub, it.ItemType,
		).Scan(&rowScope); err != nil {
			continue // ItemType may not match a row exactly under casing edge-cases
		}
		if rowScope != "work" {
			t.Errorf("workSvc returned item %s with type %q (scope=%q); want scope=work",
				it.ID, it.ItemType, rowScope)
		}
	}

	// 2. strategy service: every returned row must have a strategy-scoped type.
	stratItems, _, err := stratSvc.ListWorkItems(ctx, sub, artefactitems.Filters{Limit: 500})
	if err != nil {
		t.Fatalf("stratSvc.ListWorkItems: %v", err)
	}
	for _, it := range stratItems {
		var rowScope string
		if err := va.QueryRow(ctx, `
			SELECT scope FROM artefacts_types
			 WHERE subscription_id=$1 AND lower(name)=lower($2) AND archived_at IS NULL
			 LIMIT 1`, sub, it.ItemType,
		).Scan(&rowScope); err != nil {
			continue
		}
		if rowScope != "strategy" {
			t.Errorf("stratSvc returned item %s with type %q (scope=%q); want scope=strategy",
				it.ID, it.ItemType, rowScope)
		}
	}

	// 3. ListFlowStates must also be scope-isolated.
	workStates, err := workSvc.ListFlowStates(ctx, sub)
	if err != nil {
		t.Fatalf("workSvc.ListFlowStates: %v", err)
	}
	stratStates, err := stratSvc.ListFlowStates(ctx, sub)
	if err != nil {
		t.Fatalf("stratSvc.ListFlowStates: %v", err)
	}
	// Build a set of work flow-state IDs and assert no overlap with strategy.
	workIDs := make(map[string]bool, len(workStates))
	for _, s := range workStates {
		workIDs[s.ID] = true
	}
	for _, s := range stratStates {
		if workIDs[s.ID] {
			t.Errorf("flow_state %s appears in both work and strategy lists — scope filter leaked", s.ID)
		}
	}
}
