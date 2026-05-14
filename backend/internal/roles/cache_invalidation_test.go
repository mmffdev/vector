package roles

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// PLA-0007 AC #3 (cache invalidation): when a role's permission grid
// changes via Handler.AssignPermissions / Handler.RevokePermissions,
// the Resolver cache for users mapped to that role must be cleared so
// the next request sees the new grid. The handler calls
// PermResolver.InvalidateRole(roleID) after each grant/revoke commit.
//
// We exercise the full path: warm the cache by calling PermissionsFor,
// grant a permission via the HTTP handler, then call PermissionsFor
// again and assert the new code is visible. With invalidation broken
// the second read would return the stale (empty) set.
func TestPermissionGrid_invalidatesCacheOnAssign(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "cache-inv")
	defer cleanup()

	// Long TTL so we can prove invalidation actually fires (rather
	// than the entry naturally expiring).
	res := permissions.NewResolver(pool, 5*time.Minute)
	svc := New(pool, audit.New(pool))
	svc.Resolver = res
	h := NewHandler(svc, res)

	// Actor: gadmin so the route-level gate would pass; we bypass it
	// here and exercise Handler.AssignPermissions directly.
	actor := mkUser(t, pool, subID, models.RoleGAdmin)

	// Make a tenant-custom target role.
	ctx := context.Background()
	var roleID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users_roles (subscription_id, code, label, description, rank, is_system, is_external)
		VALUES ($1, $2, 'Cache target', '', 100, FALSE, FALSE) RETURNING id`,
		subID, "cache-target-"+uuid.NewString()[:8],
	).Scan(&roleID); err != nil {
		t.Fatalf("insert role: %v", err)
	}

	// Make a victim user assigned to that role (so PermissionsFor
	// returns its grid).
	suffix := uuid.NewString()[:8]
	var victimID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (subscription_id, email, password_hash, role, role_id)
		VALUES ($1, $2, $3, 'user', $4) RETURNING id`,
		subID, "victim-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
		roleID,
	).Scan(&victimID); err != nil {
		t.Fatalf("insert victim: %v", err)
	}

	// Pick a permission to grant.
	var permID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM users_permissions WHERE code = $1`, string(permissions.RolesList),
	).Scan(&permID); err != nil {
		t.Fatalf("lookup perm: %v", err)
	}

	// Warm the cache: PermissionsFor for the victim. Should be empty.
	pre, err := res.PermissionsFor(ctx, victimID)
	if err != nil {
		t.Fatalf("warm: %v", err)
	}
	if _, ok := pre[permissions.RolesList]; ok {
		t.Fatalf("victim already has users_roles.list before grant — fixture invariant broken")
	}

	// Grant via the handler so the InvalidateRole hook fires.
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
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		t.Fatalf("assign: want 2xx, got %d", resp.StatusCode)
	}

	// Re-read. With invalidation working, this hits the DB and sees
	// the new grant. With invalidation broken, the cache would still
	// say empty and the test fails.
	post, err := res.PermissionsFor(ctx, victimID)
	if err != nil {
		t.Fatalf("post-grant read: %v", err)
	}
	if _, ok := post[permissions.RolesList]; !ok {
		t.Fatalf("cache not invalidated — victim still missing users_roles.list after grant")
	}
}
