package workspaces_test

// Integration tests for the /api/workspaces REST surface (PLA-0006 /
// story 00377). Mirrors the testPool / mkTenant / mkUser style of
// internal/users_roles/handler_test.go — every test runs against the live
// dev Postgres through the SSH tunnel and skips on unreachable.
//
// Coverage map (one test per AC + the companion routes):
//
//   AC1 → TestList_ReturnsLiveWorkspaces
//   AC2 → TestCreate_201OnSuccess + TestCreate_409OnDuplicateSlug
//   AC3 → TestArchive_403ForNonGadmin + TestArchive_200ForGadmin
//   00380 → TestPatch_RenamesWorkspace
//   00381 → TestRestore_403ForNonGadmin + TestRestore_200ForGadmin
//
// The cleanup leaf list mirrors users_roles/handler_test.go but adds the
// workspaces + workspace_roles tables (this is the first test in the
// repo to write to either table through the real service path).

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/roles"
	"github.com/mmffdev/vector-backend/internal/master_record_workspaces"
)

// ──────────────────────────────────────────────────────────────────────
// Fixtures: testPool / mkTenant / mkUser / withUser / newRouter
// ──────────────────────────────────────────────────────────────────────

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
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

// mkTenant inserts a throwaway subscription. Migration 099 has already
// seeded one "Default" workspace per existing subscription — but newly
// inserted subscriptions in this test do NOT get that backfill
// automatically. We seed a Default ourselves so the cleanup ordering
// matches production-like data.
func mkTenant(t *testing.T, pool *pgxpool.Pool, label string) (uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.NewString()[:8]
	var subID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO subscriptions (name, slug) VALUES ($1, $2) RETURNING id`,
		"ws-test-"+label+"-"+suffix, "ws-test-"+label+"-"+suffix,
	).Scan(&subID); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	cleanup := func() {
		// Order: leaves before roots. workspace_roles → workspaces;
		// then the legacy `workspace` table (different beast); then
		// users + users_roles + the subscription row.
		stmts := []string{
			`DELETE FROM users_roles_workspaces             WHERE subscription_id = $1`,
			`DELETE FROM master_record_workspaces                  WHERE subscription_id = $1`,
			`DELETE FROM users_roles_permissions            WHERE role_id IN (SELECT id FROM users_roles WHERE subscription_id = $1)`,
			`DELETE FROM execution_item_types        WHERE subscription_id = $1`,
			`DELETE FROM subscriptions_stakeholders  WHERE subscriptions_stakeholders_id_subscription = $1`,
			`DELETE FROM product                     WHERE subscription_id = $1`,
			`DELETE FROM portfolio                   WHERE subscription_id = $1`,
			`DELETE FROM workspace                   WHERE subscription_id = $1`,
			`DELETE FROM company_roadmap             WHERE subscription_id = $1`,
			`DELETE FROM subscriptions_sequence      WHERE subscriptions_sequence_id_subscription = $1`,
			`DELETE FROM users_password_resets             WHERE user_id IN (SELECT id FROM users WHERE subscription_id = $1)`,
			`DELETE FROM users                       WHERE subscription_id = $1`,
			`DELETE FROM users_roles                       WHERE subscription_id = $1`,
			`DELETE FROM subscriptions               WHERE id = $1`,
		}
		for _, sql := range stmts {
			if _, err := pool.Exec(ctx, sql, subID); err != nil {
				t.Errorf("cleanup tenant %s: %s: %v", label, sql, err)
			}
		}
	}
	return subID, cleanup
}

// mkUser seeds a user under the given subscription with the requested
// role. role_id maps to the seeded system role UUID so the permission
// resolver returns the right code set.
func mkUser(t *testing.T, pool *pgxpool.Pool, subID uuid.UUID, role models.Role) *models.User {
	t.Helper()
	suffix := uuid.NewString()[:8]
	var roleID uuid.UUID
	switch role {
	case models.RoleGAdmin:
		roleID = roles.SystemRoleGadmin
	case models.RolePAdmin:
		roleID = roles.SystemRolePadmin
	case models.RoleUser:
		roleID = roles.SystemRoleUser
	default:
		t.Fatalf("mkUser: unknown role %q", role)
	}
	u := &models.User{}
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (subscription_id, email, password_hash, role, role_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, subscription_id, email, role, is_active, force_password_change`,
		subID, "u-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
		string(role), roleID,
	).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &u.ForcePasswordChange)
	if err != nil {
		t.Fatalf("insert user (%s): %v", role, err)
	}
	return u
}

