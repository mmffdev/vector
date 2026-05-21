package timeboxsprints_test

// PLA-0027 / Story 00515 — handler-level integration tests for the
// timeboxsprints HTTP surface. Tests use httptest.NewRecorder and mount
// the handler directly — no chi router needed for the basic cases.
//
// Run manually:
//
//	BACKEND_ENV=dev go test -v -run TestHandler ./internal/timeboxsprints/...

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/timeboxsprints"
)

// ── request helpers ───────────────────────────────────────────────────────────

// withAuth injects a minimal auth.User into the request context so
// handlers can call auth.UserFromCtx without panicking.
func withAuth(r *http.Request, subID, wsID string) *http.Request {
	u := &roletypes.User{}
	// SubscriptionID is uuid.UUID — parse from string.
	// For test purposes we use zero UUID if parse fails.
	_ = json.Unmarshal([]byte(`"`+subID+`"`), &u.SubscriptionID)
	return r.WithContext(auth.WithUserForTest(r.Context(), u))
}

// routeWith injects a chi URL param into the request context.
func routeWith(r *http.Request, key, val string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, val)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// body encodes v as JSON bytes.
func body(v any) *bytes.Buffer {
	b, _ := json.Marshal(v)
	return bytes.NewBuffer(b)
}

// ── tests ─────────────────────────────────────────────────────────────────────

