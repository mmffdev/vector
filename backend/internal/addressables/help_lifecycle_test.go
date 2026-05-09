package addressables_test

// PLA-0008 / 00331 — Integration suite for the page-help lifecycle.
//
// Walks one synthetic page through the full chain:
//
//   1. RegisterFromBuild seeds an addressable + library-default page_help row.
//   2. PageHelp public read returns the seeded body.
//   3. PageHelpAdminPut (gadmin) overwrites with rich content; sanitiser
//      strips disallowed tags before persistence.
//   4. PageHelp re-read returns the sanitised gadmin copy plus the rich
//      arrays — the same shape /help/<id> renders.
//   5. AdminUpdateHelpable flips the addressable's `helpable` bit; the
//      snapshot reflects the change so the front-end hides the icon.
//   6. PageHelpAdminPut against an unknown id returns 404; against a bad
//      YouTube URL returns 400.
//
// Each test uses a unique synthetic page_route + cleanupRoute teardown,
// matching the convention in service_test.go / handler_test.go. Tests
// skip when the dev DB tunnel is unreachable (testPool helper).

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/addressables"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
)

// newAdminRouter mounts the admin endpoints used by the gadmin help
// editor + helpable toggle alongside the public read endpoint. Production
// wires these behind RequirePermission(MenuAdminView); for the test we
// inject the user via auth.WithUserForTest at request time so we exercise
// the same handler code path the live router does, just without the RBAC
// middleware (covered separately by the roles package).
func newAdminRouter(pool *pgxpool.Pool) (*chi.Mux, *addressables.Service) {
	svc := addressables.New(pool, false)
	h := addressables.NewHandler(svc, testCIToken, testCustomAppToken)
	r := chi.NewRouter()
	r.Get("/api/page-help/{addressable_id}", h.PageHelp)
	r.Put("/api/page-help/admin/{addressable_id}", h.PageHelpAdminPut)
	r.Delete("/api/page-help/admin/{addressable_id}", h.PageHelpAdminDelete)
	r.Get("/api/page-help/admin", h.PageHelpAdminList)
	r.Patch("/api/addressables/admin/{id}/helpable", h.AdminUpdateHelpable)
	return r, svc
}

