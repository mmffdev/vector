package fields

// Handler tests for GET /api/workspace/{id}/fields (PLA-0026 / Story 00500, B11).
//
// Two layers of coverage:
//
//  1. Pure-unit tests that exercise auth gating with a nil artefacts pool.
//     These run without the SSH tunnel — they only need mmff_vector for
//     the workspace existence + membership lookups, and they short-circuit
//     to an empty fields slice when the artefacts pool is nil.
//
//  2. Integration test that seeds three artefact_field_library rows
//     (one per scope) plus one whitelist row, hits the live handler,
//     and asserts the admit/deny matrix from R047 §5 maps end-to-end
//     to the JSON response. Skips on tunnel-down.
//
// Both layers go through the real chi router so the route shape
// (/api/workspace/{id}/fields) is exercised, not the bare handler func.

import (
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
)

// withUser injects a fake user into the request context — same pattern
// as libraryreleases/handler_test.go.
func withUser(u *models.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if u == nil {
				next.ServeHTTP(w, r)
				return
			}
			ctx := auth.WithUserForTest(r.Context(), u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func newRouter(h *Handler, u *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(withUser(u))
	r.Get("/api/workspace/{id}/fields", h.List)
	return r
}

// ─── env loading ───────────────────────────────────────────────────────

func loadEnv() {
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// vectorPoolForTest opens an mmff_vector pool. Skips when the tunnel
// is down — callers MUST be skip-on-unreachable per the story spec.
func vectorPoolForTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	loadEnv()
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=fields_handler_test",
		envOr("DB_HOST", "localhost"),
		envOr("DB_PORT", "5434"),
		envOr("DB_USER", "mmff_dev"),
		os.Getenv("DB_PASSWORD"),
		envOr("DB_NAME", "mmff_vector"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open mmff_vector pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_vector (tunnel down?): %v", err)
	}
	return pool
}

// pickWorkspaceUser pulls one (workspace, user) pair from the live DB
// where the user has an active roles_workspaces grant on the workspace.
// The user is NOT a tenant admin (so the membership branch — not the
// role-bypass branch — is exercised). Skips when no such pair exists.
func pickWorkspaceUser(t *testing.T, pool *pgxpool.Pool) (workspaceID uuid.UUID, u *models.User) {
	t.Helper()
	u = &models.User{}
	err := pool.QueryRow(context.Background(), `
		SELECT u.id, u.subscription_id, u.email, u.role, u.is_active, rw.workspace_id
		  FROM roles_workspaces rw
		  JOIN users u ON u.id = rw.user_id
		  JOIN master_record_workspaces w ON w.id = rw.workspace_id
		 WHERE rw.revoked_at IS NULL
		   AND u.is_active = TRUE
		   AND u.role = 'user'
		   AND w.archived_at IS NULL
		   AND w.subscription_id = u.subscription_id
		 LIMIT 1`,
	).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive, &workspaceID)
	if err != nil {
		t.Skipf("no workspace-member fixture available: %v", err)
	}
	return workspaceID, u
}

// pickGadmin returns one gadmin user.
func pickGadmin(t *testing.T, pool *pgxpool.Pool) *models.User {
	t.Helper()
	u := &models.User{}
	err := pool.QueryRow(context.Background(), `
		SELECT id, subscription_id, email, role, is_active
		  FROM users
		 WHERE role = 'gadmin' AND is_active = TRUE
		 ORDER BY created_at
		 LIMIT 1`,
	).Scan(&u.ID, &u.SubscriptionID, &u.Email, &u.Role, &u.IsActive)
	if err != nil {
		t.Skipf("no gadmin user available: %v", err)
	}
	return u
}

// pickWorkspaceInTenant returns any non-archived workspace in the given
// tenant (used by gadmin-bypass tests where membership doesn't apply).
func pickWorkspaceInTenant(t *testing.T, pool *pgxpool.Pool, tenant uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		SELECT id FROM master_record_workspaces
		 WHERE subscription_id = $1 AND archived_at IS NULL
		 ORDER BY created_at LIMIT 1`, tenant,
	).Scan(&id)
	if err != nil {
		t.Skipf("no live workspace in tenant: %v", err)
	}
	return id
}

// ─── unit tests (no artefacts pool) ────────────────────────────────────

func TestList_Unauthenticated_Returns401(t *testing.T) {
	// Nil user → middleware does not stash a User in ctx → handler 401.
	h := NewHandler(nil, nil)
	r := chi.NewRouter()
	r.Get("/api/workspace/{id}/fields", h.List)

	req := httptest.NewRequest(http.MethodGet,
		"/api/workspace/"+uuid.New().String()+"/fields", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: want 401, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestList_BadUUID_Returns400(t *testing.T) {
	pool := vectorPoolForTest(t)
	defer pool.Close()
	u := pickGadmin(t, pool)

	h := NewHandler(pool, nil)
	srv := httptest.NewServer(newRouter(h, u))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/not-a-uuid/fields")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", resp.StatusCode)
	}
}

func TestList_NonexistentWorkspace_Returns404(t *testing.T) {
	pool := vectorPoolForTest(t)
	defer pool.Close()
	u := pickGadmin(t, pool)

	h := NewHandler(pool, nil)
	srv := httptest.NewServer(newRouter(h, u))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/" + uuid.New().String() + "/fields")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", resp.StatusCode)
	}
}

func TestList_CrossTenantWorkspace_Returns404(t *testing.T) {
	// Caller is gadmin of tenant A; workspace belongs to tenant B.
	// We force this by overriding the user's SubscriptionID to a fresh
	// UUID that doesn't match any workspace's subscription_id, then
	// asking for any live workspace. The tenancy guard returns 404
	// (not 403) — same shape as "doesn't exist" so existence isn't leaked.
	pool := vectorPoolForTest(t)
	defer pool.Close()
	g := pickGadmin(t, pool)
	wsID := pickWorkspaceInTenant(t, pool, g.SubscriptionID)

	intruder := *g
	intruder.SubscriptionID = uuid.New() // different tenant

	h := NewHandler(pool, nil)
	srv := httptest.NewServer(newRouter(h, &intruder))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID.String() + "/fields")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", resp.StatusCode)
	}
}

func TestList_WorkspaceMember_NoArtefactsPool_Returns200Empty(t *testing.T) {
	pool := vectorPoolForTest(t)
	defer pool.Close()
	wsID, u := pickWorkspaceUser(t, pool)

	h := NewHandler(pool, nil) // null artefacts pool
	srv := httptest.NewServer(newRouter(h, u))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID.String() + "/fields")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var body listResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.WorkspaceID != wsID {
		t.Errorf("workspace_id: want %s, got %s", wsID, body.WorkspaceID)
	}
	if len(body.Fields) != 0 {
		t.Errorf("fields: want empty, got %d entries", len(body.Fields))
	}
}

func TestList_NonMember_Returns403(t *testing.T) {
	// Build a user in the tenant who is *not* a workspace member.
	// We take the gadmin's tenant + a live workspace, then synthesise
	// a fresh non-admin user id. Membership check in handler uses
	// (user_id, workspace_id) — a never-granted user fails closed.
	pool := vectorPoolForTest(t)
	defer pool.Close()
	g := pickGadmin(t, pool)
	wsID := pickWorkspaceInTenant(t, pool, g.SubscriptionID)

	stranger := models.User{
		ID:             uuid.New(), // never granted on this workspace
		SubscriptionID: g.SubscriptionID,
		Email:          "stranger@test",
		Role:           models.RoleUser,
		IsActive:       true,
	}

	h := NewHandler(pool, nil)
	srv := httptest.NewServer(newRouter(h, &stranger))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID.String() + "/fields")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d", resp.StatusCode)
	}
}

// ─── integration: artefacts pool wired ─────────────────────────────────

// artefactsPoolForTest opens the vector_artefacts pool the same way
// resolver_test.go does. Reuses VA_* env vars.
func artefactsPoolForTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	loadEnv()
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=fields_handler_test",
		envOr("VA_DB_HOST", "localhost"),
		envOr("VA_DB_PORT", "5435"),
		envOr("VA_DB_USER", "mmff_dev"),
		os.Getenv("VA_DB_PASSWORD"),
		envOr("VA_DB_NAME", "vector_artefacts"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector_artefacts pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts (tunnel down?): %v", err)
	}
	return pool
}

// TestList_AdmittedSet_MatchesResolverRules seeds three field_library
// rows (one per scope) and one whitelist row admitting the workspace
// field into the caller's workspace. The response MUST contain the
// global, the matching-tenant, and the whitelisted-workspace rows.
// The matching-tenant test ensures resolver Cell 2 maps to inclusion;
// absence of an unwhitelisted workspace row would prove Cell 5 maps to
// exclusion (we'd need a second tenant to fully prove Cell 3, which
// the resolver_test.go matrix already covers — handler test focuses
// on the wire shape).
func TestList_AdmittedSet_MatchesResolverRules(t *testing.T) {
	vecPool := vectorPoolForTest(t)
	defer vecPool.Close()
	artPool := artefactsPoolForTest(t)
	defer artPool.Close()

	wsID, u := pickWorkspaceUser(t, vecPool)
	ctx := context.Background()
	suffix := uuid.NewString()[:8]

	// Seed: global row (subscription_id NULL).
	var globalID, tenantID, workspaceID, otherTenantID uuid.UUID
	err := artPool.QueryRow(ctx, `
		INSERT INTO artefact_field_library
			(subscription_id, field_name, label, field_type, scope)
		VALUES (NULL, $1, 'H Global', 'textbox', 'global')
		RETURNING id`,
		"h_global_"+suffix,
	).Scan(&globalID)
	if err != nil {
		t.Fatalf("seed global: %v", err)
	}
	// Tenant row matching caller's tenant.
	err = artPool.QueryRow(ctx, `
		INSERT INTO artefact_field_library
			(subscription_id, field_name, label, field_type, scope)
		VALUES ($1, $2, 'H Tenant', 'textbox', 'tenant')
		RETURNING id`,
		u.SubscriptionID, "h_tenant_"+suffix,
	).Scan(&tenantID)
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	// Tenant row in some OTHER tenant — must NOT appear.
	err = artPool.QueryRow(ctx, `
		INSERT INTO artefact_field_library
			(subscription_id, field_name, label, field_type, scope)
		VALUES ($1, $2, 'H Other Tenant', 'textbox', 'tenant')
		RETURNING id`,
		uuid.New(), "h_other_tenant_"+suffix,
	).Scan(&otherTenantID)
	if err != nil {
		t.Fatalf("seed other-tenant: %v", err)
	}
	// Workspace row in caller's tenant + whitelist row admitting it
	// into the caller's workspace.
	err = artPool.QueryRow(ctx, `
		INSERT INTO artefact_field_library
			(subscription_id, field_name, label, field_type, scope)
		VALUES ($1, $2, 'H Workspace', 'textbox', 'workspace')
		RETURNING id`,
		u.SubscriptionID, "h_workspace_"+suffix,
	).Scan(&workspaceID)
	if err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if _, err := artPool.Exec(ctx,
		`INSERT INTO artefact_workspace_fields (workspace_id, field_library_id) VALUES ($1, $2)`,
		wsID, workspaceID,
	); err != nil {
		t.Fatalf("seed whitelist: %v", err)
	}
	t.Cleanup(func() {
		_, _ = artPool.Exec(ctx,
			`DELETE FROM artefact_field_library WHERE id = ANY($1)`,
			[]uuid.UUID{globalID, tenantID, workspaceID, otherTenantID},
		)
	})

	// Hit the handler.
	h := NewHandler(vecPool, artPool)
	srv := httptest.NewServer(newRouter(h, u))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID.String() + "/fields")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}

	var body listResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	got := map[uuid.UUID]bool{}
	for _, f := range body.Fields {
		got[f.ID] = true
	}
	if !got[globalID] {
		t.Errorf("global field not admitted")
	}
	if !got[tenantID] {
		t.Errorf("tenant field (matching tenant) not admitted")
	}
	if !got[workspaceID] {
		t.Errorf("workspace field (whitelisted) not admitted")
	}
	if got[otherTenantID] {
		t.Errorf("other-tenant field leaked into response")
	}
}
