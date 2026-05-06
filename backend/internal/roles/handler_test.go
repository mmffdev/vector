package roles

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

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// Integration tests against the real Postgres via the SSH tunnel.
// We follow the testPool/skip-on-unreachable pattern from
// internal/users/service_test.go.

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

// mkTenant inserts a throwaway tenant and returns its id + cleanup.
// Mirrors users/service_test.go: clean dependencies leaves-up so the
// FK RESTRICTs on subscriptions don't bite us.
func mkTenant(t *testing.T, pool *pgxpool.Pool, label string) (uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.NewString()[:8]
	var subID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO subscriptions (name, slug) VALUES ($1, $2) RETURNING id`,
		"roles-test-"+label+"-"+suffix, "roles-test-"+label+"-"+suffix,
	).Scan(&subID); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	cleanup := func() {
		// Order matters: users.role_id RESTRICTs roles, so users must
		// go before roles. password_resets and other user-FK leaves go
		// before users.
		stmts := []string{
			`DELETE FROM role_permissions            WHERE role_id IN (SELECT id FROM roles WHERE subscription_id = $1)`,
			`DELETE FROM execution_item_types        WHERE subscription_id = $1`,
			`DELETE FROM entity_stakeholders         WHERE subscription_id = $1`,
			`DELETE FROM product                     WHERE subscription_id = $1`,
			`DELETE FROM portfolio                   WHERE subscription_id = $1`,
			`DELETE FROM workspace                   WHERE subscription_id = $1`,
			`DELETE FROM company_roadmap             WHERE subscription_id = $1`,
			`DELETE FROM subscription_sequence       WHERE subscription_id = $1`,
			`DELETE FROM password_resets             WHERE user_id IN (SELECT id FROM users WHERE subscription_id = $1)`,
			`DELETE FROM users                       WHERE subscription_id = $1`,
			`DELETE FROM roles                       WHERE subscription_id = $1`,
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

func mkUser(t *testing.T, pool *pgxpool.Pool, subID uuid.UUID, role models.Role) *models.User {
	t.Helper()
	suffix := uuid.NewString()[:8]
	// Map legacy enum to the system role UUID. role_id is NOT NULL after
	// migration 088, so we have to seed both columns until the enum is
	// retired in PLA-0007 G4.
	var roleID uuid.UUID
	switch role {
	case models.RoleGAdmin:
		roleID = SystemRoleGadmin
	case models.RolePAdmin:
		roleID = SystemRolePadmin
	case models.RoleUser:
		roleID = SystemRoleUser
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

// withUser injects a fake user into the request context, mirroring
// what auth.RequireAuth does at runtime.
func withUser(u *models.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := auth.WithUserForTest(r.Context(), u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func newRouter(h *Handler, u *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(withUser(u))
	r.Get("/api/roles", h.List)
	r.Get("/api/roles/creatable", h.Creatable)
	r.Get("/api/roles/{id}", h.Get)
	r.Post("/api/roles", h.Create)
	r.Patch("/api/roles/{id}", h.Update)
	r.Delete("/api/roles/{id}", h.Archive)
	r.Get("/api/roles/{id}/permissions", h.ListPermissions)
	r.Post("/api/roles/{id}/permissions", h.AssignPermissions)
	r.Delete("/api/roles/{id}/permissions", h.RevokePermissions)
	return r
}

func newHandler(pool *pgxpool.Pool) *Handler {
	svc := New(pool, audit.New(pool))
	res := permissions.NewResolver(pool, 0) // ttl<=0 -> always hit DB
	return NewHandler(svc, res, pool)
}

// ----------------------------------------------------------------
// 1) List returns system rows + own-tenant rows; never another tenant's.
// ----------------------------------------------------------------

func TestList_returnsRolesScopedToTenant(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subA, cleanA := mkTenant(t, pool, "list-a")
	defer cleanA()
	subB, cleanB := mkTenant(t, pool, "list-b")
	defer cleanB()

	actor := mkUser(t, pool, subA, models.RoleGAdmin)

	// Insert a tenant-custom role into subA and another into subB.
	ctx := context.Background()
	var aRoleID, bRoleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO roles (subscription_id, code, label, description, rank, is_system, is_external)
		VALUES ($1, $2, 'A Custom', '', 100, FALSE, FALSE) RETURNING id`,
		subA, "tenant-a-"+uuid.NewString()[:8],
	).Scan(&aRoleID); err != nil {
		t.Fatalf("insert role A: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO roles (subscription_id, code, label, description, rank, is_system, is_external)
		VALUES ($1, $2, 'B Custom', '', 100, FALSE, FALSE) RETURNING id`,
		subB, "tenant-b-"+uuid.NewString()[:8],
	).Scan(&bRoleID); err != nil {
		t.Fatalf("insert role B: %v", err)
	}

	h := newHandler(pool)
	srv := httptest.NewServer(newRouter(h, actor))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/roles")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var rows []models.RoleRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		t.Fatalf("decode: %v", err)
	}

	var sawA, sawB, sawSystem bool
	for _, r := range rows {
		if r.ID == aRoleID {
			sawA = true
		}
		if r.ID == bRoleID {
			sawB = true
		}
		if r.IsSystem {
			sawSystem = true
		}
	}
	if !sawA {
		t.Errorf("did not see own-tenant role A in list")
	}
	if sawB {
		t.Errorf("saw foreign tenant role B — tenant isolation broken")
	}
	if !sawSystem {
		t.Errorf("system roles missing from list")
	}
}

// ----------------------------------------------------------------
// 2) Create returns 409 with code_taken on duplicate code.
// ----------------------------------------------------------------

func TestCreate_409onDuplicateCode(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "create-dup")
	defer cleanup()
	actor := mkUser(t, pool, subID, models.RoleGAdmin)

	h := newHandler(pool)
	srv := httptest.NewServer(newRouter(h, actor))
	defer srv.Close()

	code := "dup-" + uuid.NewString()[:8]
	body := func() *bytes.Buffer {
		b, _ := json.Marshal(createReq{
			Code: code, Label: "First", Rank: 100,
		})
		return bytes.NewBuffer(b)
	}

	// First create: 201.
	resp1, err := http.Post(srv.URL+"/api/roles", "application/json", body())
	if err != nil {
		t.Fatalf("POST 1: %v", err)
	}
	resp1.Body.Close()
	if resp1.StatusCode != http.StatusCreated {
		t.Fatalf("first create: want 201, got %d", resp1.StatusCode)
	}

	// Second create with same code under same tenant: 409.
	resp2, err := http.Post(srv.URL+"/api/roles", "application/json", body())
	if err != nil {
		t.Fatalf("POST 2: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusConflict {
		t.Fatalf("dup create: want 409, got %d", resp2.StatusCode)
	}
	var errBody map[string]string
	if err := json.NewDecoder(resp2.Body).Decode(&errBody); err != nil {
		t.Fatalf("decode err: %v", err)
	}
	if errBody["error"] != "code_taken" {
		t.Errorf("error body: want code_taken, got %q", errBody["error"])
	}
}

// ----------------------------------------------------------------
// 3) AssignPermissions returns 403 self_elevation_blocked when the
//    actor does not hold the permission they're trying to grant.
// ----------------------------------------------------------------

func TestAssignPermissions_403onSelfElevation(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "self-elev")
	defer cleanup()

	// Actor with no role grid (role_id NULL) → empty permission set.
	actor := mkUser(t, pool, subID, models.RoleGAdmin)

	// Make a tenant-custom target role to grant against.
	ctx := context.Background()
	var roleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO roles (subscription_id, code, label, description, rank, is_system, is_external)
		VALUES ($1, $2, 'Target', '', 100, FALSE, FALSE) RETURNING id`,
		subID, "target-"+uuid.NewString()[:8],
	).Scan(&roleID); err != nil {
		t.Fatalf("insert target role: %v", err)
	}

	// Pick any seeded permission id to attempt to grant.
	var permID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM permissions WHERE code = $1`, string(permissions.RolesList),
	).Scan(&permID); err != nil {
		t.Fatalf("lookup permission id: %v", err)
	}

	// Repoint the actor at a tenant-custom role with no grants so
	// PermissionsFor returns an empty set. role_id is NOT NULL, so we
	// can't blank it; we have to swap it for an empty-grid role.
	var emptyRoleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO roles (subscription_id, code, label, description, rank, is_system, is_external)
		VALUES ($1, $2, 'Empty', '', 99, FALSE, FALSE) RETURNING id`,
		subID, "empty-"+uuid.NewString()[:8],
	).Scan(&emptyRoleID); err != nil {
		t.Fatalf("insert empty role: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET role_id = $1 WHERE id = $2`, emptyRoleID, actor.ID); err != nil {
		t.Fatalf("repoint actor role: %v", err)
	}

	h := newHandler(pool)
	srv := httptest.NewServer(newRouter(h, actor))
	defer srv.Close()

	body, _ := json.Marshal(permIDsReq{PermissionIDs: []uuid.UUID{permID}})
	resp, err := http.Post(
		srv.URL+"/api/roles/"+roleID.String()+"/permissions",
		"application/json", bytes.NewBuffer(body),
	)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("want 403, got %d", resp.StatusCode)
	}
	var errBody map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&errBody); err != nil {
		t.Fatalf("decode err: %v", err)
	}
	if errBody["error"] != "self_elevation_blocked" {
		t.Errorf("error body: want self_elevation_blocked, got %q", errBody["error"])
	}
}

// ----------------------------------------------------------------
// 4) Archive returns 403 system_role_immutable on a system row.
// ----------------------------------------------------------------

func TestArchive_403onSystemRole(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "arch-sys")
	defer cleanup()
	actor := mkUser(t, pool, subID, models.RoleGAdmin)

	h := newHandler(pool)
	srv := httptest.NewServer(newRouter(h, actor))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete,
		srv.URL+"/api/roles/"+SystemRoleGadmin.String(), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("want 403, got %d", resp.StatusCode)
	}
	var errBody map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&errBody); err != nil {
		t.Fatalf("decode err: %v", err)
	}
	if errBody["error"] != "system_role_immutable" {
		t.Errorf("error body: want system_role_immutable, got %q", errBody["error"])
	}
}
