package permissions

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/audit"
)

// Integration tests hit the real Postgres via the SSH tunnel on :5434.
// Per repo convention, we do not mock the DB.
//
// Each test provisions two throwaway tenants (so cross-tenant attempts have
// real foreign rows to target) and tears them down at the end.

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

type tenantFix struct {
	tenantID    uuid.UUID
	userID      uuid.UUID
	workspaceID uuid.UUID
}

// mkTenantFix provisions a tenant + user + the default workspace.
// The default-workspace seed function does the company_roadmap + workspace
// inserts; we just look up the resulting workspace id.
func mkTenantFix(t *testing.T, pool *pgxpool.Pool, label string) (tenantFix, func()) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.NewString()[:8]

	var tenantID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
		"perm-test-"+label+"-"+suffix, "perm-test-"+label+"-"+suffix,
	).Scan(&tenantID); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}

	var userID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (tenant_id, email, password_hash, role)
		VALUES ($1, $2, $3, 'gadmin') RETURNING id`,
		tenantID, "perm-test-"+label+"-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`SELECT provision_tenant_defaults($1, $2)`, tenantID, userID,
	); err != nil {
		t.Fatalf("provision defaults: %v", err)
	}

	var workspaceID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM workspace WHERE tenant_id = $1 AND key_num = 1`, tenantID,
	).Scan(&workspaceID); err != nil {
		t.Fatalf("lookup workspace: %v", err)
	}

	cleanup := func() {
		// page_entity_refs / entity_stakeholders / etc may reference
		// portfolio/product/workspace; ON DELETE RESTRICT on tenant means
		// we have to wipe every dependent row first. Easier: delete in
		// dependency order, then the tenant.
		_, _ = pool.Exec(ctx, `DELETE FROM user_workspace_permissions WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM page_entity_refs WHERE entity_id IN
			(SELECT id FROM portfolio WHERE tenant_id = $1
			 UNION SELECT id FROM product WHERE tenant_id = $1)`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM entity_stakeholders WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM portfolio_item_state WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM execution_item_state WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM item_type_transition_edges WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM item_type_states WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM portfolio_item_types WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM execution_item_types WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM product WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM portfolio WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM company_roadmap WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM tenant_sequence WHERE tenant_id = $1`, tenantID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE tenant_id = $1`, tenantID)
		if _, err := pool.Exec(ctx, `DELETE FROM tenants WHERE id = $1`, tenantID); err != nil {
			t.Logf("cleanup tenant %s: %v", label, err)
		}
	}
	return tenantFix{tenantID: tenantID, userID: userID, workspaceID: workspaceID}, cleanup
}

func newSvc(pool *pgxpool.Pool) *Service {
	return New(pool, audit.New(pool))
}

func TestGrant_HappyPath(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	a, cleanA := mkTenantFix(t, pool, "a")
	defer cleanA()

	svc := newSvc(pool)
	p, err := svc.Grant(context.Background(), GrantInput{
		UserID: a.userID, WorkspaceID: a.workspaceID, CanView: true,
	}, a.tenantID, a.userID, "")
	if err != nil {
		t.Fatalf("Grant: %v", err)
	}
	if p.UserID != a.userID || p.WorkspaceID != a.workspaceID {
		t.Fatalf("returned ids don't match input")
	}
}

func TestGrant_RejectsCrossTenantWorkspace(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	a, cleanA := mkTenantFix(t, pool, "a")
	defer cleanA()
	b, cleanB := mkTenantFix(t, pool, "b")
	defer cleanB()

	svc := newSvc(pool)
	// Actor is in tenant A; tries to grant on tenant B's workspace.
	_, err := svc.Grant(context.Background(), GrantInput{
		UserID: a.userID, WorkspaceID: b.workspaceID, CanView: true,
	}, a.tenantID, a.userID, "")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestGrant_RejectsCrossTenantUser(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	a, cleanA := mkTenantFix(t, pool, "a")
	defer cleanA()
	b, cleanB := mkTenantFix(t, pool, "b")
	defer cleanB()

	svc := newSvc(pool)
	// Actor is in tenant A; workspace is theirs but target user is in B.
	_, err := svc.Grant(context.Background(), GrantInput{
		UserID: b.userID, WorkspaceID: a.workspaceID, CanView: true,
	}, a.tenantID, a.userID, "")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestRevoke_RejectsCrossTenant(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	a, cleanA := mkTenantFix(t, pool, "a")
	defer cleanA()
	b, cleanB := mkTenantFix(t, pool, "b")
	defer cleanB()

	svc := newSvc(pool)
	ctx := context.Background()

	// Seed a permission row in tenant B.
	pB, err := svc.Grant(ctx, GrantInput{
		UserID: b.userID, WorkspaceID: b.workspaceID, CanView: true,
	}, b.tenantID, b.userID, "")
	if err != nil {
		t.Fatalf("seed grant in B: %v", err)
	}

	// Actor in A tries to revoke B's permission row.
	if err := svc.Revoke(ctx, pB.ID, a.tenantID, a.userID, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on cross-tenant revoke, got %v", err)
	}

	// Confirm the row is still there (i.e. the cross-tenant DELETE was a no-op).
	var stillThere bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM user_workspace_permissions WHERE id = $1)`, pB.ID,
	).Scan(&stillThere); err != nil {
		t.Fatalf("recheck: %v", err)
	}
	if !stillThere {
		t.Fatalf("row was deleted by cross-tenant Revoke — isolation broken")
	}

	// Sanity: actor in B can revoke their own row.
	if err := svc.Revoke(ctx, pB.ID, b.tenantID, b.userID, ""); err != nil {
		t.Fatalf("same-tenant Revoke: %v", err)
	}
}

func TestListForUser_ScopedToActorTenant(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	a, cleanA := mkTenantFix(t, pool, "a")
	defer cleanA()
	b, cleanB := mkTenantFix(t, pool, "b")
	defer cleanB()

	svc := newSvc(pool)
	ctx := context.Background()

	// Seed a permission row for B's user in B's workspace.
	if _, err := svc.Grant(ctx, GrantInput{
		UserID: b.userID, WorkspaceID: b.workspaceID, CanView: true,
	}, b.tenantID, b.userID, ""); err != nil {
		t.Fatalf("seed grant in B: %v", err)
	}

	// Actor in A asks for B's user permissions — should be empty (existence
	// hidden), not the seeded row.
	got, err := svc.ListForUser(ctx, b.userID, a.tenantID)
	if err != nil {
		t.Fatalf("ListForUser: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("cross-tenant List leaked %d rows: %+v", len(got), got)
	}

	// Sanity: actor in B sees their own user's permissions.
	got, err = svc.ListForUser(ctx, b.userID, b.tenantID)
	if err != nil {
		t.Fatalf("same-tenant ListForUser: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 row, got %d", len(got))
	}
}

func TestListForWorkspace_RejectsCrossTenant(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	a, cleanA := mkTenantFix(t, pool, "a")
	defer cleanA()
	b, cleanB := mkTenantFix(t, pool, "b")
	defer cleanB()

	svc := newSvc(pool)

	// Actor in A asks for B's workspace permissions — workspace itself is
	// the addressed resource, so this is a 404, not an empty list.
	_, err := svc.ListForWorkspace(context.Background(), b.workspaceID, a.tenantID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
