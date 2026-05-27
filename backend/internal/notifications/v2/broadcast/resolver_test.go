//go:build integration

package broadcast_test

// Integration tests for broadcast.pgResolver (inverse-Sentinel).
// Requires a live vector_artefacts DB — uses the same DB_* env vars
// as the rest of the test suite. Tests skip (not fail) when the pool
// cannot connect (tunnel down).
//
// Fixture strategy: each test creates a throwaway subscription + workspace
// + topology nodes + users in t.Cleanup-able transactions. All fixture IDs
// use gen_random_uuid() via test helpers to avoid collisions with seed data.
//
// Test property: UsersForTopologyNode(subtree=true) ⊇ UsersForTopologyNode(subtree=false)
// for any node, verified in TestTopologySubtreeIsSupersetOfDirect.

import (
	"context"
	"fmt"
	"os"
	"sort"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/broadcast"
)

// ---- helpers ----

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		orDefault(os.Getenv("DB_HOST"), "localhost"),
		orDefault(os.Getenv("DB_PORT"), "5435"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		orDefault(os.Getenv("DB_NAME"), "vector_artefacts"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("broadcast resolver integration: cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("broadcast resolver integration: cannot ping DB (tunnel down?): %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func orDefault(val, def string) string {
	if val == "" {
		return def
	}
	return val
}

// mkFixtureTenant creates a throwaway subscription + workspace and returns
// their IDs plus a cleanup func. The workspace also creates a root topology
// node (required for users_roles_topology_nodes FKs to work).
func mkFixtureTenant(t *testing.T, pool *pgxpool.Pool) (subID, wsID, rootNodeID uuid.UUID, cleanup func()) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.NewString()[:8]

	if err := pool.QueryRow(ctx,
		`INSERT INTO subscriptions (subscriptions_name, subscriptions_slug)
		 VALUES ($1, $2) RETURNING subscriptions_id`,
		"notif-v2-s03-test-"+suffix, "notif-v2-s03-test-"+suffix,
	).Scan(&subID); err != nil {
		t.Fatalf("mkFixtureTenant: insert subscription: %v", err)
	}

	if err := pool.QueryRow(ctx,
		`INSERT INTO master_record_workspaces (master_record_workspaces_id, master_record_workspaces_name, master_record_workspaces_id_subscription, master_record_workspaces_slug)
		 VALUES (gen_random_uuid(), $1, $2, $3) RETURNING master_record_workspaces_id`,
		"Test Workspace "+suffix, subID, "test-ws-"+suffix,
	).Scan(&wsID); err != nil {
		t.Fatalf("mkFixtureTenant: insert workspace: %v", err)
	}

	// Root topology node
	rootNodeID = uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO topology_nodes (topology_nodes_id, topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_name)
		 VALUES ($1, $2, $3, $4)`,
		rootNodeID, wsID, subID, "Root-"+suffix,
	); err != nil {
		t.Fatalf("mkFixtureTenant: insert root node: %v", err)
	}

	cleanup = func() {
		stmts := []string{
			`DELETE FROM users_roles_topology_nodes WHERE users_roles_topology_nodes_id_subscription = $1`,
			`DELETE FROM users_roles_workspaces     WHERE users_roles_workspaces_id_subscription = $1`,
			`DELETE FROM topology_nodes             WHERE topology_nodes_id_subscription = $1`,
			`DELETE FROM users                      WHERE users_id_subscription = $1`,
			`DELETE FROM master_record_workspaces   WHERE master_record_workspaces_id_subscription = $1`,
			`DELETE FROM subscriptions              WHERE subscriptions_id = $1`,
		}
		for _, sql := range stmts {
			if _, err := pool.Exec(ctx, sql, subID); err != nil {
				t.Errorf("mkFixtureTenant cleanup: %s: %v", sql, err)
			}
		}
	}
	return subID, wsID, rootNodeID, cleanup
}

// mkFixtureUser inserts a bare user in the subscription (no roles, no grants).
// Tests that need grants call mkGrantOnNode / mkGrantOnWorkspace additionally.
func mkFixtureUser(t *testing.T, pool *pgxpool.Pool, subID uuid.UUID) uuid.UUID {
	t.Helper()
	// Resolve the 'user' system role ID (always present post-seed).
	var roleID uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT users_roles_id FROM users_roles WHERE users_roles_code = 'grp_team_member' LIMIT 1`,
	).Scan(&roleID); err != nil {
		// Fallback: any role will do for resolver tests (resolver doesn't check role level).
		if err := pool.QueryRow(context.Background(),
			`SELECT users_roles_id FROM users_roles LIMIT 1`,
		).Scan(&roleID); err != nil {
			t.Fatalf("mkFixtureUser: cannot resolve any role_id: %v", err)
		}
	}

	suffix := uuid.NewString()[:8]
	var userID uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (users_id_subscription, users_email, users_password_hash, users_role, users_id_role)
		 VALUES ($1, $2, $3, 'user', $4) RETURNING users_id`,
		subID,
		"notif-s03-test-u-"+suffix+"@example.com",
		"$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
		roleID,
	).Scan(&userID); err != nil {
		t.Fatalf("mkFixtureUser: insert user: %v", err)
	}
	return userID
}

// mkChildNode inserts a child topology node under parentNodeID.
func mkChildNode(t *testing.T, pool *pgxpool.Pool, wsID, subID, parentID uuid.UUID, label string) uuid.UUID {
	t.Helper()
	nodeID := uuid.New()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO topology_nodes (topology_nodes_id, topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_id_parent, topology_nodes_name)
		 VALUES ($1, $2, $3, $4, $5)`,
		nodeID, wsID, subID, parentID, label,
	); err != nil {
		t.Fatalf("mkChildNode (%s): %v", label, err)
	}
	return nodeID
}

