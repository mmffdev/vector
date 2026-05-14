package artefactitems_test

// Handler-level tests for the v2 work-items surface. These mount a minimal
// chi router (same pattern as workitems/handler_bulk_test.go) and exercise
// the HTTP layer end-to-end: status codes, Content-Type, wire shapes.
//
// All DB-backed cases reuse vaPool / mainPool / pickTestSubscription from
// service_test.go. Cases that only exercise the handler logic (nil pool
// fallbacks, malformed bodies) run without a DB.
//
// Run:
//   BACKEND_ENV=dev go test -v -run TestHandler ./internal/artefactitems/...

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// ── router helpers ────────────────────────────────────────────────────────────

func newTestRouter(h *artefactitems.Handler, u *roletypes.User) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := auth.WithUserForTest(req.Context(), u)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	// Mirror cmd/server/main.go registration order: /bulk and /summary and
	// /flow-states MUST be before /{id} so chi's trie prefers them.
	r.Get("/api/v2/work-items", h.List)
	r.Post("/api/v2/work-items", h.Create)
	r.Post("/api/v2/work-items/bulk", h.Bulk)
	r.Get("/api/v2/work-items/summary", h.Summary)
	r.Get("/api/v2/work-items/flow-states", h.ListFlowStates)
	r.Get("/api/v2/work-items/{id}", h.Get)
	r.Patch("/api/v2/work-items/{id}", h.Patch)
	r.Delete("/api/v2/work-items/{id}", h.Archive)
	r.Get("/api/v2/work-items/{id}/children", h.ListChildren)
	r.Get("/api/v2/work-items/{id}/field-values", h.ListFieldValues)
	r.Put("/api/v2/work-items/{id}/field-values", h.UpsertFieldValues)
	r.Delete("/api/v2/work-items/{id}/field-values/{field_library_id}", h.DeleteFieldValue)
	return r
}

func newTestUser(subID uuid.UUID) *roletypes.User {
	return &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: subID,
		IsActive:       true,
	}
}

// ── nil-pool fallback tests (no DB required) ──────────────────────────────────

// TestHandler_List_NilPool verifies that GET /api/v2/work-items returns 200
// with an empty items array when the vector_artefacts pool is nil.
func TestHandler_List_NilPool(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v2/work-items")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		Items []any `json:"items"`
		Total int   `json:"total"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Items) != 0 {
		t.Errorf("items = %d, want 0 for nil pool", len(body.Items))
	}
}

// TestHandler_Get_InvalidUUID verifies that a non-UUID path param returns 400.
func TestHandler_Get_InvalidUUID(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v2/work-items/not-a-uuid")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// TestHandler_Get_NotFound verifies that a random UUID returns 404 via nil pool.
func TestHandler_Get_NotFound(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v2/work-items/" + uuid.New().String())
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// TestHandler_Create_MissingBody verifies that POST with no body returns 400.
func TestHandler_Create_MissingBody(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v2/work-items", "application/json",
		bytes.NewBufferString("not-json"))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// TestHandler_Bulk_InvalidBody verifies that POST /bulk with bad JSON returns 400.
func TestHandler_Bulk_InvalidBody(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/v2/work-items/bulk", "application/json",
		bytes.NewBufferString("{bad json"))
	if err != nil {
		t.Fatalf("POST bulk: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// TestHandler_Bulk_UnsupportedOp verifies that an unsupported op returns 400.
func TestHandler_Bulk_UnsupportedOp(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	body, _ := json.Marshal(map[string]any{
		"ids": []string{uuid.New().String()},
		"op":  "destroy_everything",
	})
	resp, err := http.Post(srv.URL+"/api/v2/work-items/bulk", "application/json",
		bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST bulk: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for unsupported op", resp.StatusCode)
	}
}

// TestHandler_Patch_InvalidDueDate verifies that a non-date due_date string
// results in a 400 (JSON decode catches it via RawMessage).
func TestHandler_Patch_InvalidDueDate(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	// due_date as an object (not string/null) forces Unmarshal to fail.
	body := []byte(`{"due_date":{"bad":"value"}}`)
	req, _ := http.NewRequest(http.MethodPatch,
		srv.URL+"/api/v2/work-items/"+uuid.New().String(),
		bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for invalid due_date shape", resp.StatusCode)
	}
}

// TestHandler_Summary_ContentType verifies that /summary returns JSON.
func TestHandler_Summary_ContentType(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v2/work-items/summary")
	if err != nil {
		t.Fatalf("GET summary: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		t.Error("Content-Type header missing")
	}
}

// TestHandler_FlowStates_EmptyPool verifies that /flow-states returns 200
// with an empty states array when the pool is nil.
func TestHandler_FlowStates_EmptyPool(t *testing.T) {
	svc := artefactitems.NewService(nil, nil, "work")
	h := artefactitems.NewHandler(svc)
	user := newTestUser(uuid.New())
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v2/work-items/flow-states")
	if err != nil {
		t.Fatalf("GET flow-states: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		States []any `json:"states"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.States) != 0 {
		t.Errorf("states = %d, want 0 for nil pool", len(body.States))
	}
}