// TestHandlerListMissingWorkspaceID verifies 400 when workspace_id is absent.
func TestHandlerListMissingWorkspaceID(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	r := httptest.NewRequest(http.MethodGet, "/api/v2/timeboxes/sprints", nil)
	r = withAuth(r, sub, ws)
	w := httptest.NewRecorder()

	h.List(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// TestHandlerList verifies 200 with sprints array and count.
func TestHandlerList(t *testing.T) {
	pool := openVAPool(t)
	svc := timeboxsprints.NewService(pool)
	h := timeboxsprints.NewHandler(svc)

	sub, ws, _ := newIDs()
	t.Cleanup(cleanup(pool, ws))

	// Seed one sprint.
	in := baseInput(sub, ws, nil, "H-Sprint 1", "2045-01-01", "2045-01-14")
	if _, err := svc.Create(context.Background(), in); err != nil {
		t.Fatalf("seed: %v", err)
	}

	r := httptest.NewRequest(http.MethodGet, "/api/v2/timeboxes/sprints?workspace_id="+ws, nil)
	r = withAuth(r, sub, ws)
	w := httptest.NewRecorder()

	h.List(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body)
	}

	// Slice 6.3a — response shape cut over from {sprints,count}.
	var resp struct {
		Items []any `json:"items"`
		Total int   `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != 1 {
		t.Errorf("expected total=1, got %d", resp.Total)
	}
}

// TestHandlerGetNotFound verifies 404 for unknown sprint.
func TestHandlerGetNotFound(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	r := httptest.NewRequest(http.MethodGet, "/api/v2/timeboxes/sprints/not-a-uuid?workspace_id="+ws, nil)
	r = withAuth(r, sub, ws)
	r = routeWith(r, "id", "00000000-0000-0000-0000-000000000000")
	w := httptest.NewRecorder()

	h.Get(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// TestHandlerCreate verifies 201 for a valid sprint body.
func TestHandlerCreate(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	t.Cleanup(cleanup(pool, ws))

	payload := map[string]any{
		"timeboxes_sprints_name":          "H-Create Sprint",
		"timeboxes_sprints_cadence_days":  14,
		"timeboxes_sprints_date_start":    "2046-01-01",
		"timeboxes_sprints_date_end":      "2046-01-14",
	}
	r := httptest.NewRequest(http.MethodPost, "/api/v2/timeboxes/sprints?workspace_id="+ws, body(payload))
	r = withAuth(r, sub, ws)
	w := httptest.NewRecorder()

	h.Create(w, r)
	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body)
	}
}

// TestHandlerCreateInvalidBody verifies 400 for malformed JSON.
func TestHandlerCreateInvalidBody(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	r := httptest.NewRequest(http.MethodPost, "/api/v2/timeboxes/sprints?workspace_id="+ws,
		bytes.NewBufferString("not json"))
	r = withAuth(r, sub, ws)
	w := httptest.NewRecorder()

	h.Create(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// TestHandlerCreateValidationError verifies 422 for missing required fields.
func TestHandlerCreateValidationError(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	// Empty timeboxes_sprints_name triggers ErrInvalidInput → 422.
	payload := map[string]any{
		"timeboxes_sprints_name":          "",
		"timeboxes_sprints_cadence_days":  14,
		"timeboxes_sprints_date_start":    "2047-01-01",
		"timeboxes_sprints_date_end":      "2047-01-14",
	}
	r := httptest.NewRequest(http.MethodPost, "/api/v2/timeboxes/sprints?workspace_id="+ws, body(payload))
	r = withAuth(r, sub, ws)
	w := httptest.NewRecorder()

	h.Create(w, r)
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d: %s", w.Code, w.Body)
	}
}

// TestHandlerDeleteNotFound verifies 404 for unknown sprint.
func TestHandlerDeleteNotFound(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	r := httptest.NewRequest(http.MethodDelete, "/api/v2/timeboxes/sprints/unknown?workspace_id="+ws, nil)
	r = withAuth(r, sub, ws)
	r = routeWith(r, "id", "00000000-0000-0000-0000-000000000000")
	w := httptest.NewRecorder()

	h.Delete(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// TestHandlerDeleteLifecycle verifies 409 for active sprint deletion.
func TestHandlerDeleteLifecycle(t *testing.T) {
	pool := openVAPool(t)
	svc := timeboxsprints.NewService(pool)
	h := timeboxsprints.NewHandler(svc)

	sub, ws, _ := newIDs()
	t.Cleanup(cleanup(pool, ws))

	in := baseInput(sub, ws, nil, "Active Sprint Delete", "2048-01-01", "2048-01-14")
	s, err := svc.Create(context.Background(), in)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	_, _ = pool.Exec(context.Background(),
		`UPDATE timeboxes_sprints SET timeboxes_sprints_status = 'active' WHERE timeboxes_sprints_id = $1`, s.ID)

	r := httptest.NewRequest(http.MethodDelete, "/api/v2/timeboxes/sprints/"+s.ID+"?workspace_id="+ws, nil)
	r = withAuth(r, sub, ws)
	r = routeWith(r, "id", s.ID)
	w := httptest.NewRecorder()

	h.Delete(w, r)
	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

// TestHandlerBulkCreate verifies 201 with sprints array for a valid batch.
func TestHandlerBulkCreate(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	t.Cleanup(cleanup(pool, ws))

	payload := map[string]any{
		"sprints": []map[string]any{
			{"timeboxes_sprints_name": "Bulk-1", "timeboxes_sprints_cadence_days": 14, "timeboxes_sprints_date_start": "2049-01-01", "timeboxes_sprints_date_end": "2049-01-14"},
			{"timeboxes_sprints_name": "Bulk-2", "timeboxes_sprints_cadence_days": 14, "timeboxes_sprints_date_start": "2049-01-15", "timeboxes_sprints_date_end": "2049-01-28"},
		},
	}
	r := httptest.NewRequest(http.MethodPost, "/api/v2/timeboxes/sprints/bulk-create?workspace_id="+ws, body(payload))
	r = withAuth(r, sub, ws)
	w := httptest.NewRecorder()

	h.BulkCreate(w, r)
	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body)
	}
	// Slice 6.3a — response shape cut over from {sprints,count} to
	// {items,total} to match the ObjectTreeV2 data-hook contract.
	var resp struct {
		Total int `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Total != 2 {
		t.Errorf("expected total=2, got %d", resp.Total)
	}
}

// TestHandlerBulkCreateEmptyBody verifies 422 for empty sprints array.
func TestHandlerBulkCreateEmptyBody(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	payload := map[string]any{"sprints": []any{}}
	r := httptest.NewRequest(http.MethodPost, "/api/v2/timeboxes/sprints/bulk-create?workspace_id="+ws, body(payload))
	r = withAuth(r, sub, ws)
	w := httptest.NewRecorder()

	h.BulkCreate(w, r)
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", w.Code)
	}
}

// TestHandlerUpdateNotFound verifies 404 for unknown sprint.
func TestHandlerUpdateNotFound(t *testing.T) {
	pool := openVAPool(t)
	h := timeboxsprints.NewHandler(timeboxsprints.NewService(pool))

	sub, ws, _ := newIDs()
	newName := "Renamed"
	payload := map[string]any{"timeboxes_sprints_name": newName}
	r := httptest.NewRequest(http.MethodPut, "/api/v2/timeboxes/sprints/unknown?workspace_id="+ws, body(payload))
	r = withAuth(r, sub, ws)
	r = routeWith(r, "id", "00000000-0000-0000-0000-000000000000")
	w := httptest.NewRecorder()

	h.Update(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}
