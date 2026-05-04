package orgdesign_test

// Tests for the workspace clamp middleware (PLA-0006 / story 00378).
//
// The middleware has two surfaces:
//
//   1. WorkspaceClampMiddleware itself — a chi middleware that resolves
//      the request's workspace and stamps workspaceCtxKey on the
//      context. We exercise it with a fakeWorkspaceLookup so the unit
//      shell stays deterministic and tunnel-independent.
//
//   2. PoolWorkspaceLookup — the production adapter that runs three
//      SELECTs against `workspaces` and `workspace_roles`. We exercise
//      it against the live dev DB through testPool / mkTenant so the
//      SQL is verified end-to-end. Tunnel-down → t.Skip per the rest
//      of the suite.
//
// Coverage map:
//
//   AC1 (no ?ws → first live workspace; 403 no_workspace if none)
//     → TestWorkspaceClamp_NoSlug_FirstLive
//     → TestWorkspaceClamp_NoSlug_NoLiveWorkspace_403
//
//   AC2 (?ws=<slug> → 404 if slug not in tenant)
//     → TestWorkspaceClamp_Slug_NotInTenant_404
//
//   AC3 (no role on resolved workspace → 403, NOT 200-empty)
//     → TestWorkspaceClamp_NoRoleOnWorkspace_403
//
//   AC4 (resolved workspace_id seeded on context for downstream reads)
//     → TestWorkspaceClamp_SeedsContext
//
//   PoolWorkspaceLookup integration (tenant-scoped SQL)
//     → TestPoolWorkspaceLookup_FirstLive_OrdersByCreatedAtAndIgnoresArchived
//     → TestPoolWorkspaceLookup_ResolveSlug_TenantScoped
//     → TestPoolWorkspaceLookup_HasActiveRole_RevokedExcluded

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/orgdesign"
	"github.com/mmffdev/vector-backend/internal/roles"
)

// ──────────────────────────────────────────────────────────────────────
// Fake WorkspaceLookup for the unit-shell tests
// ──────────────────────────────────────────────────────────────────────

type fakeWorkspaceLookup struct {
	firstLive       map[uuid.UUID]uuid.UUID         // subscriptionID → workspaceID (or zero = ErrNoWorkspace)
	bySlug          map[string]uuid.UUID            // (subID|slug) → workspaceID
	byID            map[string]uuid.UUID            // (subID|workspaceID) → workspaceID (for ResolveRef UUID branch)
	role            map[string]bool                 // (workspaceID|userID) → has-role
	firstLiveErr    error                           // forced error for FirstLiveWorkspace
	resolveSlugErr  error                           // forced error for ResolveSlug
	resolveRefErr   error                           // forced error for ResolveRef
	hasActiveRoleErr error                          // forced error for HasActiveRole
}

func (f *fakeWorkspaceLookup) FirstLiveWorkspace(_ context.Context, sub uuid.UUID) (uuid.UUID, error) {
	if f.firstLiveErr != nil {
		return uuid.Nil, f.firstLiveErr
	}
	id, ok := f.firstLive[sub]
	if !ok || id == uuid.Nil {
		return uuid.Nil, orgdesign.ErrNoWorkspace
	}
	return id, nil
}

func (f *fakeWorkspaceLookup) ResolveSlug(_ context.Context, sub uuid.UUID, slug string) (uuid.UUID, error) {
	if f.resolveSlugErr != nil {
		return uuid.Nil, f.resolveSlugErr
	}
	key := sub.String() + "|" + slug
	id, ok := f.bySlug[key]
	if !ok {
		return uuid.Nil, orgdesign.ErrWorkspaceNotFound
	}
	return id, nil
}

