package addressables_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/addressables"
)

// Integration tests for addressables.Service against the real dev DB.
// Each test writes to a synthetic page_route ('/_test/<uuid>') so rows
// are isolated per test and easy to clean up. The tunnel must be up;
// otherwise tests are skipped (matching the ranking package convention).

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	// Active env marker (CLAUDE.md top-of-file ACTIVE_BACKEND_ENV) currently
	// pins dev — load .env.dev preferentially. Fall back to .env.local for
	// devs running tests against a different tunnel.
	for _, rel := range []string{".env.dev", "../../.env.dev", ".env.local", "../../.env.local"} {
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
		t.Skipf("cannot ping (tunnel down?): %v", err)
	}
	return pool
}

func uniqueRoute(prefix string) string {
	return fmt.Sprintf("/_test/%s/%s", prefix, uuid.NewString()[:8])
}

func cleanupRoute(t *testing.T, pool *pgxpool.Pool, route string) {
	t.Helper()
	ctx := context.Background()
	// page_help rows first (FK ON DELETE RESTRICT); use the addressable ids.
	_, _ = pool.Exec(ctx, `
		DELETE FROM page_help WHERE addressable_id IN (
			SELECT id FROM page_addressables WHERE page_route = $1
		)`, route)
	_, _ = pool.Exec(ctx, `DELETE FROM page_addressables WHERE page_route = $1`, route)
}

// ─────────────────────────────────────────────────────────────────────
// BuildAddress: pure function, no DB.
// ─────────────────────────────────────────────────────────────────────

func TestBuildAddress_Root(t *testing.T) {
	got, err := addressables.BuildAddress("", addressables.SlotApp, "panel", "kpi_grid")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	want := "samantha._viewport.app._panel.kpi_grid"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestBuildAddress_Nested(t *testing.T) {
	parent := "samantha._viewport.app._panel.kpi_grid"
	got, err := addressables.BuildAddress(parent, addressables.SlotApp, "table", "rows")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	want := parent + "._table.rows"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestBuildAddress_RejectsBadInputs(t *testing.T) {
	cases := []struct {
		name           string
		parent         string
		slot           addressables.ViewportSlot
		kind, nameArg  string
		wantErr        error
	}{
		{"bad slot", "", "sidebar", "panel", "x", addressables.ErrInvalidViewportSlot},
		{"bad kind: caps", "", addressables.SlotApp, "Panel", "x", addressables.ErrInvalidKind},
		{"bad kind: dash", "", addressables.SlotApp, "panel-grid", "x", addressables.ErrInvalidKind},
		{"empty name", "", addressables.SlotApp, "panel", "", addressables.ErrInvalidName},
		{"name with caps", "", addressables.SlotApp, "panel", "Foo", addressables.ErrInvalidName},
		{"name with hyphen", "", addressables.SlotApp, "panel", "kpi-grid", addressables.ErrInvalidName},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := addressables.BuildAddress(tc.parent, tc.slot, tc.kind, tc.nameArg)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("got %v want %v", err, tc.wantErr)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────
// RegisterFromBuild: tree insert + reconcile.
// ─────────────────────────────────────────────────────────────────────

func TestRegisterFromBuild_InsertsTree_AndSeedsHelp(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("build_insert")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	tree := []addressables.BuildNode{
		{Kind: "panel", Name: "kpi_grid", Children: []addressables.BuildNode{
			{Kind: "table", Name: "rows"},
		}},
		{Kind: "panel", Name: "activity"},
	}

	addrs, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, tree)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	wantAddrs := []string{
		"samantha._viewport.app._panel.kpi_grid",
		"samantha._viewport.app._panel.kpi_grid._table.rows",
		"samantha._viewport.app._panel.activity",
	}
	if len(addrs) != len(wantAddrs) {
		t.Fatalf("addresses: got %v want %v", addrs, wantAddrs)
	}
	for i, w := range wantAddrs {
		if addrs[i] != w {
			t.Fatalf("addr[%d]: got %q want %q", i, addrs[i], w)
		}
	}

	snap, err := svc.Snapshot(ctx, route)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap) != 3 {
		t.Fatalf("snapshot rows: got %d want 3", len(snap))
	}

	// Every row must have a page_help row seeded from the library wildcard.
	for _, a := range snap {
		doc, found, err := svc.HelpFor(ctx, a.ID, "en")
		if err != nil {
			t.Fatalf("HelpFor: %v", err)
		}
		if !found {
			t.Fatalf("expected page_help seeded for %s", a.Address)
		}
		if doc.BodyHTML == "" {
			t.Fatalf("expected non-empty body for %s", a.Address)
		}
	}
}

func TestRegisterFromBuild_Idempotent(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("build_idem")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	tree := []addressables.BuildNode{{Kind: "panel", Name: "kpi_grid"}}

	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, tree); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, tree); err != nil {
		t.Fatalf("second: %v", err)
	}
	snap, err := svc.Snapshot(ctx, route)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap) != 1 {
		t.Fatalf("expected 1 row after idempotent re-register, got %d", len(snap))
	}
}

