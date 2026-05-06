package workitems_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/workitems"
)

// PLA-0021 / 00460 (WS4-C) — handler-level coverage for the new
// nullable due_date column on PATCH /api/work-items/{id}. Mirrors
// the bulk handler test's chi-mounting helper so the route is wired
// the same way as production (`/{id}` route under /api/work-items).
//
// The contract under test (see patchWorkItemReq doc-comment):
//
//	"due_date":"YYYY-MM-DD" → DB write of that calendar date
//	"due_date":""           → clear to NULL
//	"due_date":null         → clear to NULL
//	field absent            → no change
//
// We don't assert the absent-field path here because all three other
// cases collectively exercise both wire pathways (json.RawMessage = nil
// vs non-nil) and absent is the trivial pass-through.

// patchRouter mounts the PATCH handler against a minimal chi router
// with a withUser middleware that injects the supplied User into the
// request context — same pattern as bulkRouter / listRouter above.
func patchRouter(h *workitems.Handler, u *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := auth.WithUserForTest(req.Context(), u)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Patch("/api/work-items/{id}", h.Patch)
	return r
}

// patchAndDecode performs PATCH /api/work-items/{id} with the given
// body and returns the decoded WorkItem. Fails the test on any
// non-2xx status so each per-case assertion stays focused on values.
func patchAndDecode(t *testing.T, srvURL, id string, body []byte) workitems.WorkItem {
	t.Helper()
	req, err := http.NewRequest(http.MethodPatch, srvURL+"/api/work-items/"+id, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build PATCH: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var got workitems.WorkItem
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return got
}

// TestPatch_DueDate_SetThenClearNullThenClearEmpty seeds one row, then
// drives it through the three meaningful state transitions in one test
// so the order-of-operations (set → clear-via-null → set → clear-via-"")
// is also covered. Each step re-reads the row from DB to confirm the
// column actually changed (not just the response payload).
func TestPatch_DueDate_SetThenClearNullThenClearEmpty(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)
	h := workitems.NewHandler(svc)

	// One row, default state — no due_date set.
	pos := 13100
	ids := seedRows(t, ctx, pool, subID, userID, []seedRow{
		{title: "due-date-row", backlogPos: &pos},
	})
	id := ids[0]

	user := &models.User{ID: userID, SubscriptionID: subID, IsActive: true}
	srv := httptest.NewServer(patchRouter(h, user))
	defer srv.Close()

	// Step 1 — set to 2026-07-01.
	got := patchAndDecode(t, srv.URL, id.String(), []byte(`{"due_date":"2026-07-01"}`))
	if got.DueDate == nil {
		t.Fatalf("step 1: response DueDate is nil, want \"2026-07-01\"")
	}
	if *got.DueDate != "2026-07-01" {
		t.Errorf("step 1: response DueDate = %q, want \"2026-07-01\"", *got.DueDate)
	}
	var dbDate *string
	if err := pool.QueryRow(ctx,
		`SELECT due_date::text FROM obj_work_items WHERE id = $1`, id,
	).Scan(&dbDate); err != nil {
		t.Fatalf("step 1: re-read: %v", err)
	}
	if dbDate == nil || *dbDate != "2026-07-01" {
		t.Errorf("step 1: db due_date = %v, want \"2026-07-01\"", dbDate)
	}

	// Step 2 — clear via explicit null.
	got = patchAndDecode(t, srv.URL, id.String(), []byte(`{"due_date":null}`))
	if got.DueDate != nil {
		t.Errorf("step 2: response DueDate = %q, want nil", *got.DueDate)
	}
	if err := pool.QueryRow(ctx,
		`SELECT due_date::text FROM obj_work_items WHERE id = $1`, id,
	).Scan(&dbDate); err != nil {
		t.Fatalf("step 2: re-read: %v", err)
	}
	if dbDate != nil {
		t.Errorf("step 2: db due_date = %q, want NULL", *dbDate)
	}

	// Step 3 — set again to a different date so step 4 has something to clear.
	got = patchAndDecode(t, srv.URL, id.String(), []byte(`{"due_date":"2026-08-15"}`))
	if got.DueDate == nil || *got.DueDate != "2026-08-15" {
		t.Fatalf("step 3: response DueDate = %v, want \"2026-08-15\"", got.DueDate)
	}

	// Step 4 — clear via empty string.
	got = patchAndDecode(t, srv.URL, id.String(), []byte(`{"due_date":""}`))
	if got.DueDate != nil {
		t.Errorf("step 4: response DueDate = %q, want nil", *got.DueDate)
	}
	if err := pool.QueryRow(ctx,
		`SELECT due_date::text FROM obj_work_items WHERE id = $1`, id,
	).Scan(&dbDate); err != nil {
		t.Fatalf("step 4: re-read: %v", err)
	}
	if dbDate != nil {
		t.Errorf("step 4: db due_date = %q, want NULL", *dbDate)
	}
}

// TestPatch_DueDate_RejectsMalformed posts a non-YYYY-MM-DD string and
// expects 400. Service returns ErrInvalidInput which the handler maps
// to 400 — the same path SprintID's malformed-uuid case takes.
func TestPatch_DueDate_RejectsMalformed(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)
	h := workitems.NewHandler(svc)

	pos := 13200
	ids := seedRows(t, ctx, pool, subID, userID, []seedRow{
		{title: "due-date-malformed-row", backlogPos: &pos},
	})
	id := ids[0]

	user := &models.User{ID: userID, SubscriptionID: subID, IsActive: true}
	srv := httptest.NewServer(patchRouter(h, user))
	defer srv.Close()

	req, err := http.NewRequest(http.MethodPatch,
		srv.URL+"/api/work-items/"+id.String(),
		bytes.NewReader([]byte(`{"due_date":"not-a-date"}`)),
	)
	if err != nil {
		t.Fatalf("build PATCH: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status: want 400, got %d", resp.StatusCode)
	}

	// Confirm DB row was not written — due_date must still be NULL.
	var dbDate *string
	if err := pool.QueryRow(ctx,
		`SELECT due_date::text FROM obj_work_items WHERE id = $1`, id,
	).Scan(&dbDate); err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if dbDate != nil {
		t.Errorf("db due_date = %q after rejected patch, want NULL", *dbDate)
	}
}
