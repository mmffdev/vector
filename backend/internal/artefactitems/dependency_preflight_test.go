package artefactitems

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// fakeImpact is a tiny stub for DependencyImpactQuerier. Per-test
// tuning lets each case pick its impact + error combination without
// touching a live dependencies.Service.
type fakeImpact struct {
	maps []ImpactedMap
	err  error
}

func (f fakeImpact) ArtefactDependencyImpact(ctx context.Context, _, _ uuid.UUID) ([]ImpactedMap, error) {
	return f.maps, f.err
}

// archiveReq builds an authenticated, sentinel-clamped DELETE
// request against /work-items/{id}. WorkspaceID on the clamp lets
// the preflight read it via sentinel.WorkspaceIDFromCtx.
func archiveReq(t *testing.T, id uuid.UUID) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/work-items/"+id.String(), nil)
	u := &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		WorkspaceID:    uuid.New(),
		Role:           roletypes.Role("user"),
	}
	clamp := sentinel.Clamp{
		TenantID:    u.SubscriptionID,
		UserID:      u.ID,
		WorkspaceID: u.WorkspaceID,
	}
	ctx := auth.WithUserForTest(req.Context(), u)
	ctx = sentinel.TestingWithClamp(ctx, clamp)
	return req.WithContext(ctx)
}

func mountArchive(h *Handler) chi.Router {
	r := chi.NewRouter()
	r.Delete("/work-items/{id}", h.Archive)
	return r
}

// TestArchiveWorkItem_BlockedByDependencies — AC-named regression
// for the B23.1.8 preflight. When the dependencies adapter reports
// at least one impacted map, Archive returns 409 with a
// dependency_impact payload and DOES NOT call ArchiveWorkItem.
//
// The handler's svc is constructed with a nil pool — ArchiveWorkItem
// would 500 internally if reached, so any code path that returns
// 200/204 here is wrong (it would have called through).
func TestArchiveWorkItem_BlockedByDependencies(t *testing.T) {
	t.Parallel()
	mapA := ImpactedMap{MapID: uuid.New(), MapName: "Q3 release", EdgeCount: 2}
	mapB := ImpactedMap{MapID: uuid.New(), MapName: "Auth rewrite", EdgeCount: 1}
	h := NewHandler(NewService(nil, nil, "work")).
		WithDependencyPreflight(fakeImpact{maps: []ImpactedMap{mapA, mapB}})

	r := mountArchive(h)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, archiveReq(t, uuid.New()))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Code         string        `json:"code"`
		ImpactedMaps []ImpactedMap `json:"impacted_maps"`
		TotalEdges   int           `json:"total_edges"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; raw=%s", err, rec.Body.String())
	}
	if body.Code != "dependency_impact" {
		t.Errorf("code = %q, want %q", body.Code, "dependency_impact")
	}
	if len(body.ImpactedMaps) != 2 {
		t.Errorf("impacted_maps count = %d, want 2", len(body.ImpactedMaps))
	}
	if body.TotalEdges != 3 {
		t.Errorf("total_edges = %d, want 3 (sum of 2+1)", body.TotalEdges)
	}
}

// TestArchiveWorkItem_PassesPreflight — when the preflight returns
// zero impacted maps, Archive proceeds. With a nil pool the inner
// service path returns 404 (ErrNotFound surfaced as 404 by the
// handler) — what matters is the preflight DIDN'T block.
func TestArchiveWorkItem_PassesPreflight(t *testing.T) {
	t.Parallel()
	h := NewHandler(NewService(nil, nil, "work")).
		WithDependencyPreflight(fakeImpact{maps: nil})

	r := mountArchive(h)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, archiveReq(t, uuid.New()))

	// Nil pool → ErrNotFound → 404. The point is NOT-409: the
	// preflight did not block.
	if rec.Code == http.StatusConflict {
		t.Fatalf("preflight should have passed; got 409 body=%s", rec.Body.String())
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (nil pool reached inner svc)", rec.Code)
	}
}

// TestArchiveWorkItem_PreflightErrorFailsClosed — a preflight that
// errors out is fail-closed: 500, never silent fall-through to the
// archive path. Without this guarantee, a flaky DB on the
// dependencies side could silently allow archive of load-bearing
// artefacts.
func TestArchiveWorkItem_PreflightErrorFailsClosed(t *testing.T) {
	t.Parallel()
	h := NewHandler(NewService(nil, nil, "work")).
		WithDependencyPreflight(fakeImpact{err: errors.New("db blew up")})

	r := mountArchive(h)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, archiveReq(t, uuid.New()))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (fail-closed)", rec.Code)
	}
}

// TestArchiveWorkItem_NoPreflightUnwired — back-compat path: when
// WithDependencyPreflight was never called (legacy envs / pre-B23
// boot ordering), Archive proceeds without the check. Nil pool →
// 404 again.
func TestArchiveWorkItem_NoPreflightUnwired(t *testing.T) {
	t.Parallel()
	h := NewHandler(NewService(nil, nil, "work"))
	r := mountArchive(h)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, archiveReq(t, uuid.New()))

	if rec.Code == http.StatusConflict {
		t.Fatalf("unwired preflight should not 409; got %d", rec.Code)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (nil pool reached inner svc)", rec.Code)
	}
}