func TestRegisterFromBuild_ArchivesDroppedRows(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("build_archive")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	first := []addressables.BuildNode{
		{Kind: "panel", Name: "kpi_grid"},
		{Kind: "panel", Name: "activity"},
	}
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, first); err != nil {
		t.Fatalf("first: %v", err)
	}
	second := []addressables.BuildNode{
		{Kind: "panel", Name: "kpi_grid"}, // activity dropped
	}
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, second); err != nil {
		t.Fatalf("second: %v", err)
	}
	snap, err := svc.Snapshot(ctx, route)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap) != 1 || snap[0].Name != "kpi_grid" {
		t.Fatalf("expected only kpi_grid live, got %+v", snap)
	}
}

// ─────────────────────────────────────────────────────────────────────
// RegisterFromRuntime
// ─────────────────────────────────────────────────────────────────────

func TestRegisterFromRuntime_InsertsRoot(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("rt_root")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	addr, err := svc.RegisterFromRuntime(ctx, route, "", addressables.SlotApp, "panel", "scratch", addressables.SourceRuntime, nil)
	if err != nil {
		t.Fatalf("runtime register: %v", err)
	}
	want := "samantha._viewport.app._panel.scratch"
	if addr != want {
		t.Fatalf("got %q want %q", addr, want)
	}
}

func TestRegisterFromRuntime_RefusedInProduction(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, true) // inProduction=true
	ctx := context.Background()
	route := uniqueRoute("rt_prod")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	_, err := svc.RegisterFromRuntime(ctx, route, "", addressables.SlotApp, "panel", "x", addressables.SourceRuntime, nil)
	if !errors.Is(err, addressables.ErrRuntimeRegisterInProduction) {
		t.Fatalf("got %v want ErrRuntimeRegisterInProduction", err)
	}
}

func TestRegisterFromRuntime_RejectsBuildSource(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("rt_buildsrc")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	_, err := svc.RegisterFromRuntime(ctx, route, "", addressables.SlotApp, "panel", "x", addressables.SourceBuild, nil)
	if !errors.Is(err, addressables.ErrInvalidSource) {
		t.Fatalf("got %v want ErrInvalidSource", err)
	}
}

func TestRegisterFromRuntime_NestedRequiresParent(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("rt_nested")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	parent := "samantha._viewport.app._panel.scratch"
	_, err := svc.RegisterFromRuntime(ctx, route, parent, addressables.SlotApp, "table", "x", addressables.SourceRuntime, nil)
	if !errors.Is(err, addressables.ErrParentNotFound) {
		t.Fatalf("got %v want ErrParentNotFound", err)
	}
	// Now create the parent then retry — must succeed.
	if _, err := svc.RegisterFromRuntime(ctx, route, "", addressables.SlotApp, "panel", "scratch", addressables.SourceRuntime, nil); err != nil {
		t.Fatalf("create parent: %v", err)
	}
	addr, err := svc.RegisterFromRuntime(ctx, route, parent, addressables.SlotApp, "table", "x", addressables.SourceRuntime, nil)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	want := parent + "._table.x"
	if addr != want {
		t.Fatalf("got %q want %q", addr, want)
	}
}

func TestRegisterFromRuntime_CustomAppCannotOverwriteBuild(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("rt_collision")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	// Build owns the (panel, scratch) slot.
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, []addressables.BuildNode{{Kind: "panel", Name: "scratch"}}); err != nil {
		t.Fatalf("build: %v", err)
	}
	appID := uuid.New()
	_, err := svc.RegisterFromRuntime(ctx, route, "", addressables.SlotApp, "panel", "scratch", addressables.SourceCustomApp, &appID)
	if !errors.Is(err, addressables.ErrCustomAppCollision) {
		t.Fatalf("got %v want ErrCustomAppCollision", err)
	}
}