// ── DB-backed handler tests ───────────────────────────────────────────────────

// TestHandler_List_WithDB verifies that GET / returns the correct wire shape
// with real data from vector_artefacts.
func TestHandler_List_WithDB(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	h := artefactitems.NewHandler(svc)

	var ownerID uuid.UUID
	if err := mp.QueryRow(context.Background(),
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	user := &roletypes.User{ID: ownerID, SubscriptionID: sub, IsActive: true}
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v2/work-items?limit=10")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		Items []artefactitems.WorkItem `json:"items"`
		Total int                    `json:"total"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Total < 0 {
		t.Errorf("total < 0: %d", body.Total)
	}
}

// TestHandler_Create_ThenGet verifies the full create → get lifecycle via HTTP.
func TestHandler_Create_ThenGet(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	h := artefactitems.NewHandler(svc)
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	user := &roletypes.User{ID: ownerID, SubscriptionID: sub, IsActive: true}
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	createBody, _ := json.Marshal(map[string]any{
		"item_type": "story",
		"title":     "handler-create-test-" + uuid.New().String()[:8],
	})
	resp, err := http.Post(srv.URL+"/api/v2/work-items", "application/json",
		bytes.NewReader(createBody))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", resp.StatusCode)
	}

	var created artefactitems.WorkItem
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(created.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})

	// GET the created item.
	getResp, err := http.Get(srv.URL + "/api/v2/work-items/" + created.ID)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Errorf("get status = %d, want 200", getResp.StatusCode)
	}

	var got artefactitems.WorkItem
	if err := json.NewDecoder(getResp.Body).Decode(&got); err != nil {
		t.Fatalf("decode get: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("id = %s, want %s", got.ID, created.ID)
	}
}

// TestHandler_Archive_Returns204 verifies that DELETE returns 204 No Content.
func TestHandler_Archive_Returns204(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	h := artefactitems.NewHandler(svc)
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	// Seed via service (avoids HTTP create complexity here).
	wi, err := artefactitems.NewService(va, mp, "work").CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "task",
		Title:     "delete-me-via-handler",
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

	user := &roletypes.User{ID: ownerID, SubscriptionID: sub, IsActive: true}
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/v2/work-items/"+wi.ID, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

// TestHandler_Bulk_SetPriority verifies the happy-path bulk set_priority op.
func TestHandler_Bulk_SetPriority(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	h := artefactitems.NewHandler(svc)
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT id FROM users WHERE subscription_id=$1 AND is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "story",
		Title:     "bulk-priority-target",
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

	user := &roletypes.User{ID: ownerID, SubscriptionID: sub, IsActive: true}
	srv := httptest.NewServer(newTestRouter(h, user))
	defer srv.Close()

	body, _ := json.Marshal(map[string]any{
		"ids":     []string{wi.ID},
		"op":      "set_priority",
		"payload": map[string]any{"priority": "high"},
	})
	resp, err := http.Post(srv.URL+"/api/v2/work-items/bulk", "application/json",
		bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST bulk: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	var result artefactitems.BulkOpResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Updated != 1 {
		t.Errorf("updated = %d, want 1", result.Updated)
	}
	if len(result.Failed) != 0 {
		t.Errorf("failed = %v, want empty", result.Failed)
	}
}
