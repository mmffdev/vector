package workitems_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/workitems"
)

// PLA-0021 / 00456 — handler-level coverage for POST /api/work-items/bulk.
// Exercises the route end-to-end through chi so the registration order
// (`/bulk` before `/{id}`) and the request/response wire shapes are
// verified together. Reuses the testPool / pickAnyUser / seedRows /
// defaultFlowStateID / nextKey helpers from service_test.go.

// bulkRouter mounts the handler against a minimal chi router with a
// withUser middleware that injects the supplied User into the request
// context — matches what auth.RequireAuth does in production but skips
// the JWT round-trip.
func bulkRouter(h *workitems.Handler, u *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := auth.WithUserForTest(req.Context(), u)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	// Same registration order as cmd/server/main.go — /bulk before /{id}.
	r.Post("/api/work-items/bulk", h.Bulk)
	return r
}

// secondFlowStateID returns the position-2 flow_state for the
// subscription's execution_work_items flow. Used as the target state
// in the success test; differs from the seeded default (position 1)
// so the assertion is meaningful.
func secondFlowStateID(t *testing.T, ctx context.Context, pool *pgxpool.Pool, subID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		SELECT ft.id FROM obj_flow_tenant ft
		JOIN obj_execution_types ats ON ats.id = ft.system_artefact_type_id
		WHERE ft.subscription_id = $1
		  AND ats.scope_key = 'execution_work_items'
		  AND ft.flow_position = 2
		  AND ft.archived_at IS NULL
		LIMIT 1`, subID).Scan(&id)
	if err != nil {
		t.Skipf("no position-2 flow_state for sub %s: %v", subID, err)
	}
	return id
}

// pickSecondTenant returns (subscription_id, user_id) for any active
// user belonging to a *different* subscription than excludeSub. If no
// second tenant exists, it ensure-creates a synthetic one (subscription
// + active user + backfilled flow_tenant rows) so the cross-tenant
// guard test always has something to point at. Cleans up via t.Cleanup.
func pickSecondTenant(t *testing.T, pool *pgxpool.Pool, excludeSub uuid.UUID) (uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	var subID, userID uuid.UUID
	err := pool.QueryRow(ctx,
		`SELECT subscription_id, id FROM users
		 WHERE is_active = true AND subscription_id != $1
		 LIMIT 1`, excludeSub).Scan(&subID, &userID)
	if err == nil {
		return subID, userID
	}

	// No second tenant — synthesise one. Use a deterministic-looking
	// suffix so accidental rerun does not collide on slug uniqueness.
	subID = uuid.New()
	slug := "bulk-xtenant-" + subID.String()[:8]
	if _, err := pool.Exec(ctx,
		`INSERT INTO subscriptions (id, name, slug, is_active)
		 VALUES ($1, $2, $3, true)`,
		subID, "Bulk Cross-Tenant Test "+slug, slug,
	); err != nil {
		t.Skipf("cannot create synthetic second subscription: %v", err)
	}
	t.Cleanup(func() {
		// best-effort cleanup; FK chain (users → work_items → flow_tenant)
		// resolves naturally via cascade or our own deletes below.
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM obj_work_items WHERE subscription_id = $1`, subID)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM obj_flow_tenant WHERE subscription_id = $1`, subID)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM users WHERE subscription_id = $1`, subID)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM subscription_sequence WHERE subscription_id = $1`, subID)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM subscriptions WHERE id = $1`, subID)
	})

	// Backfill flow_tenant rows from obj_flow_system for the new sub —
	// mirrors migration 118 exactly. Without this seedRows would fail
	// because there's no default flow_state to point at.
	if _, err := pool.Exec(ctx, `
		INSERT INTO obj_flow_tenant
		    (subscription_id, system_artefact_type_id, flow_position, name, canonical_code, description)
		SELECT $1, fs.system_artefact_type_id, fs.flow_position, fs.name, fs.canonical_code, fs.description
		FROM   obj_flow_system fs
		ON CONFLICT DO NOTHING`, subID); err != nil {
		t.Skipf("cannot backfill flow_tenant for synthetic sub: %v", err)
	}

	// SystemRoleUser UUID — see internal/roles/service.go. Same const
	// the existing TestListWorkItems_OwnerFilter uses.
	systemRoleUser := uuid.MustParse("00000000-0000-0000-0000-00000000ad10")
	userID = uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, role, role_id, is_active, subscription_id)
		 VALUES ($1, $2, '!', 'user', $3, true, $4)`,
		userID, "bulk-xtenant-"+userID.String()+"@test.local", systemRoleUser, subID,
	); err != nil {
		t.Skipf("cannot create synthetic second-tenant user: %v", err)
	}
	return subID, userID
}

// TestBulk_AllSuccessSetStatus seeds 5 rows under tenant T1 with the
// default (position-1) flow_state, then POSTs op=set_status with the
// position-2 id. Expects 200, {updated:5, failed:[]}, and the 5 rows'
// flow_state_id column to equal F2 after the call.
func TestBulk_AllSuccessSetStatus(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	fs2 := secondFlowStateID(t, ctx, pool, subID)
	svc := workitems.New(pool)
	h := workitems.NewHandler(svc)

	// 5 rows, owned by T1, all default flow_state (F1).
	rows := []seedRow{
		{title: "bulk-success-A"},
		{title: "bulk-success-B"},
		{title: "bulk-success-C"},
		{title: "bulk-success-D"},
		{title: "bulk-success-E"},
	}
	pos := 9000
	for i := range rows {
		p := pos + i*100
		rows[i].backlogPos = &p
	}
	ids := seedRows(t, ctx, pool, subID, userID, rows)
	idStrs := make([]string, len(ids))
	for i, id := range ids {
		idStrs[i] = id.String()
	}

	body, _ := json.Marshal(map[string]any{
		"ids":     idStrs,
		"op":      "set_status",
		"payload": map[string]any{"flow_state_id": fs2.String()},
	})
	user := &models.User{ID: userID, SubscriptionID: subID, IsActive: true}
	srv := httptest.NewServer(bulkRouter(h, user))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/work-items/bulk", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var got workitems.BulkOpResult
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Updated != 5 {
		t.Errorf("updated: want 5, got %d", got.Updated)
	}
	if len(got.Failed) != 0 {
		t.Errorf("failed: want empty, got %+v", got.Failed)
	}

	// Re-read each row directly and confirm flow_state_id flipped to F2.
	for _, id := range ids {
		var fsID uuid.UUID
		if err := pool.QueryRow(ctx,
			`SELECT flow_state_id FROM obj_work_items WHERE id = $1`, id,
		).Scan(&fsID); err != nil {
			t.Errorf("re-read %s: %v", id, err)
			continue
		}
		if fsID != fs2 {
			t.Errorf("row %s flow_state_id = %s, want %s", id, fsID, fs2)
		}
	}
}

// TestBulk_PartialFailureCrossTenant seeds 4 rows under tenant T1 + 1
// row under tenant T2, then POSTs op=set_status as a T1 user with all
// 5 ids in the batch. Expects 200, updated:4, the T2 id present in
// failed[] with reason="forbidden", and the T2 row unchanged in DB.
func TestBulk_PartialFailureCrossTenant(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subT1, userT1 := pickAnyUser(t, pool)
	subT2, userT2 := pickSecondTenant(t, pool, subT1)
	fs2T1 := secondFlowStateID(t, ctx, pool, subT1)
	svc := workitems.New(pool)
	h := workitems.NewHandler(svc)

	// 4 rows in T1.
	posStart := 9500
	t1Rows := []seedRow{
		{title: "bulk-partial-T1-A"},
		{title: "bulk-partial-T1-B"},
		{title: "bulk-partial-T1-C"},
		{title: "bulk-partial-T1-D"},
	}
	for i := range t1Rows {
		p := posStart + i*100
		t1Rows[i].backlogPos = &p
	}
	t1IDs := seedRows(t, ctx, pool, subT1, userT1, t1Rows)

	// 1 row in T2 — record the T2 row's pre-call flow_state so we can
	// assert it was untouched after the call.
	posT2 := 9000
	t2IDs := seedRows(t, ctx, pool, subT2, userT2, []seedRow{
		{title: "bulk-partial-T2-X", backlogPos: &posT2},
	})
	t2ID := t2IDs[0]
	var t2OriginalFS uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT flow_state_id FROM obj_work_items WHERE id = $1`, t2ID,
	).Scan(&t2OriginalFS); err != nil {
		t.Fatalf("read T2 original flow_state: %v", err)
	}

	// Build the mixed-tenant batch.
	idStrs := make([]string, 0, 5)
	for _, id := range t1IDs {
		idStrs = append(idStrs, id.String())
	}
	idStrs = append(idStrs, t2ID.String())

	body, _ := json.Marshal(map[string]any{
		"ids":     idStrs,
		"op":      "set_status",
		"payload": map[string]any{"flow_state_id": fs2T1.String()},
	})
	user := &models.User{ID: userT1, SubscriptionID: subT1, IsActive: true}
	srv := httptest.NewServer(bulkRouter(h, user))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/work-items/bulk", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var got workitems.BulkOpResult
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Updated != 4 {
		t.Errorf("updated: want 4, got %d", got.Updated)
	}
	if len(got.Failed) != 1 {
		t.Fatalf("failed length: want 1, got %d (%+v)", len(got.Failed), got.Failed)
	}
	if got.Failed[0].ID != t2ID.String() {
		t.Errorf("failed[0].id: want %s, got %s", t2ID, got.Failed[0].ID)
	}
	if got.Failed[0].Reason != "forbidden" {
		t.Errorf("failed[0].reason: want \"forbidden\", got %q", got.Failed[0].Reason)
	}

	// T2 row must be untouched — same flow_state as before the call.
	var t2AfterFS uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT flow_state_id FROM obj_work_items WHERE id = $1`, t2ID,
	).Scan(&t2AfterFS); err != nil {
		t.Fatalf("re-read T2: %v", err)
	}
	if t2AfterFS != t2OriginalFS {
		t.Errorf("T2 row was mutated! flow_state_id = %s, original = %s", t2AfterFS, t2OriginalFS)
	}

	// And the 4 T1 rows must all be flipped to F2.
	for _, id := range t1IDs {
		var fsID uuid.UUID
		if err := pool.QueryRow(ctx,
			`SELECT flow_state_id FROM obj_work_items WHERE id = $1`, id,
		).Scan(&fsID); err != nil {
			t.Errorf("re-read T1 row %s: %v", id, err)
			continue
		}
		if fsID != fs2T1 {
			t.Errorf("T1 row %s flow_state_id = %s, want %s", id, fsID, fs2T1)
		}
	}
}