func (f *fakeWorkspaceLookup) ResolveRef(ctx context.Context, sub uuid.UUID, ref string) (uuid.UUID, error) {
	if f.resolveRefErr != nil {
		return uuid.Nil, f.resolveRefErr
	}
	if id, err := uuid.Parse(ref); err == nil {
		key := sub.String() + "|" + id.String()
		got, ok := f.byID[key]
		if !ok {
			return uuid.Nil, orgdesign.ErrWorkspaceNotFound
		}
		return got, nil
	}
	return f.ResolveSlug(ctx, sub, ref)
}

func (f *fakeWorkspaceLookup) HasActiveRole(_ context.Context, ws, u uuid.UUID) (bool, error) {
	if f.hasActiveRoleErr != nil {
		return false, f.hasActiveRoleErr
	}
	return f.role[ws.String()+"|"+u.String()], nil
}

// ──────────────────────────────────────────────────────────────────────
// Tiny harness: build a chi-style chain (auth.WithUserForTest →
// WorkspaceClampMiddleware → terminal handler that records the seeded
// workspace_id) and fire one request through it.
// ──────────────────────────────────────────────────────────────────────

type seenCtx struct {
	workspaceID uuid.UUID
	hasClamp    bool
}

func runClamp(
	t *testing.T,
	lookup orgdesign.WorkspaceLookup,
	user *models.User,
	queryString string,
) (*httptest.ResponseRecorder, *seenCtx) {
	t.Helper()
	seen := &seenCtx{}
	terminal := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := orgdesign.WorkspaceIDFromCtx(r.Context())
		seen.workspaceID = id
		seen.hasClamp = ok
		w.WriteHeader(http.StatusOK)
	})
	clamp := orgdesign.WorkspaceClampMiddleware(lookup)(terminal)

	url := "/api/topology/tree"
	if queryString != "" {
		url += "?" + queryString
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	if user != nil {
		req = req.WithContext(auth.WithUserForTest(req.Context(), user))
	}
	rec := httptest.NewRecorder()
	clamp.ServeHTTP(rec, req)
	return rec, seen
}

// readErrCode parses a {"error":"<code>"} body — the shape
// writeWorkspaceClampError emits.
func readErrCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v (body=%q)", err, rec.Body.String())
	}
	return body["error"]
}

// ──────────────────────────────────────────────────────────────────────
// AC1 — no ?ws: resolve to actor's first live workspace; 403 no_workspace
// when the tenant has zero live workspaces.
// ──────────────────────────────────────────────────────────────────────