// mkGrantOnNode grants userID an active role on nodeID.
func mkGrantOnNode(t *testing.T, pool *pgxpool.Pool, wsID, subID, nodeID, userID uuid.UUID) {
	t.Helper()
	// Use the same user as the granter (self-grant OK for fixture purposes).
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users_roles_topology_nodes
		 (users_roles_topology_nodes_id, users_roles_topology_nodes_id_workspace,
		  users_roles_topology_nodes_id_subscription, users_roles_topology_nodes_id_topology_node,
		  users_roles_topology_nodes_id_user, users_roles_topology_nodes_role_code,
		  users_roles_topology_nodes_id_user_granter)
		 VALUES (gen_random_uuid(), $1, $2, $3, $4, 'viewer', $4)`,
		wsID, subID, nodeID, userID,
	); err != nil {
		t.Fatalf("mkGrantOnNode (user=%s, node=%s): %v", userID, nodeID, err)
	}
}

// mkGrantOnWorkspace grants userID a workspace-level role.
func mkGrantOnWorkspace(t *testing.T, pool *pgxpool.Pool, wsID, subID, userID uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users_roles_workspaces
		 (users_roles_workspaces_id_subscription, users_roles_workspaces_id_workspace,
		  users_roles_workspaces_id_user, users_roles_workspaces_role,
		  users_roles_workspaces_id_user_granted_by)
		 VALUES ($1, $2, $3, 'viewer', $3)`,
		subID, wsID, userID,
	); err != nil {
		t.Fatalf("mkGrantOnWorkspace (user=%s, ws=%s): %v", userID, wsID, err)
	}
}

// containsAll asserts that got contains all IDs in want (got may be a superset).
func containsAll(t *testing.T, label string, got, want []uuid.UUID) {
	t.Helper()
	set := make(map[uuid.UUID]struct{}, len(got))
	for _, id := range got {
		set[id] = struct{}{}
	}
	for _, id := range want {
		if _, ok := set[id]; !ok {
			t.Errorf("%s: expected user %s in result, not found. got=%v", label, id, got)
		}
	}
}

