package addressables_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/addressables"
)

// Integration tests for the four PLA-0005 REST endpoints. Same DB pool
// strategy as service_test.go — uses real dev DB through the tunnel and
// skips when unreachable. Each test uses a unique synthetic page_route
// and cleans up after itself.

const (
	testCIToken        = "test-ci-token-fixture"
	testCustomAppToken = "test-custom-app-token-fixture"
)

// newTestRouter wires the handler endpoints onto a chi router that
// mirrors the production wiring in main.go. Production toggles whether
// the service refuses runtime registrations and whether the handler
// requires the custom-app token; both come from the bool argument here.
func newTestRouter(pool *pgxpool.Pool, inProduction bool) (*chi.Mux, *addressables.Service) {
	svc := addressables.New(pool, inProduction)
	h := addressables.NewHandler(svc, testCIToken, testCustomAppToken)
	r := chi.NewRouter()
	r.Post("/api/addressables/build-reconcile", h.BuildReconcile)
	r.Post("/api/addressables/register", h.Register)
	r.Get("/api/addressables/snapshot", h.Snapshot)
	r.Get("/api/page-help/{addressable_id}", h.PageHelp)
	return r, svc
}

func doJSON(t *testing.T, r http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf *bytes.Buffer
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		buf = bytes.NewBuffer(b)
	} else {
		buf = bytes.NewBuffer(nil)
	}
	req := httptest.NewRequest(method, path, buf)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ─────────────────────────────────────────────────────────────────────
// AC8 — POST /api/addressables/build-reconcile
// ─────────────────────────────────────────────────────────────────────