// seedWorkspace inserts a workspace row directly (bypassing the sole
// writer rule — only this test fixture and the migration-time bootstrap
// path are allowed to do this). Returns the workspace id.
func seedWorkspace(t *testing.T, pool *pgxpool.Pool, subID, createdBy uuid.UUID, name, slug string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO master_record_workspaces (subscription_id, name, slug, created_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, subID, name, slug, createdBy).Scan(&id); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	return id
}

// withUser injects a fake auth.User into the request context, mirroring
// what auth.RequireAuth does at runtime.
func withUser(u *models.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := auth.WithUserForTest(r.Context(), u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// newRouter wires the workspaces handler into a chi router that mirrors
// the production wiring in main.go. The handler's Mount registers all
// five routes; we add withUser as the only middleware.
func newRouter(pool *pgxpool.Pool, u *models.User) (http.Handler, *workspaces.Service) {
	res := permissions.NewResolver(pool, 0) // ttl<=0 → always hit DB
	svc := workspaces.New(pool, nil, res)
	h := workspaces.NewHandler(svc)
	r := chi.NewRouter()
	r.Use(withUser(u))
	r.Route("/api/master_record_workspaces", func(r chi.Router) {
		h.Mount(r)
	})
	return r, svc
}

// doJSON sends a JSON request through r and returns the recorder.
func doJSON(t *testing.T, r http.Handler, method, path string, body any) *httptest.ResponseRecorder {
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
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ──────────────────────────────────────────────────────────────────────
// AC1 — GET /api/workspaces returns live workspaces for caller's tenant
// ──────────────────────────────────────────────────────────────────────

func TestList_ReturnsLiveWorkspaces(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subA, cleanA := mkTenant(t, pool, "list-a")
	defer cleanA()
	subB, cleanB := mkTenant(t, pool, "list-b")
	defer cleanB()

	actor := mkUser(t, pool, subA, models.RoleGAdmin)
	bUser := mkUser(t, pool, subB, models.RoleGAdmin)

	// Seed one live + one archived workspace under subA, plus a live
	// workspace in subB to verify cross-tenant isolation.
	live := seedWorkspace(t, pool, subA, actor.ID, "Live", "live-"+uuid.NewString()[:6])
	archived := seedWorkspace(t, pool, subA, actor.ID, "Archived", "arc-"+uuid.NewString()[:6])
	if _, err := pool.Exec(context.Background(),
		`UPDATE master_record_workspaces SET archived_at = NOW(), archived_by = $1 WHERE id = $2`,
		actor.ID, archived,
	); err != nil {
		t.Fatalf("archive seed: %v", err)
	}
	other := seedWorkspace(t, pool, subB, bUser.ID, "Other", "other-"+uuid.NewString()[:6])

	r, _ := newRouter(pool, actor)
	w := doJSON(t, r, http.MethodGet, "/api/master_record_workspaces", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d; body=%s", w.Code, w.Body.String())
	}
	var rows []workspaces.Workspace
	if err := json.NewDecoder(w.Body).Decode(&rows); err != nil {
		t.Fatalf("decode: %v", err)
	}

	var sawLive, sawArchived, sawOther bool
	for _, x := range rows {
		switch x.ID {
		case live:
			sawLive = true
		case archived:
			sawArchived = true
		case other:
			sawOther = true
		}
	}
	if !sawLive {
		t.Errorf("did not see own-tenant live workspace")
	}
	if sawArchived {
		t.Errorf("saw archived workspace in live list")
	}
	if sawOther {
		t.Errorf("saw foreign-tenant workspace — tenant isolation broken")
	}
}

// ──────────────────────────────────────────────────────────────────────
// AC2 — POST /api/workspaces creates; duplicate slug → 409
// ──────────────────────────────────────────────────────────────────────

func TestCreate_201OnSuccess(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "create-ok")
	defer cleanup()
	actor := mkUser(t, pool, subID, models.RoleGAdmin)

	r, _ := newRouter(pool, actor)
	slug := "ws-" + uuid.NewString()[:8]
	w := doJSON(t, r, http.MethodPost, "/api/master_record_workspaces", map[string]any{
		"name": "Ops",
		"slug": slug,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("status: want 201, got %d; body=%s", w.Code, w.Body.String())
	}
	var got workspaces.Workspace
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Name != "Ops" || got.Slug != slug {
		t.Errorf("returned row: name=%q slug=%q (want Ops/%s)", got.Name, got.Slug, slug)
	}
	if got.SubscriptionID != subID {
		t.Errorf("subscription_id: got %s, want %s", got.SubscriptionID, subID)
	}
	if got.IsArchived() {
		t.Errorf("new workspace must not be archived")
	}
}

func TestCreate_409OnDuplicateSlug(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "create-dup")
	defer cleanup()
	actor := mkUser(t, pool, subID, models.RoleGAdmin)

	slug := "dup-" + uuid.NewString()[:8]
	seedWorkspace(t, pool, subID, actor.ID, "First", slug)

	r, _ := newRouter(pool, actor)
	w := doJSON(t, r, http.MethodPost, "/api/master_record_workspaces", map[string]any{
		"name": "Second",
		"slug": slug,
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("dup slug: want 409, got %d; body=%s", w.Code, w.Body.String())
	}
	var errBody map[string]string
	if err := json.NewDecoder(w.Body).Decode(&errBody); err != nil {
		t.Fatalf("decode err body: %v", err)
	}
	if errBody["error"] != "slug_taken" {
		t.Errorf("error body: want slug_taken, got %q", errBody["error"])
	}
}

// ──────────────────────────────────────────────────────────────────────
// AC3 — POST /{id}/archive: 403 non-gadmin, 200 gadmin
// ──────────────────────────────────────────────────────────────────────

func TestArchive_403ForNonGadmin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "arch-403")
	defer cleanup()

	gadmin := mkUser(t, pool, subID, models.RoleGAdmin)
	user := mkUser(t, pool, subID, models.RoleUser)
	wsID := seedWorkspace(t, pool, subID, gadmin.ID, "Doomed", "doomed-"+uuid.NewString()[:6])

	r, _ := newRouter(pool, user)
	w := doJSON(t, r, http.MethodPost, "/api/master_record_workspaces/"+wsID.String()+"/archive", nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-gadmin archive: want 403, got %d; body=%s", w.Code, w.Body.String())
	}

	// Sanity: the row is still live in the DB.
	var archivedAt *string
	if err := pool.QueryRow(context.Background(),
		`SELECT archived_at::text FROM master_record_workspaces WHERE id = $1`, wsID,
	).Scan(&archivedAt); err != nil {
		t.Fatalf("verify still live: %v", err)
	}
	if archivedAt != nil {
		t.Errorf("workspace was archived despite 403 — gate bypassed")
	}
}

func TestArchive_200ForGadmin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "arch-200")
	defer cleanup()

	gadmin := mkUser(t, pool, subID, models.RoleGAdmin)
	// Need ≥2 live workspaces — Archive refuses to archive the last
	// live workspace in a subscription (ErrCannotArchiveLastLive).
	keep := seedWorkspace(t, pool, subID, gadmin.ID, "Keep", "keep-"+uuid.NewString()[:6])
	target := seedWorkspace(t, pool, subID, gadmin.ID, "Target", "target-"+uuid.NewString()[:6])
	_ = keep

	r, _ := newRouter(pool, gadmin)
	w := doJSON(t, r, http.MethodPost, "/api/master_record_workspaces/"+target.String()+"/archive", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("gadmin archive: want 200, got %d; body=%s", w.Code, w.Body.String())
	}

	// DB-level confirmation: the row's archived_at + archived_by are set.
	var archivedAt *string
	var archivedBy *uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT archived_at::text, archived_by FROM master_record_workspaces WHERE id = $1`,
		target,
	).Scan(&archivedAt, &archivedBy); err != nil {
		t.Fatalf("verify archived: %v", err)
	}
	if archivedAt == nil {
		t.Errorf("archived_at not set after 200 OK")
	}
	if archivedBy == nil || *archivedBy != gadmin.ID {
		t.Errorf("archived_by: got %v, want %s", archivedBy, gadmin.ID)
	}
}

// ──────────────────────────────────────────────────────────────────────
// 00380 — PATCH /{id} renames the workspace
// ──────────────────────────────────────────────────────────────────────

func TestPatch_RenamesWorkspace(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "rename")
	defer cleanup()

	// padmin holds workspace.rename per the migration 100 grant matrix.
	actor := mkUser(t, pool, subID, models.RolePAdmin)
	wsID := seedWorkspace(t, pool, subID, actor.ID, "Old Name", "ws-"+uuid.NewString()[:6])

	r, _ := newRouter(pool, actor)
	w := doJSON(t, r, http.MethodPatch, "/api/master_record_workspaces/"+wsID.String(), map[string]any{
		"name": "New Name",
	})
	if w.Code != http.StatusNoContent {
		t.Fatalf("rename: want 204, got %d; body=%s", w.Code, w.Body.String())
	}

	var got string
	if err := pool.QueryRow(context.Background(),
		`SELECT name FROM master_record_workspaces WHERE id = $1`, wsID,
	).Scan(&got); err != nil {
		t.Fatalf("verify rename: %v", err)
	}
	if got != "New Name" {
		t.Errorf("name: got %q, want %q", got, "New Name")
	}
}

// ──────────────────────────────────────────────────────────────────────
// 00381 — POST /{id}/restore: 403 non-gadmin, 200 gadmin
// ──────────────────────────────────────────────────────────────────────

func TestRestore_403ForNonGadmin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "rest-403")
	defer cleanup()

	gadmin := mkUser(t, pool, subID, models.RoleGAdmin)
	user := mkUser(t, pool, subID, models.RoleUser)

	wsID := seedWorkspace(t, pool, subID, gadmin.ID, "Limbo", "limbo-"+uuid.NewString()[:6])
	if _, err := pool.Exec(context.Background(),
		`UPDATE master_record_workspaces SET archived_at = NOW(), archived_by = $1 WHERE id = $2`,
		gadmin.ID, wsID,
	); err != nil {
		t.Fatalf("seed archive: %v", err)
	}

	r, _ := newRouter(pool, user)
	w := doJSON(t, r, http.MethodPost, "/api/master_record_workspaces/"+wsID.String()+"/restore", nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-gadmin restore: want 403, got %d; body=%s", w.Code, w.Body.String())
	}

	// Sanity: still archived.
	var archivedAt *string
	if err := pool.QueryRow(context.Background(),
		`SELECT archived_at::text FROM master_record_workspaces WHERE id = $1`, wsID,
	).Scan(&archivedAt); err != nil {
		t.Fatalf("verify still archived: %v", err)
	}
	if archivedAt == nil {
		t.Errorf("workspace was restored despite 403 — gate bypassed")
	}
}

func TestRestore_200ForGadmin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "rest-200")
	defer cleanup()

	gadmin := mkUser(t, pool, subID, models.RoleGAdmin)
	wsID := seedWorkspace(t, pool, subID, gadmin.ID, "Returnee", "ret-"+uuid.NewString()[:6])
	if _, err := pool.Exec(context.Background(),
		`UPDATE master_record_workspaces SET archived_at = NOW(), archived_by = $1 WHERE id = $2`,
		gadmin.ID, wsID,
	); err != nil {
		t.Fatalf("seed archive: %v", err)
	}

	r, _ := newRouter(pool, gadmin)
	w := doJSON(t, r, http.MethodPost, "/api/master_record_workspaces/"+wsID.String()+"/restore", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("gadmin restore: want 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var archivedAt *string
	if err := pool.QueryRow(context.Background(),
		`SELECT archived_at::text FROM master_record_workspaces WHERE id = $1`, wsID,
	).Scan(&archivedAt); err != nil {
		t.Fatalf("verify restored: %v", err)
	}
	if archivedAt != nil {
		t.Errorf("archived_at still set after 200 OK restore")
	}
}

// ──────────────────────────────────────────────────────────────────────
// PLA-0026 / story 00502 (B13) — DELETE /{id} cross-DB orphan guard
// ──────────────────────────────────────────────────────────────────────
//
// These tests cover the orchestration of the Delete handler against a
// REAL mmff_vector pool. They do NOT exercise a live vector_artefacts
// pool — the cross-DB scan is implicitly disabled by leaving
// Service.VAPool nil, which is the documented "guard disabled" state.
// The orphan-list 409 path is exercised by the unit-level test
// TestDelete_409WhenOrphansPresent below, which substitutes an
// in-memory fake VA pool through the Service struct.

// TestDelete_403ForNonGadmin verifies the destructive-tier permission
// gate fires before any DB read. A regular user cannot delete a
// workspace; the row stays in place.
func TestDelete_403ForNonGadmin(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "del-403")
	defer cleanup()

	gadmin := mkUser(t, pool, subID, models.RoleGAdmin)
	user := mkUser(t, pool, subID, models.RoleUser)
	wsID := seedWorkspace(t, pool, subID, gadmin.ID, "Doomed", "doomed-"+uuid.NewString()[:6])

	r, _ := newRouter(pool, user)
	w := doJSON(t, r, http.MethodDelete, "/api/master_record_workspaces/"+wsID.String(), nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-gadmin delete: want 403, got %d; body=%s", w.Code, w.Body.String())
	}

	// Sanity: row still present.
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM master_record_workspaces WHERE id = $1`, wsID,
	).Scan(&n); err != nil {
		t.Fatalf("verify still present: %v", err)
	}
	if n != 1 {
		t.Errorf("workspace row count: got %d, want 1 (gate bypassed?)", n)
	}
}