func TestWorkspaceClamp_NoSlug_FirstLive(t *testing.T) {
	subID := uuid.New()
	wsID := uuid.New()
	user := &models.User{ID: uuid.New(), SubscriptionID: subID}

	lookup := &fakeWorkspaceLookup{
		firstLive: map[uuid.UUID]uuid.UUID{subID: wsID},
		role:      map[string]bool{wsID.String() + "|" + user.ID.String(): true},
	}

	rec, seen := runClamp(t, lookup, user, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if !seen.hasClamp {
		t.Fatalf("workspace clamp not seeded on context")
	}
	if seen.workspaceID != wsID {
		t.Fatalf("workspace_id: want %s, got %s", wsID, seen.workspaceID)
	}
}

func TestWorkspaceClamp_NoSlug_NoLiveWorkspace_403(t *testing.T) {
	subID := uuid.New()
	user := &models.User{ID: uuid.New(), SubscriptionID: subID}

	// firstLive map is empty for this subscription → ErrNoWorkspace.
	lookup := &fakeWorkspaceLookup{
		firstLive: map[uuid.UUID]uuid.UUID{},
		role:      map[string]bool{},
	}

	rec, _ := runClamp(t, lookup, user, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if got := readErrCode(t, rec); got != "no_workspace" {
		t.Fatalf("error code: want no_workspace, got %q", got)
	}
}

// ──────────────────────────────────────────────────────────────────────
// AC2 — ?ws=<slug>: 404 when slug not in tenant.
// ──────────────────────────────────────────────────────────────────────

func TestWorkspaceClamp_Slug_NotInTenant_404(t *testing.T) {
	subID := uuid.New()
	user := &models.User{ID: uuid.New(), SubscriptionID: subID}

	// bySlug map is empty → ErrWorkspaceNotFound.
	lookup := &fakeWorkspaceLookup{
		firstLive: map[uuid.UUID]uuid.UUID{subID: uuid.New()}, // shouldn't be hit
		bySlug:    map[string]uuid.UUID{},
	}

	rec, _ := runClamp(t, lookup, user, "ws=ghost")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if got := readErrCode(t, rec); got != "workspace_not_found" {
		t.Fatalf("error code: want workspace_not_found, got %q", got)
	}
}

func TestWorkspaceClamp_Slug_Resolves_Passes(t *testing.T) {
	subID := uuid.New()
	wsID := uuid.New()
	user := &models.User{ID: uuid.New(), SubscriptionID: subID}

	lookup := &fakeWorkspaceLookup{
		bySlug: map[string]uuid.UUID{
			subID.String() + "|finance": wsID,
		},
		role: map[string]bool{wsID.String() + "|" + user.ID.String(): true},
	}

	rec, seen := runClamp(t, lookup, user, "ws=finance")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if !seen.hasClamp || seen.workspaceID != wsID {
		t.Fatalf("ctx clamp: want hasClamp=true ws=%s, got hasClamp=%v ws=%s",
			wsID, seen.hasClamp, seen.workspaceID)
	}
}

// ──────────────────────────────────────────────────────────────────────
// AC3 — actor has no active role on the resolved workspace: 403, not
// 200-empty. The check applies on BOTH the slug-resolved and first-live
// branches so a sibling-workspace probe can't sneak through.
// ──────────────────────────────────────────────────────────────────────

func TestWorkspaceClamp_NoRoleOnWorkspace_403(t *testing.T) {
	subID := uuid.New()
	wsID := uuid.New()
	user := &models.User{ID: uuid.New(), SubscriptionID: subID}

	lookup := &fakeWorkspaceLookup{
		bySlug: map[string]uuid.UUID{
			subID.String() + "|finance": wsID,
		},
		// no role granted → HasActiveRole returns false
		role: map[string]bool{},
	}

	rec, _ := runClamp(t, lookup, user, "ws=finance")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if got := readErrCode(t, rec); got != "no_workspace_role" {
		t.Fatalf("error code: want no_workspace_role, got %q", got)
	}
}

func TestWorkspaceClamp_NoRoleOnFirstLive_403(t *testing.T) {
	// First-live path also enforces the role check — so a tenant whose
	// actor has zero workspace_roles can't read by accident even when
	// the slug is omitted.
	subID := uuid.New()
	wsID := uuid.New()
	user := &models.User{ID: uuid.New(), SubscriptionID: subID}

	lookup := &fakeWorkspaceLookup{
		firstLive: map[uuid.UUID]uuid.UUID{subID: wsID},
		role:      map[string]bool{}, // no grant
	}

	rec, _ := runClamp(t, lookup, user, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if got := readErrCode(t, rec); got != "no_workspace_role" {
		t.Fatalf("error code: want no_workspace_role, got %q", got)
	}
}

// ──────────────────────────────────────────────────────────────────────
// Auth missing — defence-in-depth check that the middleware refuses to
// run without auth.UserFromCtx (mounting it without RequireAuth is a
// programming error, but we don't want to regress to a panic).
// ──────────────────────────────────────────────────────────────────────

func TestWorkspaceClamp_NoAuth_401(t *testing.T) {
	lookup := &fakeWorkspaceLookup{}
	rec, _ := runClamp(t, lookup, nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: want 401, got %d", rec.Code)
	}
}

// ──────────────────────────────────────────────────────────────────────
// AC4 — workspace_id is seeded on context for downstream service-layer
// reads to splice into their WHERE clauses.
// ──────────────────────────────────────────────────────────────────────

func TestWorkspaceClamp_SeedsContext(t *testing.T) {
	subID := uuid.New()
	wsID := uuid.New()
	user := &models.User{ID: uuid.New(), SubscriptionID: subID}

	lookup := &fakeWorkspaceLookup{
		firstLive: map[uuid.UUID]uuid.UUID{subID: wsID},
		role:      map[string]bool{wsID.String() + "|" + user.ID.String(): true},
	}

	_, seen := runClamp(t, lookup, user, "")
	if !seen.hasClamp {
		t.Fatalf("WorkspaceIDFromCtx returned ok=false; clamp not seeded")
	}
	if seen.workspaceID != wsID {
		t.Fatalf("WorkspaceIDFromCtx: want %s, got %s", wsID, seen.workspaceID)
	}
}

// Lookup-side plumbing errors (DB down) MUST NOT leak as 200 — they
// surface as 500. Caller can distinguish from the typed 403/404 via
// status code.
func TestWorkspaceClamp_LookupError_500(t *testing.T) {
	subID := uuid.New()
	user := &models.User{ID: uuid.New(), SubscriptionID: subID}

	boom := errors.New("db down")
	lookup := &fakeWorkspaceLookup{firstLiveErr: boom}

	rec, _ := runClamp(t, lookup, user, "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────
// PoolWorkspaceLookup integration — exercises the real SQL against the
// dev DB. Skips if the SSH tunnel is down.
// ──────────────────────────────────────────────────────────────────────

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
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping DB (tunnel down?): %v", err)
	}
	return pool
}

// mkTenant inserts a throwaway subscription + a single user inside it.
// Returns (subID, userID, cleanup) — cleanup deletes the workspaces +
// workspace_roles rows the tests under test create, then unwinds the
// tenant. Mirrors the cleanup leaf list from workspaces/handler_test.go.
func mkTenant(t *testing.T, pool *pgxpool.Pool, label string) (uuid.UUID, uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.NewString()[:8]

	var subID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO subscriptions (name, slug) VALUES ($1, $2) RETURNING id`,
		"ws-clamp-"+label+"-"+suffix, "ws-clamp-"+label+"-"+suffix,
	).Scan(&subID); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}

	var userID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (subscription_id, email, password_hash, role, role_id)
		VALUES ($1, $2, $3, 'gadmin', $4)
		RETURNING id
	`, subID, "u-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
		roles.SystemRoleGadmin,
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	cleanup := func() {
		stmts := []string{
			`DELETE FROM workspace_roles             WHERE subscription_id = $1`,
			`DELETE FROM workspaces                  WHERE subscription_id = $1`,
			`DELETE FROM workspace                   WHERE subscription_id = $1`,
			`DELETE FROM users                       WHERE subscription_id = $1`,
			`DELETE FROM subscriptions               WHERE id = $1`,
		}
		for _, sql := range stmts {
			if _, err := pool.Exec(ctx, sql, subID); err != nil {
				t.Errorf("cleanup tenant %s: %s: %v", label, sql, err)
			}
		}
	}
	return subID, userID, cleanup
}

// seedWorkspace inserts a workspace row directly. The sole-writer rule
// gates writes through workspaces.Service; tests are exempt — same
// posture as the workspaces handler tests.
func seedWorkspace(t *testing.T, pool *pgxpool.Pool, subID, createdBy uuid.UUID, name, slug string, archived bool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	q := `INSERT INTO workspaces (subscription_id, name, slug, created_by)
	      VALUES ($1, $2, $3, $4) RETURNING id`
	if err := pool.QueryRow(context.Background(), q, subID, name, slug, createdBy).Scan(&id); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if archived {
		if _, err := pool.Exec(context.Background(),
			`UPDATE workspaces SET archived_at = NOW(), archived_by = $1 WHERE id = $2`,
			createdBy, id,
		); err != nil {
			t.Fatalf("archive seed workspace: %v", err)
		}
	}
	return id
}

func seedWorkspaceRole(t *testing.T, pool *pgxpool.Pool, subID, wsID, userID, grantedBy uuid.UUID, role string, revoked bool) {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO workspace_roles (subscription_id, workspace_id, user_id, role, can_redelegate, granted_by)
		VALUES ($1, $2, $3, $4, FALSE, $5)
		RETURNING id
	`, subID, wsID, userID, role, grantedBy).Scan(&id); err != nil {
		t.Fatalf("seed workspace_role: %v", err)
	}
	if revoked {
		if _, err := pool.Exec(context.Background(),
			`UPDATE workspace_roles SET revoked_at = NOW(), revoked_by = $1 WHERE id = $2`,
			grantedBy, id,
		); err != nil {
			t.Fatalf("revoke seed grant: %v", err)
		}
	}
}

// FirstLiveWorkspace must order by created_at ASC and skip archived
// rows. Default-style workspace lands first; archived rows never lead.
func TestPoolWorkspaceLookup_FirstLive_OrdersByCreatedAtAndIgnoresArchived(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subID, userID, cleanup := mkTenant(t, pool, "first-live")
	defer cleanup()

	// ws-1 (live, oldest) — should be returned.
	ws1 := seedWorkspace(t, pool, subID, userID, "Default", "default", false)
	// ws-2 (archived) — must be skipped.
	_ = seedWorkspace(t, pool, subID, userID, "Old", "old", true)
	// ws-3 (live, newer) — order check: created_at ASC means ws1 wins.
	_ = seedWorkspace(t, pool, subID, userID, "Finance", "finance", false)

	got, err := orgdesign.PoolWorkspaceLookup{Pool: pool}.FirstLiveWorkspace(context.Background(), subID)
	if err != nil {
		t.Fatalf("FirstLiveWorkspace: %v", err)
	}
	if got != ws1 {
		t.Fatalf("FirstLiveWorkspace: want %s (Default), got %s", ws1, got)
	}
}

// FirstLiveWorkspace returns ErrNoWorkspace when the tenant has zero
// live workspaces (only archived ones, or none at all).
func TestPoolWorkspaceLookup_FirstLive_NoLive_ReturnsErr(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subID, userID, cleanup := mkTenant(t, pool, "no-live")
	defer cleanup()

	// Only archived workspaces in this tenant.
	_ = seedWorkspace(t, pool, subID, userID, "Old", "old", true)

	_, err := orgdesign.PoolWorkspaceLookup{Pool: pool}.FirstLiveWorkspace(context.Background(), subID)
	if !errors.Is(err, orgdesign.ErrNoWorkspace) {
		t.Fatalf("FirstLiveWorkspace: want ErrNoWorkspace, got %v", err)
	}
}

// ResolveSlug is tenant-scoped: a slug present in subscription A is
// invisible to a lookup against subscription B (404).
func TestPoolWorkspaceLookup_ResolveSlug_TenantScoped(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subA, userA, cleanupA := mkTenant(t, pool, "slug-a")
	defer cleanupA()
	subB, _, cleanupB := mkTenant(t, pool, "slug-b")
	defer cleanupB()

	wsA := seedWorkspace(t, pool, subA, userA, "Finance", "finance", false)

	lookup := orgdesign.PoolWorkspaceLookup{Pool: pool}

	// Subscription A sees its own "finance" slug.
	got, err := lookup.ResolveSlug(context.Background(), subA, "finance")
	if err != nil {
		t.Fatalf("ResolveSlug(A, finance): %v", err)
	}
	if got != wsA {
		t.Fatalf("ResolveSlug(A, finance): want %s, got %s", wsA, got)
	}

	// Subscription B does NOT — cross-tenant query must surface
	// ErrWorkspaceNotFound (which the middleware translates to 404).
	_, err = lookup.ResolveSlug(context.Background(), subB, "finance")
	if !errors.Is(err, orgdesign.ErrWorkspaceNotFound) {
		t.Fatalf("ResolveSlug(B, finance): want ErrWorkspaceNotFound, got %v", err)
	}
}

// ResolveSlug also skips archived workspaces — a tenant that archived
// "finance" and reused the slug-name later still resolves only the
// live row.
func TestPoolWorkspaceLookup_ResolveSlug_IgnoresArchived(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subID, userID, cleanup := mkTenant(t, pool, "slug-arch")
	defer cleanup()

	// Archived row with slug "finance".
	_ = seedWorkspace(t, pool, subID, userID, "Old", "finance", true)

	// Note: the partial unique index workspaces_subscription_slug_live
	// only fires when archived_at IS NULL, so we can re-use "finance"
	// for a live row in the same tenant.
	live := seedWorkspace(t, pool, subID, userID, "New", "finance", false)

	got, err := orgdesign.PoolWorkspaceLookup{Pool: pool}.ResolveSlug(context.Background(), subID, "finance")
	if err != nil {
		t.Fatalf("ResolveSlug: %v", err)
	}
	if got != live {
		t.Fatalf("ResolveSlug: want live %s, got %s", live, got)
	}
}

// HasActiveRole returns true for an active grant and false for a
// revoked one (revoked_at IS NOT NULL).
func TestPoolWorkspaceLookup_HasActiveRole_RevokedExcluded(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subID, userID, cleanup := mkTenant(t, pool, "role-revoked")
	defer cleanup()

	wsID := seedWorkspace(t, pool, subID, userID, "Default", "default", false)
	seedWorkspaceRole(t, pool, subID, wsID, userID, userID, "admin", false)

	lookup := orgdesign.PoolWorkspaceLookup{Pool: pool}

	got, err := lookup.HasActiveRole(context.Background(), wsID, userID)
	if err != nil {
		t.Fatalf("HasActiveRole (active): %v", err)
	}
	if !got {
		t.Fatalf("HasActiveRole (active): want true, got false")
	}

	// A different user has no grant on this workspace.
	got, err = lookup.HasActiveRole(context.Background(), wsID, uuid.New())
	if err != nil {
		t.Fatalf("HasActiveRole (other user): %v", err)
	}
	if got {
		t.Fatalf("HasActiveRole (other user): want false, got true")
	}

	// Revoke the original grant; HasActiveRole now returns false.
	if _, err := pool.Exec(context.Background(),
		`UPDATE workspace_roles SET revoked_at = NOW(), revoked_by = $1
		 WHERE workspace_id = $2 AND user_id = $3`,
		userID, wsID, userID,
	); err != nil {
		t.Fatalf("revoke grant: %v", err)
	}
	got, err = lookup.HasActiveRole(context.Background(), wsID, userID)
	if err != nil {
		t.Fatalf("HasActiveRole (revoked): %v", err)
	}
	if got {
		t.Fatalf("HasActiveRole (revoked): want false, got true")
	}
}

// End-to-end through the middleware against the live DB: actor with a
// role on the resolved workspace gets 200 + the workspace_id stamped
// on context. Confirms PoolWorkspaceLookup wires correctly into
// WorkspaceClampMiddleware.
func TestWorkspaceClamp_LiveDB_PassesThrough(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	subID, userID, cleanup := mkTenant(t, pool, "e2e")
	defer cleanup()

	wsID := seedWorkspace(t, pool, subID, userID, "Default", "default", false)
	seedWorkspaceRole(t, pool, subID, wsID, userID, userID, "admin", false)

	user := &models.User{ID: userID, SubscriptionID: subID}
	lookup := orgdesign.PoolWorkspaceLookup{Pool: pool}

	rec, seen := runClamp(t, lookup, user, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if !seen.hasClamp || seen.workspaceID != wsID {
		t.Fatalf("ctx clamp: want hasClamp=true ws=%s, got hasClamp=%v ws=%s",
			wsID, seen.hasClamp, seen.workspaceID)
	}
}
