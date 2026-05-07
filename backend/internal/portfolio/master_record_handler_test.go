package portfolio

// Handler-level tests for GET /api/portfolio/master_record.
//
// We split into two tiers:
//
//   - Unit (no DB): exercises the request-validation + auth-context
//     branches that don't need a live pool. Constructed with vectorPool
//     = nil (forces the "padmin/gadmin only" short-circuit) and
//     Service.vectorArtefactsPool = nil (forces ErrPoolMissing on Get).
//
//   - Live (skip-on-unreachable): hits a real mmff_vector + vector_artefacts
//     pair via VECTOR_DB_URL + VECTOR_ARTEFACTS_DB_URL. Skipped when
//     either pool is unreachable, mirroring the librarydb / portfoliomodels
//     test-skip discipline.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
)

// withUser injects u into the request context the same way auth.RequireAuth
// would. Mirrors the trick used in handler_test.go elsewhere.
func withUser(req *http.Request, u *models.User) *http.Request {
	return req.WithContext(auth.WithUserForTest(req.Context(), u))
}

func newRouter(h *Handler) http.Handler {
	r := chi.NewRouter()
	r.Route("/api/portfolio", h.Mount)
	return r
}

// ----- unit tier (no DB) -----

func TestGetMasterRecord_Unauthenticated(t *testing.T) {
	t.Parallel()
	h := NewHandler(NewService(nil), nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/api/portfolio/master_record?workspace_id="+uuid.New().String(), nil)
	newRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: want 401, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestGetMasterRecord_MissingWorkspaceID(t *testing.T) {
	t.Parallel()
	h := NewHandler(NewService(nil), nil)
	u := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RolePAdmin}

	rr := httptest.NewRecorder()
	req := withUser(httptest.NewRequest(http.MethodGet, "/api/portfolio/master_record", nil), u)
	newRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestGetMasterRecord_InvalidWorkspaceID(t *testing.T) {
	t.Parallel()
	h := NewHandler(NewService(nil), nil)
	u := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RolePAdmin}

	rr := httptest.NewRecorder()
	req := withUser(httptest.NewRequest(http.MethodGet,
		"/api/portfolio/master_record?workspace_id=not-a-uuid", nil), u)
	newRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

// Non-admin caller with a nil vector pool (unit harness) must be denied
// with 404 — the canRead short-circuit only admits padmin/gadmin in this
// configuration.
func TestGetMasterRecord_NonAdminDeniedWithoutPool(t *testing.T) {
	t.Parallel()
	h := NewHandler(NewService(nil), nil)
	u := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RoleUser}

	rr := httptest.NewRecorder()
	req := withUser(httptest.NewRequest(http.MethodGet,
		"/api/portfolio/master_record?workspace_id="+uuid.New().String(), nil), u)
	newRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

// Padmin caller with nil pools: passes the (unit-mode) authz short-
// circuit but then hits ErrPoolMissing on the master-record read,
// surfacing as 500.
func TestGetMasterRecord_PadminPoolMissingIs500(t *testing.T) {
	t.Parallel()
	h := NewHandler(NewService(nil), nil)
	u := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RolePAdmin}

	rr := httptest.NewRecorder()
	req := withUser(httptest.NewRequest(http.MethodGet,
		"/api/portfolio/master_record?workspace_id="+uuid.New().String(), nil), u)
	newRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500, got %d (body=%s)", rr.Code, rr.Body.String())
	}
}

// ----- live tier (skip-on-unreachable) -----

// liveVAPool dials the vector_artefacts DB. Returns nil with t.Skip when
// the URL is unset or the pool can't ping — same discipline as the
// portfoliomodels test pool helper.
func liveVAPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if dsn == "" {
		t.Skip("VECTOR_ARTEFACTS_DB_URL unset — skipping live handler test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("vector_artefacts dial: %v — skipping live handler test", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("vector_artefacts ping: %v — skipping live handler test", err)
	}
	return pool
}

// 404 when the workspace has no master_record_portfolio row. Uses a
// random UUID — the canRead short-circuit (padmin role + nil vector
// pool fallback) admits the request, then the service Get returns
// ErrNotFound which the handler maps to 404.
func TestGetMasterRecord_LiveUnadopted_404(t *testing.T) {
	pool := liveVAPool(t)
	defer pool.Close()

	h := NewHandler(NewService(pool), nil) // nil vectorPool → padmin-only authz
	u := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RolePAdmin}

	wsID := uuid.New() // guaranteed-unadopted random UUID
	rr := httptest.NewRecorder()
	req := withUser(httptest.NewRequest(http.MethodGet,
		"/api/portfolio/master_record?workspace_id="+url.QueryEscape(wsID.String()), nil), u)
	newRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d (body=%s)", rr.Code, rr.Body.String())
	}
	// Body should be a problem-details document.
	if ct := rr.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type: want application/problem+json, got %q", ct)
	}
}

// Round-trips the wire shape: writes a master record via the sole-writer
// service, reads it back via HTTP, asserts JSON fields. Uses a synthetic
// workspace id so we don't collide with adopted fixtures.
func TestGetMasterRecord_LiveAdopted_200(t *testing.T) {
	pool := liveVAPool(t)
	defer pool.Close()

	svc := NewService(pool)
	h := NewHandler(svc, nil) // nil vectorPool → padmin-only authz
	u := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RolePAdmin}

	wsID := uuid.New()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM master_record_portfolio WHERE workspace_id = $1`, wsID)
	})

	desc := "test description for B9 handler"
	if _, err := svc.Upsert(context.Background(), UpsertInput{
		WorkspaceID:      wsID,
		ModelName:        "B9 handler test model",
		ModelDescription: &desc,
	}); err != nil {
		t.Fatalf("seed master record: %v", err)
	}

	rr := httptest.NewRecorder()
	req := withUser(httptest.NewRequest(http.MethodGet,
		"/api/portfolio/master_record?workspace_id="+wsID.String(), nil), u)
	newRouter(h).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%s)", rr.Code, rr.Body.String())
	}

	var got MasterRecord
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, rr.Body.String())
	}
	if got.WorkspaceID != wsID {
		t.Errorf("workspace_id: want %s, got %s", wsID, got.WorkspaceID)
	}
	if got.ModelName != "B9 handler test model" {
		t.Errorf("model_name: want %q, got %q", "B9 handler test model", got.ModelName)
	}
	if got.ModelDescription == nil || *got.ModelDescription != desc {
		t.Errorf("model_description: want %q, got %v", desc, got.ModelDescription)
	}
}