// doJSONAs is doJSON with an authenticated user grafted onto the
// request context. It mirrors the auth posture inside RequireAuth: the
// router middleware would have called WithUserForTest, then the handler
// reads back via UserFromCtx.
func doJSONAs(t *testing.T, r http.Handler, method, path string, body any, u *models.User) *httptest.ResponseRecorder {
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
	if u != nil {
		req = req.WithContext(auth.WithUserForTest(req.Context(), u))
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// loadGadminUser pulls a real user row from the dev DB to attribute the
// edit. Skips if the table is empty (CI clean DB).
func loadGadminUser(t *testing.T, pool *pgxpool.Pool) *models.User {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT id FROM users LIMIT 1`).Scan(&id); err != nil {
		t.Skipf("no users in dev DB to attribute edits: %v", err)
	}
	return &models.User{ID: id}
}

// ─────────────────────────────────────────────────────────────────────
// 00331 — full lifecycle: register → seed → admin PUT → read
// ─────────────────────────────────────────────────────────────────────

func TestHelpLifecycle_RegisterSeedEditRead(t *testing.T) {
	pool := testPool(t)
	// Cleanups run LIFO and AFTER defers. Register pool.Close first so
	// cleanupRoute (registered next) runs against a live pool.
	t.Cleanup(pool.Close)
	router, svc := newAdminRouter(pool)
	route := uniqueRoute("help_life")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	// 1. Build-time register seeds an addressable + library-default
	//    page_help row (panel:* wildcard from migration 075).
	if _, err := svc.RegisterFromBuild(context.Background(), route, addressables.SlotApp, []addressables.BuildNode{
		{Kind: "panel", Name: "lifecycle"},
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	snap, err := svc.Snapshot(context.Background(), route)
	if err != nil || len(snap) != 1 {
		t.Fatalf("snapshot: err=%v len=%d", err, len(snap))
	}
	addrID := snap[0].ID

	// 2. Public read returns the library-seeded body (non-empty).
	w := doJSONAs(t, router, http.MethodGet, "/api/page-help/"+addrID.String(), nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("seeded GET: code=%d body=%s", w.Code, w.Body.String())
	}
	var seeded map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &seeded); err != nil {
		t.Fatalf("seeded JSON: %v", err)
	}
	if body, _ := seeded["body_html"].(string); body == "" {
		t.Fatalf("expected non-empty seeded body, got %v", seeded)
	}

	// 3. Gadmin PUT overwrites with rich content. The body intentionally
	//    contains a <script> tag and an onclick handler — the sanitiser
	//    must strip both before persistence.
	gadmin := loadGadminUser(t, pool)
	title := "Lifecycle test"
	put := map[string]any{
		"locale": "en",
		"title":  title,
		"body":   `<p onclick="alert(1)">manual</p><script>alert(2)</script><p>safe</p>`,
		"video_embeds": []map[string]any{
			{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Demo", "position": 1},
		},
		"image_urls": []map[string]any{
			{"url": "https://cdn.example.com/diagram.png", "alt": "diagram", "position": 1},
		},
	}
	w = doJSONAs(t, router, http.MethodPut, "/api/page-help/admin/"+addrID.String(), put, gadmin)
	if w.Code != http.StatusOK {
		t.Fatalf("admin PUT: code=%d body=%s", w.Code, w.Body.String())
	}

	// 4. Re-read via the public endpoint — same path the popover and
	//    /help/<id> page use. Gadmin copy must replace the seed; the
	//    body must be sanitised; the rich arrays must round-trip.
	w = doJSONAs(t, router, http.MethodGet, "/api/page-help/"+addrID.String(), nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("post-edit GET: code=%d body=%s", w.Code, w.Body.String())
	}
	var doc struct {
		Title       *string         `json:"title"`
		BodyHTML    string          `json:"body_html"`
		VideoEmbeds json.RawMessage `json:"video_embeds"`
		ImageURLs   json.RawMessage `json:"image_urls"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatalf("post-edit JSON: %v body=%s", err, w.Body.String())
	}
	if doc.Title == nil || *doc.Title != title {
		t.Fatalf("title round-trip: got %v want %q", doc.Title, title)
	}
	if strings.Contains(strings.ToLower(doc.BodyHTML), "<script") {
		t.Fatalf("script tag survived sanitiser: %q", doc.BodyHTML)
	}
	if strings.Contains(strings.ToLower(doc.BodyHTML), "onclick") {
		t.Fatalf("onclick attr survived sanitiser: %q", doc.BodyHTML)
	}
	if !strings.Contains(doc.BodyHTML, "<p>safe</p>") {
		t.Fatalf("safe content lost: %q", doc.BodyHTML)
	}
	if !strings.Contains(string(doc.VideoEmbeds), "dQw4w9WgXcQ") {
		t.Fatalf("video round-trip: %s", doc.VideoEmbeds)
	}
	if !strings.Contains(string(doc.ImageURLs), "diagram.png") {
		t.Fatalf("image round-trip: %s", doc.ImageURLs)
	}

	// 5. Helpable toggle. Default true → flip to false → snapshot
	//    reflects the change, so the front-end hides the help icon.
	w = doJSONAs(t, router, http.MethodPatch, "/api/addressables/admin/"+addrID.String()+"/helpable",
		map[string]any{"helpable": false}, gadmin)
	if w.Code != http.StatusOK {
		t.Fatalf("helpable PATCH: code=%d body=%s", w.Code, w.Body.String())
	}
	snap, err = svc.Snapshot(context.Background(), route)
	if err != nil || len(snap) != 1 {
		t.Fatalf("snapshot after helpable: err=%v len=%d", err, len(snap))
	}
	if snap[0].Helpable {
		t.Fatalf("helpable should now be false")
	}
}

// ─────────────────────────────────────────────────────────────────────
// 00331 — negative paths: 401 unauth, 404 unknown id, 400 bad URL.
// ─────────────────────────────────────────────────────────────────────

func TestHelpLifecycle_AdminPutRequiresAuth(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	router, _ := newAdminRouter(pool)
	w := doJSONAs(t, router, http.MethodPut, "/api/page-help/admin/"+uuid.New().String(),
		map[string]any{"locale": "en", "body": "x"}, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unauth PUT: code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestHelpLifecycle_AdminPutUnknownIdReturns404(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	router, _ := newAdminRouter(pool)
	gadmin := loadGadminUser(t, pool)
	w := doJSONAs(t, router, http.MethodPut, "/api/page-help/admin/"+uuid.New().String(),
		map[string]any{"locale": "en", "body": "<p>x</p>"}, gadmin)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown id PUT: code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestHelpLifecycle_AdminPutRejectsBadYouTube(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	router, svc := newAdminRouter(pool)
	route := uniqueRoute("help_badyt")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	if _, err := svc.RegisterFromBuild(context.Background(), route, addressables.SlotApp,
		[]addressables.BuildNode{{Kind: "panel", Name: "badyt"}}); err != nil {
		t.Fatalf("register: %v", err)
	}
	snap, _ := svc.Snapshot(context.Background(), route)
	addrID := snap[0].ID
	gadmin := loadGadminUser(t, pool)

	put := map[string]any{
		"locale": "en",
		"body":   "<p>x</p>",
		"video_embeds": []map[string]any{
			{"url": "https://evil.example/watch?v=dQw4w9WgXcQ"},
		},
	}
	w := doJSONAs(t, router, http.MethodPut, "/api/page-help/admin/"+addrID.String(), put, gadmin)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad youtube: code=%d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(strings.ToLower(w.Body.String()), "youtube") {
		t.Fatalf("error should mention youtube: %s", w.Body.String())
	}
}

func TestHelpLifecycle_AdminPutRejectsBadImageScheme(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	router, svc := newAdminRouter(pool)
	route := uniqueRoute("help_badimg")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	if _, err := svc.RegisterFromBuild(context.Background(), route, addressables.SlotApp,
		[]addressables.BuildNode{{Kind: "panel", Name: "badimg"}}); err != nil {
		t.Fatalf("register: %v", err)
	}
	snap, _ := svc.Snapshot(context.Background(), route)
	addrID := snap[0].ID
	gadmin := loadGadminUser(t, pool)

	put := map[string]any{
		"locale": "en",
		"body":   "<p>x</p>",
		"image_urls": []map[string]any{
			{"url": "javascript:alert(1)"},
		},
	}
	w := doJSONAs(t, router, http.MethodPut, "/api/page-help/admin/"+addrID.String(), put, gadmin)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad image scheme: code=%d body=%s", w.Code, w.Body.String())
	}
}