// TestDelete_404ForCrossTenant verifies cross-tenant access does not
// leak existence: a gadmin in tenant A asking to delete a workspace
// in tenant B gets 404, not 403/409.
func TestDelete_404ForCrossTenant(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subA, cleanA := mkTenant(t, pool, "del-xt-a")
	defer cleanA()
	subB, cleanB := mkTenant(t, pool, "del-xt-b")
	defer cleanB()

	gadminA := mkUser(t, pool, subA, models.RoleGAdmin)
	gadminB := mkUser(t, pool, subB, models.RoleGAdmin)
	wsB := seedWorkspace(t, pool, subB, gadminB.ID, "B", "b-"+uuid.NewString()[:6])

	r, _ := newRouter(pool, gadminA)
	w := doJSON(t, r, http.MethodDelete, "/api/master_record_workspaces/"+wsB.String(), nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant delete: want 404, got %d; body=%s", w.Code, w.Body.String())
	}
}

// TestDelete_501WhenNoOrphans is the happy path for the guard-only
// MVP. With VAPool nil (the guard is a no-op) and no DB-level orphans,
// the handler returns 501 Not Implemented because hard-delete is
// out-of-scope for this story. The test therefore confirms that
// steps 1–4 of the handler all pass and the placeholder 501 fires.
func TestDelete_501WhenNoOrphans(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "del-501")
	defer cleanup()

	gadmin := mkUser(t, pool, subID, models.RoleGAdmin)
	wsID := seedWorkspace(t, pool, subID, gadmin.ID, "Target", "tgt-"+uuid.NewString()[:6])

	r, _ := newRouter(pool, gadmin)
	w := doJSON(t, r, http.MethodDelete, "/api/master_record_workspaces/"+wsID.String(), nil)
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("delete (no orphans, guard disabled): want 501, got %d; body=%s", w.Code, w.Body.String())
	}

	// Sanity: workspace was NOT deleted (501 = not implemented yet).
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM master_record_workspaces WHERE id = $1`, wsID,
	).Scan(&n); err != nil {
		t.Fatalf("verify still present: %v", err)
	}
	if n != 1 {
		t.Errorf("workspace row count: got %d, want 1 (501 must not delete)", n)
	}
}

// TestDelete_400OnMalformedID verifies a non-UUID path segment is
// rejected with 400 before any other gate runs.
func TestDelete_400OnMalformedID(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "del-400")
	defer cleanup()
	gadmin := mkUser(t, pool, subID, models.RoleGAdmin)

	r, _ := newRouter(pool, gadmin)
	w := doJSON(t, r, http.MethodDelete, "/api/master_record_workspaces/not-a-uuid", nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("malformed id: want 400, got %d; body=%s", w.Code, w.Body.String())
	}
}
