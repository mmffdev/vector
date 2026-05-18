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
	"github.com/mmffdev/vector-backend/internal/roletypes"
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
		"users_roles-test-"+label+"-"+suffix, "users_roles-test-"+label+"-"+suffix,
	).Scan(&subID); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	cleanup := func() {
		// Order matters: users.role_id RESTRICTs users_roles, so users must
		// go before users_roles. users_password_resets and other user-FK leaves go
		// before users.
		stmts := []string{
			`DELETE FROM users_roles_permissions            WHERE users_roles_permissions_id_role IN (SELECT users_roles_id FROM users_roles WHERE users_roles_id_subscription = $1)`,
			`DELETE FROM execution_item_types        WHERE subscription_id = $1`,
			`DELETE FROM subscriptions_stakeholders  WHERE subscriptions_stakeholders_id_subscription = $1`,
			`DELETE FROM product                     WHERE subscription_id = $1`,
			`DELETE FROM portfolio                   WHERE subscription_id = $1`,
			`DELETE FROM workspace                   WHERE subscription_id = $1`,
			`DELETE FROM company_roadmap             WHERE subscription_id = $1`,
			`DELETE FROM subscriptions_sequence      WHERE subscriptions_sequence_id_subscription = $1`,
			`DELETE FROM users_password_resets             WHERE users_password_resets_id_user IN (SELECT id FROM users WHERE subscription_id = $1)`,
			`DELETE FROM users                       WHERE subscription_id = $1`,
			`DELETE FROM users_roles                       WHERE users_roles_id_subscription = $1`,
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

// resolveGrpRoleID looks up the grp_* role UUID for a legacy enum role
// directly from users_roles. Replaces the retired SystemRoleGadmin /
// SystemRolePadmin / SystemRoleUser package constants that were removed
// in PLA-0049 Phase 0 (TD-TEST-002, refreshed 2026-05-16).
//
// Mapping mirrors mig 196's coarse-fallback contract:
//   gadmin → grp_global, padmin → grp_portfolio, user → grp_team_member.
func resolveGrpRoleID(t *testing.T, pool *pgxpool.Pool, role roletypes.Role) uuid.UUID {
	t.Helper()
	var code string
	switch role {
	case roletypes.RoleGAdmin:
		code = "grp_global"
	case roletypes.RolePAdmin:
		code = "grp_portfolio"
	case roletypes.RoleUser:
		code = "grp_team_member"
	default:
		t.Fatalf("resolveGrpRoleID: unknown role %q", role)
	}
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`SELECT users_roles_id FROM users_roles WHERE users_roles_code = $1 AND users_roles_id_subscription IS NULL`,
		code,
	).Scan(&id)
	if err != nil {
		t.Fatalf("resolveGrpRoleID(%s → %s): %v", role, code, err)
	}
	return id
}

func mkUser(t *testing.T, pool *pgxpool.Pool, subID uuid.UUID, role roletypes.Role) *roletypes.User {
	t.Helper()
	suffix := uuid.NewString()[:8]
	// role_id is NOT NULL after migration 088 + PLA-0049 Phase 0 rename;
	// resolve the grp_* UUID by code at fixture time (TD-TEST-002).
	roleID := resolveGrpRoleID(t, pool, role)
	u := &roletypes.User{}
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
func withUser(u *roletypes.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := auth.WithUserForTest(r.Context(), u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func newRouter(h *Handler, u *roletypes.User) http.Handler {
	r := chi.NewRouter()
	r.Use(withUser(u))
	r.Get("/api/users_roles", h.List)
	r.Get("/api/users_roles/creatable", h.Creatable)
	r.Get("/api/users_roles/{id}", h.Get)
	r.Post("/api/users_roles", h.Create)
	r.Patch("/api/users_roles/{id}", h.Update)
	r.Delete("/api/users_roles/{id}", h.Archive)
	r.Get("/api/users_roles/{id}/users_permissions", h.ListPermissions)
	r.Post("/api/users_roles/{id}/users_permissions", h.AssignPermissions)
	r.Delete("/api/users_roles/{id}/users_permissions", h.RevokePermissions)
	return r
}

func newHandler(pool *pgxpool.Pool) *Handler {
	svc := New(pool, audit.New(pool))
	res := permissions.NewResolver(pool, 0) // ttl<=0 -> always hit DB
	svc.Resolver = res
	return NewHandler(svc, res)
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

	actor := mkUser(t, pool, subA, roletypes.RoleGAdmin)

	// Insert a tenant-custom role into subA and another into subB.
	ctx := context.Background()
	var aRoleID, bRoleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, $2, 'A Custom', '', 100, FALSE, FALSE) RETURNING users_roles_id`,
		subA, "tenant-a-"+uuid.NewString()[:8],
	).Scan(&aRoleID); err != nil {
		t.Fatalf("insert role A: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, $2, 'B Custom', '', 100, FALSE, FALSE) RETURNING users_roles_id`,
		subB, "tenant-b-"+uuid.NewString()[:8],
	).Scan(&bRoleID); err != nil {
		t.Fatalf("insert role B: %v", err)
	}

	h := newHandler(pool)
	srv := httptest.NewServer(newRouter(h, actor))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/users_roles")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var rows []roletypes.RoleRow
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
		t.Errorf("system users_roles missing from list")
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
	actor := mkUser(t, pool, subID, roletypes.RoleGAdmin)

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
	resp1, err := http.Post(srv.URL+"/api/users_roles", "application/json", body())
	if err != nil {
		t.Fatalf("POST 1: %v", err)
	}
	resp1.Body.Close()
	if resp1.StatusCode != http.StatusCreated {
		t.Fatalf("first create: want 201, got %d", resp1.StatusCode)
	}

	// Second create with same code under same tenant: 409.
	resp2, err := http.Post(srv.URL+"/api/users_roles", "application/json", body())
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
	actor := mkUser(t, pool, subID, roletypes.RoleGAdmin)

	// Make a tenant-custom target role to grant against.
	ctx := context.Background()
	var roleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, $2, 'Target', '', 100, FALSE, FALSE) RETURNING users_roles_id`,
		subID, "target-"+uuid.NewString()[:8],
	).Scan(&roleID); err != nil {
		t.Fatalf("insert target role: %v", err)
	}

	// Pick any seeded permission id to attempt to grant.
	var permID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT users_permissions_id FROM users_permissions WHERE users_permissions_code = $1`, string(permissions.RolesList),
	).Scan(&permID); err != nil {
		t.Fatalf("lookup permission id: %v", err)
	}

	// Repoint the actor at a tenant-custom role with no grants so
	// PermissionsFor returns an empty set. role_id is NOT NULL, so we
	// can't blank it; we have to swap it for an empty-grid role.
	var emptyRoleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external)
		VALUES ($1, $2, 'Empty', '', 99, FALSE, FALSE) RETURNING users_roles_id`,
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
		srv.URL+"/api/users_roles/"+roleID.String()+"/users_permissions",
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
	actor := mkUser(t, pool, subID, roletypes.RoleGAdmin)

	h := newHandler(pool)
	srv := httptest.NewServer(newRouter(h, actor))
	defer srv.Close()

	grpGlobalID := resolveGrpRoleID(t, pool, roletypes.RoleGAdmin)
	req, _ := http.NewRequest(http.MethodDelete,
		srv.URL+"/api/users_roles/"+grpGlobalID.String(), nil)
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