func TestHandler_BuildReconcile_RequiresCIToken(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)

	body := map[string]any{
		"page_route": uniqueRoute("br_noauth"),
		"slot":       "app",
		"tree":       []any{},
	}
	// No header → 401.
	w := doJSON(t, router, "POST", "/api/addressables/build-reconcile", body, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no token: got %d, want 401; body=%s", w.Code, w.Body.String())
	}
	// Wrong token → 401.
	w = doJSON(t, router, "POST", "/api/addressables/build-reconcile", body, map[string]string{
		"X-CI-Token": "nope",
	})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("bad token: got %d, want 401; body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_BuildReconcile_InsertsTreeAndReturnsCounts(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)
	route := uniqueRoute("br_insert")
	defer cleanupRoute(t, pool, route)

	body := map[string]any{
		"page_route": route,
		"slot":       "app",
		"tree": []any{
			map[string]any{
				"kind": "panel", "name": "kpi_grid",
				"children": []any{
					map[string]any{"kind": "table", "name": "kpi_rows"},
				},
			},
			map[string]any{"kind": "navigation", "name": "side_nav"},
		},
	}
	w := doJSON(t, router, "POST", "/api/addressables/build-reconcile", body, map[string]string{
		"X-CI-Token": testCIToken,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Inserted  int      `json:"inserted"`
		Archived  int      `json:"archived"`
		Unchanged int      `json:"unchanged"`
		Addresses []string `json:"addresses"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Inserted != 3 || resp.Archived != 0 || resp.Unchanged != 0 {
		t.Fatalf("counts wrong: %+v", resp)
	}
	if len(resp.Addresses) != 3 {
		t.Fatalf("addresses: got %d want 3 (%v)", len(resp.Addresses), resp.Addresses)
	}
}

func TestHandler_BuildReconcile_ArchivesDroppedRows(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)
	route := uniqueRoute("br_archive")
	defer cleanupRoute(t, pool, route)

	first := map[string]any{
		"page_route": route,
		"slot":       "app",
		"tree": []any{
			map[string]any{"kind": "panel", "name": "alpha"},
			map[string]any{"kind": "panel", "name": "beta"},
		},
	}
	w := doJSON(t, router, "POST", "/api/addressables/build-reconcile", first, map[string]string{
		"X-CI-Token": testCIToken,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("first reconcile: got %d, want 200; body=%s", w.Code, w.Body.String())
	}

	// Second pass drops 'beta' — it should be archived; 'alpha' unchanged.
	second := map[string]any{
		"page_route": route,
		"slot":       "app",
		"tree": []any{
			map[string]any{"kind": "panel", "name": "alpha"},
		},
	}
	w = doJSON(t, router, "POST", "/api/addressables/build-reconcile", second, map[string]string{
		"X-CI-Token": testCIToken,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("second reconcile: got %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Inserted, Archived, Unchanged int
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Inserted != 0 || resp.Archived != 1 || resp.Unchanged != 1 {
		t.Fatalf("counts wrong: %+v", resp)
	}
}

func TestHandler_BuildReconcile_RejectsBadSlot(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)

	body := map[string]any{
		"page_route": uniqueRoute("br_badslot"),
		"slot":       "nonsense",
		"tree":       []any{},
	}
	w := doJSON(t, router, "POST", "/api/addressables/build-reconcile", body, map[string]string{
		"X-CI-Token": testCIToken,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400; body=%s", w.Code, w.Body.String())
	}
}

// ─────────────────────────────────────────────────────────────────────
// AC9 — POST /api/addressables/register
// ─────────────────────────────────────────────────────────────────────

func TestHandler_Register_DevAcceptsRuntime(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)
	route := uniqueRoute("reg_dev")
	defer cleanupRoute(t, pool, route)

	body := map[string]any{
		"page_route": route,
		"slot":       "app",
		"kind":       "panel",
		"name":       "live_one",
		"source":     "runtime",
	}
	w := doJSON(t, router, "POST", "/api/addressables/register", body, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		ID, Address string
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Address != "samantha._viewport.app._panel.live_one" {
		t.Fatalf("address wrong: %q", resp.Address)
	}
	if _, err := uuid.Parse(resp.ID); err != nil {
		t.Fatalf("id not a uuid: %q", resp.ID)
	}
}

func TestHandler_Register_ProdRefusesRuntime(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, true)

	body := map[string]any{
		"page_route": uniqueRoute("reg_prodrt"),
		"slot":       "app",
		"kind":       "panel",
		"name":       "should_fail",
		"source":     "runtime",
	}
	w := doJSON(t, router, "POST", "/api/addressables/register", body, nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_Register_ProdCustomAppRequiresToken(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, true)
	route := uniqueRoute("reg_prodca")
	defer cleanupRoute(t, pool, route)
	customAppID := uuid.NewString()

	body := map[string]any{
		"page_route":    route,
		"slot":          "app",
		"kind":          "panel",
		"name":          "from_app",
		"source":        "custom_app",
		"custom_app_id": customAppID,
	}
	// No token → 403.
	w := doJSON(t, router, "POST", "/api/addressables/register", body, nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("missing token: got %d, want 403; body=%s", w.Code, w.Body.String())
	}
	// Valid token → 200.
	w = doJSON(t, router, "POST", "/api/addressables/register", body, map[string]string{
		"X-Custom-App-Token": testCustomAppToken,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("with token: got %d, want 200; body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_Register_RejectsBuildSource(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)

	body := map[string]any{
		"page_route": uniqueRoute("reg_build"),
		"slot":       "app",
		"kind":       "panel",
		"name":       "nope",
		"source":     "build",
	}
	w := doJSON(t, router, "POST", "/api/addressables/register", body, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400; body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_Register_CustomAppCannotOverwriteBuild(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, svc := newTestRouter(pool, false)
	route := uniqueRoute("reg_collide")
	defer cleanupRoute(t, pool, route)

	// Seed a build row through the service (the legitimate path).
	if _, err := svc.RegisterFromBuild(context.Background(), route, addressables.SlotApp, []addressables.BuildNode{
		{Kind: "panel", Name: "owned"},
	}); err != nil {
		t.Fatalf("seed build: %v", err)
	}

	customAppID := uuid.NewString()
	body := map[string]any{
		"page_route":    route,
		"slot":          "app",
		"kind":          "panel",
		"name":          "owned",
		"source":        "custom_app",
		"custom_app_id": customAppID,
	}
	w := doJSON(t, router, "POST", "/api/addressables/register", body, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("got %d, want 409; body=%s", w.Code, w.Body.String())
	}
}

// ─────────────────────────────────────────────────────────────────────
// AC10 — GET /api/addressables/snapshot + GET /api/page-help/:id
// ─────────────────────────────────────────────────────────────────────

func TestHandler_Snapshot_KnownRoute(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, svc := newTestRouter(pool, false)
	route := uniqueRoute("snap_known")
	defer cleanupRoute(t, pool, route)

	if _, err := svc.RegisterFromBuild(context.Background(), route, addressables.SlotApp, []addressables.BuildNode{
		{Kind: "panel", Name: "p1", Children: []addressables.BuildNode{
			{Kind: "table", Name: "t1"},
		}},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	w := doJSON(t, router, "GET", "/api/addressables/snapshot?route="+route, nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var got []addressables.Addressable
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d rows, want 2", len(got))
	}
	// Ordered by address, so panel comes before its child table.
	if !strings.HasSuffix(got[0].Address, "._panel.p1") {
		t.Fatalf("first address wrong: %q", got[0].Address)
	}
}

func TestHandler_Snapshot_UnknownRoute(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)

	route := uniqueRoute("snap_unknown")
	w := doJSON(t, router, "GET", "/api/addressables/snapshot?route="+route, nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("expected empty array, got %q", w.Body.String())
	}
}

func TestHandler_Snapshot_RequiresRouteParam(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)

	w := doJSON(t, router, "GET", "/api/addressables/snapshot", nil, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400; body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_PageHelp_KnownAddressable_LibrarySeeded(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, svc := newTestRouter(pool, false)
	route := uniqueRoute("ph_known")
	defer cleanupRoute(t, pool, route)

	if _, err := svc.RegisterFromBuild(context.Background(), route, addressables.SlotApp, []addressables.BuildNode{
		{Kind: "panel", Name: "with_help"},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Look up the addressable id via snapshot.
	snap, err := svc.Snapshot(context.Background(), route)
	if err != nil || len(snap) != 1 {
		t.Fatalf("snapshot: %v / len=%d", err, len(snap))
	}
	id := snap[0].ID

	w := doJSON(t, router, "GET", fmt.Sprintf("/api/page-help/%s", id), nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		AddressableID string `json:"addressable_id"`
		Locale        string `json:"locale"`
		BodyHTML      string `json:"body_html"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.AddressableID != id.String() {
		t.Fatalf("id mismatch: %q vs %q", resp.AddressableID, id)
	}
	if resp.Locale != "en" {
		t.Fatalf("locale: %q", resp.Locale)
	}
	// Library default for kind='panel' is the wildcard seed in 075 — ensure it landed.
	if !strings.Contains(resp.BodyHTML, "panel") {
		t.Fatalf("expected library seed body containing 'panel', got %q", resp.BodyHTML)
	}
}

func TestHandler_PageHelp_UnknownAddressable_404(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)

	w := doJSON(t, router, "GET", "/api/page-help/"+uuid.NewString(), nil, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_PageHelp_BadID_400(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	router, _ := newTestRouter(pool, false)

	w := doJSON(t, router, "GET", "/api/page-help/not-a-uuid", nil, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400; body=%s", w.Code, w.Body.String())
	}
}