func TestRegisterFromRuntime_RuntimeReregisterIsIdempotent(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("rt_idem")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	addr1, err := svc.RegisterFromRuntime(ctx, route, "", addressables.SlotApp, "panel", "scratch", addressables.SourceRuntime, nil)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	addr2, err := svc.RegisterFromRuntime(ctx, route, "", addressables.SlotApp, "panel", "scratch", addressables.SourceRuntime, nil)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if addr1 != addr2 {
		t.Fatalf("idempotent address: got %q vs %q", addr1, addr2)
	}
	snap, err := svc.Snapshot(ctx, route)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap) != 1 {
		t.Fatalf("expected 1 row, got %d", len(snap))
	}
}

// ─────────────────────────────────────────────────────────────────────
// Rich-content round trip — title + video_embeds + image_urls.
// PLA-0008 / 00324.
// ─────────────────────────────────────────────────────────────────────

func TestUpdateHelp_RichContentRoundTrip(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("help_rich")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	// Seed an addressable + library-default page_help row.
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, []addressables.BuildNode{{Kind: "panel", Name: "rich_demo"}}); err != nil {
		t.Fatalf("register: %v", err)
	}
	snap, err := svc.Snapshot(ctx, route)
	if err != nil || len(snap) != 1 {
		t.Fatalf("snapshot: %v / len=%d", err, len(snap))
	}
	addrID := snap[0].ID

	// Use a real editor user (the FK accepts NULL, but we want a non-nil
	// id to prove updated_by_user_id is set).
	var editorID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM users LIMIT 1`).Scan(&editorID); err != nil {
		t.Skipf("no users in dev DB to attribute the edit: %v", err)
	}

	title := "Rich content panel"
	videos := json.RawMessage(`[{"url":"https://www.youtube.com/watch?v=abc123","title":"Demo","position":1}]`)
	images := json.RawMessage(`[{"url":"https://cdn.example.com/img1.png","alt":"Diagram","position":1}]`)

	if err := svc.UpdateHelp(ctx, addrID, "en", addressables.HelpUpdate{
		Title:       &title,
		BodyHTML:    "<p>Body</p>",
		VideoEmbeds: videos,
		ImageURLs:   images,
	}, editorID); err != nil {
		t.Fatalf("UpdateHelp: %v", err)
	}

	doc, found, err := svc.HelpFor(ctx, addrID, "en")
	if err != nil {
		t.Fatalf("HelpFor: %v", err)
	}
	if !found {
		t.Fatalf("expected page_help row")
	}
	if doc.Title == nil || *doc.Title != title {
		t.Fatalf("title: got %v want %q", doc.Title, title)
	}
	if doc.BodyHTML != "<p>Body</p>" {
		t.Fatalf("body: got %q", doc.BodyHTML)
	}
	if !sameJSON(t, doc.VideoEmbeds, videos) {
		t.Fatalf("video_embeds: got %s want %s", doc.VideoEmbeds, videos)
	}
	if !sameJSON(t, doc.ImageURLs, images) {
		t.Fatalf("image_urls: got %s want %s", doc.ImageURLs, images)
	}

	// Clearing arrays via empty `[]` round-trips as `[]`, not NULL.
	if err := svc.UpdateHelp(ctx, addrID, "en", addressables.HelpUpdate{
		Title:       nil,
		BodyHTML:    "",
		VideoEmbeds: json.RawMessage(`[]`),
		ImageURLs:   json.RawMessage(`[]`),
	}, editorID); err != nil {
		t.Fatalf("UpdateHelp clear: %v", err)
	}
	doc, _, err = svc.HelpFor(ctx, addrID, "en")
	if err != nil {
		t.Fatalf("HelpFor: %v", err)
	}
	if doc.Title != nil {
		t.Fatalf("expected nil title after clear, got %q", *doc.Title)
	}
	if string(doc.VideoEmbeds) != "[]" {
		t.Fatalf("video_embeds after clear: got %s", doc.VideoEmbeds)
	}
	if string(doc.ImageURLs) != "[]" {
		t.Fatalf("image_urls after clear: got %s", doc.ImageURLs)
	}
}

func TestUpdateHelp_NotFoundReturnsSentinel(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()

	err := svc.UpdateHelp(ctx, uuid.New(), "en", addressables.HelpUpdate{
		BodyHTML:    "<p>nope</p>",
		VideoEmbeds: json.RawMessage(`[]`),
		ImageURLs:   json.RawMessage(`[]`),
	}, uuid.New())
	if !errors.Is(err, addressables.ErrParentNotFound) {
		t.Fatalf("got %v want ErrParentNotFound", err)
	}
}

// ─────────────────────────────────────────────────────────────────────
// Auto-seed idempotency (PLA-0008 / 00325).
//
// On first register a page_help row is created from the library
// default. On re-register (build reconcile or runtime mount) the
// existing row — including any gadmin edits — must be preserved.
// ─────────────────────────────────────────────────────────────────────

func TestSeedLibraryDefault_PreservesEditsAcrossReregister(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("seed_idem")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	tree := []addressables.BuildNode{{Kind: "panel", Name: "stable"}}
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, tree); err != nil {
		t.Fatalf("first register: %v", err)
	}
	snap, err := svc.Snapshot(ctx, route)
	if err != nil || len(snap) != 1 {
		t.Fatalf("snapshot: %v / len=%d", err, len(snap))
	}
	addrID := snap[0].ID

	// Library wildcard must have produced a body.
	doc, found, err := svc.HelpFor(ctx, addrID, "en")
	if err != nil || !found {
		t.Fatalf("expected seeded row: found=%v err=%v", found, err)
	}
	if doc.BodyHTML == "" {
		t.Fatalf("expected non-empty seeded body")
	}

	// Simulate a gadmin edit.
	var editorID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM users LIMIT 1`).Scan(&editorID); err != nil {
		t.Skipf("no users in dev DB: %v", err)
	}
	editedTitle := "Edited by gadmin"
	editedBody := "<p>Manual edit must survive re-register</p>"
	if err := svc.UpdateHelp(ctx, addrID, "en", addressables.HelpUpdate{
		Title:    &editedTitle,
		BodyHTML: editedBody,
	}, editorID); err != nil {
		t.Fatalf("UpdateHelp: %v", err)
	}

	// Re-register the same tree — must NOT clobber the edit.
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, tree); err != nil {
		t.Fatalf("second register: %v", err)
	}
	doc, _, err = svc.HelpFor(ctx, addrID, "en")
	if err != nil {
		t.Fatalf("HelpFor post-reregister: %v", err)
	}
	if doc.Title == nil || *doc.Title != editedTitle {
		t.Fatalf("title clobbered: got %v", doc.Title)
	}
	if doc.BodyHTML != editedBody {
		t.Fatalf("body clobbered: got %q want %q", doc.BodyHTML, editedBody)
	}
}