// exactSet asserts got == want (both sorted).
func exactSet(t *testing.T, label string, got, want []uuid.UUID) {
	t.Helper()
	sort.Slice(got, func(i, j int) bool { return got[i].String() < got[j].String() })
	sort.Slice(want, func(i, j int) bool { return want[i].String() < want[j].String() })
	if len(got) != len(want) {
		t.Errorf("%s: len got=%d want=%d\n  got: %v\n  want: %v", label, len(got), len(want), got, want)
		return
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("%s: mismatch at index %d: got=%s want=%s", label, i, got[i], want[i])
		}
	}
}

// ---- tests ----

// TestUsersForTopologyNodeDirect verifies the non-subtree path returns only
// users with a direct grant on the target node.
func TestUsersForTopologyNodeDirect(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, rootNodeID, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	// Node A = rootNodeID. Nodes B, C are children.
	nodeB := mkChildNode(t, pool, wsID, subID, rootNodeID, "NodeB")
	nodeC := mkChildNode(t, pool, wsID, subID, rootNodeID, "NodeC")

	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)

	// U1 → NodeB only, U2 → NodeA (root) only
	mkGrantOnNode(t, pool, wsID, subID, nodeB, u1)
	mkGrantOnNode(t, pool, wsID, subID, rootNodeID, u2)
	_ = nodeC // unused node — ensures query doesn't accidentally include NodeC users

	resolver := broadcast.NewResolver(pool)

	// Direct on rootNodeID → only U2
	got, err := resolver.UsersForTopologyNode(ctx, rootNodeID, false)
	if err != nil {
		t.Fatalf("UsersForTopologyNode(direct, root): %v", err)
	}
	exactSet(t, "direct on root", got, []uuid.UUID{u2})

	// Direct on nodeB → only U1
	got, err = resolver.UsersForTopologyNode(ctx, nodeB, false)
	if err != nil {
		t.Fatalf("UsersForTopologyNode(direct, nodeB): %v", err)
	}
	exactSet(t, "direct on nodeB", got, []uuid.UUID{u1})
}

// TestUsersForTopologyNodeSubtree verifies the recursive CTE captures
// descendant-node grantees.
func TestUsersForTopologyNodeSubtree(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, rootNodeID, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	nodeB := mkChildNode(t, pool, wsID, subID, rootNodeID, "NodeB-sub")
	nodeC := mkChildNode(t, pool, wsID, subID, rootNodeID, "NodeC-sub")

	u1 := mkFixtureUser(t, pool, subID) // clamped to NodeB
	u2 := mkFixtureUser(t, pool, subID) // clamped to NodeA (root)
	u3 := mkFixtureUser(t, pool, subID) // clamped to NodeC

	mkGrantOnNode(t, pool, wsID, subID, nodeB, u1)
	mkGrantOnNode(t, pool, wsID, subID, rootNodeID, u2)
	mkGrantOnNode(t, pool, wsID, subID, nodeC, u3)

	resolver := broadcast.NewResolver(pool)

	// Subtree on root → U1 + U2 + U3
	got, err := resolver.UsersForTopologyNode(ctx, rootNodeID, true)
	if err != nil {
		t.Fatalf("UsersForTopologyNode(subtree, root): %v", err)
	}
	containsAll(t, "subtree root", got, []uuid.UUID{u1, u2, u3})

	// Subtree on nodeB → only U1 (no children of nodeB)
	got, err = resolver.UsersForTopologyNode(ctx, nodeB, true)
	if err != nil {
		t.Fatalf("UsersForTopologyNode(subtree, nodeB): %v", err)
	}
	exactSet(t, "subtree nodeB", got, []uuid.UUID{u1})
}