// ─────────────────────────────────────────────────────────────────────
// Placeholder fallback (PLA-0008 / 00325).
//
// When a build-time register fires for a (kind, name) that has no
// matching row in library_help_defaults — neither exact nor wildcard —
// seedLibraryDefault must still produce a page_help row so every
// addressable carries a discoverable, gadmin-editable help doc.
//
// The placeholder row contract:
//   • body_html = addressables.PlaceholderBodyHTML
//   • title NULL, video_embeds [], image_urls []
//   • seeded_from = 'placeholder'
//   • updated_by_user_id NULL (no editor)
//
// Idempotent on re-register (no library row appears in between).
// ─────────────────────────────────────────────────────────────────────

func TestSeedPlaceholder_NoLibraryDefault_Fallback(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("seed_ph")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	// 'button' has no library_help_defaults row (075 seeds only panel,
	// table, navigation wildcards). 102 adds panel:page_summary. Nothing
	// matches kind='button', so the placeholder branch must fire.
	tree := []addressables.BuildNode{{Kind: "button", Name: "save_x"}}
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, tree); err != nil {
		t.Fatalf("register: %v", err)
	}
	snap, err := svc.Snapshot(ctx, route)
	if err != nil || len(snap) != 1 {
		t.Fatalf("snapshot: err=%v len=%d", err, len(snap))
	}
	addrID := snap[0].ID

	doc, found, err := svc.HelpFor(ctx, addrID, "en")
	if err != nil || !found {
		t.Fatalf("expected placeholder row: found=%v err=%v", found, err)
	}
	if doc.Title != nil {
		t.Fatalf("expected nil title, got %q", *doc.Title)
	}
	if doc.BodyHTML != addressables.PlaceholderBodyHTML {
		t.Fatalf("body: got %q want %q", doc.BodyHTML, addressables.PlaceholderBodyHTML)
	}
	if string(doc.VideoEmbeds) != "[]" {
		t.Fatalf("video_embeds: got %s want []", doc.VideoEmbeds)
	}
	if string(doc.ImageURLs) != "[]" {
		t.Fatalf("image_urls: got %s want []", doc.ImageURLs)
	}

	// seeded_from / updated_by_user_id are not on HelpDoc — query directly.
	var seededFrom string
	var updatedBy *uuid.UUID
	if err := pool.QueryRow(ctx, `
		SELECT seeded_from, updated_by_user_id
		  FROM page_help
		 WHERE addressable_id = $1 AND locale = 'en' AND soft_archived = FALSE
	`, addrID).Scan(&seededFrom, &updatedBy); err != nil {
		t.Fatalf("query seeded_from: %v", err)
	}
	if seededFrom != "placeholder" {
		t.Fatalf("seeded_from: got %q want %q", seededFrom, "placeholder")
	}
	if updatedBy != nil {
		t.Fatalf("updated_by_user_id: got %v want nil", updatedBy)
	}
}

func TestSeedPlaceholder_IsIdempotentOnReRegister(t *testing.T) {
	pool := testPool(t)
	svc := addressables.New(pool, false)
	ctx := context.Background()
	route := uniqueRoute("seed_ph_idem")
	t.Cleanup(func() { cleanupRoute(t, pool, route) })

	tree := []addressables.BuildNode{{Kind: "heading", Name: "section_a"}}

	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, tree); err != nil {
		t.Fatalf("first register: %v", err)
	}
	snap, err := svc.Snapshot(ctx, route)
	if err != nil || len(snap) != 1 {
		t.Fatalf("snapshot: err=%v len=%d", err, len(snap))
	}
	addrID := snap[0].ID

	// Capture the row's identity + timestamp after the first seed.
	var helpID1 uuid.UUID
	var updatedAt1 string
	if err := pool.QueryRow(ctx, `
		SELECT id, updated_at::text
		  FROM page_help
		 WHERE addressable_id = $1 AND locale = 'en' AND soft_archived = FALSE
	`, addrID).Scan(&helpID1, &updatedAt1); err != nil {
		t.Fatalf("first query: %v", err)
	}

	// Re-register the same tree. ON CONFLICT DO NOTHING means the row
	// must remain byte-identical (same id, same updated_at).
	if _, err := svc.RegisterFromBuild(ctx, route, addressables.SlotApp, tree); err != nil {
		t.Fatalf("second register: %v", err)
	}
	var helpID2 uuid.UUID
	var updatedAt2 string
	var seededFrom string
	if err := pool.QueryRow(ctx, `
		SELECT id, updated_at::text, seeded_from
		  FROM page_help
		 WHERE addressable_id = $1 AND locale = 'en' AND soft_archived = FALSE
	`, addrID).Scan(&helpID2, &updatedAt2, &seededFrom); err != nil {
		t.Fatalf("second query: %v", err)
	}
	if helpID1 != helpID2 {
		t.Fatalf("row replaced: id1=%s id2=%s", helpID1, helpID2)
	}
	if updatedAt1 != updatedAt2 {
		t.Fatalf("row updated_at changed: %q vs %q", updatedAt1, updatedAt2)
	}
	if seededFrom != "placeholder" {
		t.Fatalf("seeded_from: got %q want %q", seededFrom, "placeholder")
	}
}

// sameJSON reports whether two JSON payloads represent the same value
// regardless of whitespace or key order. Postgres re-serialises JSONB
// with spaces, so byte-equality on the raw payload is too strict.
func sameJSON(t *testing.T, a, b json.RawMessage) bool {
	t.Helper()
	var av, bv any
	if err := json.Unmarshal(a, &av); err != nil {
		t.Fatalf("sameJSON: a not valid json: %v", err)
	}
	if err := json.Unmarshal(b, &bv); err != nil {
		t.Fatalf("sameJSON: b not valid json: %v", err)
	}
	ab, _ := json.Marshal(av)
	bb, _ := json.Marshal(bv)
	return string(ab) == string(bb)
}