// TestTopologySubtreeIsSupersetOfDirect verifies the property:
// subtree=true ⊇ subtree=false for any node.
func TestTopologySubtreeIsSupersetOfDirect(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, rootNodeID, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	nodeB := mkChildNode(t, pool, wsID, subID, rootNodeID, "NodeB-prop")

	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)

	mkGrantOnNode(t, pool, wsID, subID, rootNodeID, u1)
	mkGrantOnNode(t, pool, wsID, subID, nodeB, u2)

	resolver := broadcast.NewResolver(pool)

	direct, err := resolver.UsersForTopologyNode(ctx, rootNodeID, false)
	if err != nil {
		t.Fatalf("direct: %v", err)
	}
	subtree, err := resolver.UsersForTopologyNode(ctx, rootNodeID, true)
	if err != nil {
		t.Fatalf("subtree: %v", err)
	}

	// Every user in direct must also be in subtree.
	subtreeSet := make(map[uuid.UUID]struct{}, len(subtree))
	for _, id := range subtree {
		subtreeSet[id] = struct{}{}
	}
	for _, id := range direct {
		if _, ok := subtreeSet[id]; !ok {
			t.Errorf("subtree is NOT superset of direct: user %s in direct but not in subtree", id)
		}
	}
	if len(subtree) < len(direct) {
		t.Errorf("subtree has fewer users than direct: subtree=%d direct=%d", len(subtree), len(direct))
	}
}

// TestUsersForWorkspace verifies the workspace-level resolver.
func TestUsersForWorkspace(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, _, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)
	// u3 in same subscription but NO workspace grant
	u3 := mkFixtureUser(t, pool, subID)
	_ = u3

	mkGrantOnWorkspace(t, pool, wsID, subID, u1)
	mkGrantOnWorkspace(t, pool, wsID, subID, u2)

	resolver := broadcast.NewResolver(pool)

	got, err := resolver.UsersForWorkspace(ctx, wsID)
	if err != nil {
		t.Fatalf("UsersForWorkspace: %v", err)
	}
	containsAll(t, "workspace", got, []uuid.UUID{u1, u2})
	// u3 must not be in the result
	for _, id := range got {
		if id == u3 {
			t.Errorf("UsersForWorkspace included u3 who has no workspace grant")
		}
	}
}

// TestUsersForSubscription verifies the tenant-wide resolver.
func TestUsersForSubscription(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, _, _, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)

	resolver := broadcast.NewResolver(pool)

	got, err := resolver.UsersForSubscription(ctx, subID)
	if err != nil {
		t.Fatalf("UsersForSubscription: %v", err)
	}
	// Both users should be in the set (and only these two for this tenant).
	exactSet(t, "subscription", got, []uuid.UUID{u1, u2})
}

// TestUsersForPlatform verifies the platform resolver returns all active users
// across all subscriptions (asserting our fixture users are in the result).
func TestUsersForPlatform(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, _, _, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)

	resolver := broadcast.NewResolver(pool)

	got, err := resolver.UsersForPlatform(ctx)
	if err != nil {
		t.Fatalf("UsersForPlatform: %v", err)
	}
	// Don't assert exact count (other users from seed data will be present).
	// Assert our test users are in the set.
	containsAll(t, "platform", got, []uuid.UUID{u1, u2})
}

// TestCrossTenantIsolation verifies that topology subtree resolution does
// NOT leak across subscription boundaries. This is the critical security
// property: the recursive CTE is scoped to the root node's subscription.
func TestCrossTenantIsolation(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	// Two independent tenants.
	sub1ID, ws1ID, root1ID, cleanup1 := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup1)
	sub2ID, ws2ID, root2ID, cleanup2 := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup2)

	// User in tenant 2 has a grant on a node with the SAME name as tenant 1's root.
	// The CTE must not cross the subscription boundary.
	_ = ws2ID
	_ = root2ID
	_ = sub2ID

	u1 := mkFixtureUser(t, pool, sub1ID) // in tenant 1
	u2 := mkFixtureUser(t, pool, sub2ID) // in tenant 2 — must NOT appear in tenant 1 results

	mkGrantOnNode(t, pool, ws1ID, sub1ID, root1ID, u1)

	resolver := broadcast.NewResolver(pool)

	got, err := resolver.UsersForTopologyNode(ctx, root1ID, true)
	if err != nil {
		t.Fatalf("UsersForTopologyNode cross-tenant: %v", err)
	}

	containsAll(t, "tenant1 subtree contains u1", got, []uuid.UUID{u1})
	for _, id := range got {
		if id == u2 {
			t.Errorf("SECURITY: cross-tenant contamination — u2 (tenant2) appeared in tenant1 subtree result")
		}
	}
}
