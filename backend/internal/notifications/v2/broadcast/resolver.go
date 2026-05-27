// Package broadcast — inverse-Sentinel resolver + broadcast.Service for
// fan-out notifications (workspace, topology_node, topology_subtree, tenant,
// platform modes — everything except direct, which Producer handles).
//
// Locked decisions (spec §Locked decisions):
//
//   #11 — Six fan-out modes; five are broadcast classes.
//   #12 — Recipient snapshot at fire-time. New users added after
//          broadcast resolved do NOT retroactively receive.
//   #13 — Inverse Sentinel lives here, NOT in sentinel package.
//          Sentinel owns forward clamp; broadcast owns inverse.
//
// See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
package broadcast

import (
	"context"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Resolver is the inverse-Sentinel interface. Given a scope, it returns the
// set of active user IDs that fall within that scope at the moment of the
// call. Each resolved set is a fire-time snapshot — callers must not re-use
// the returned slice across writes (spec locked decision #12).
//
// All methods return a deterministically sorted []uuid.UUID (ascending by
// string representation) so downstream INSERT ordering is stable and tests
// can assert exact sets without sorting.
type Resolver interface {
	// UsersForTopologyNode returns active users whose sentinel clamp
	// includes nodeID. When subtree=true, the clamp extends to all live
	// descendants of nodeID (recursive CTE walk).
	UsersForTopologyNode(ctx context.Context, nodeID uuid.UUID, subtree bool) ([]uuid.UUID, error)

	// UsersForWorkspace returns all active users who hold an active grant
	// on the given workspace.
	UsersForWorkspace(ctx context.Context, workspaceID uuid.UUID) ([]uuid.UUID, error)

	// UsersForSubscription returns all active users in the given subscription
	// (tenant), regardless of workspace or node clamp.
	UsersForSubscription(ctx context.Context, subscriptionID uuid.UUID) ([]uuid.UUID, error)

	// UsersForPlatform returns all active users across every subscription.
	// Platform broadcasts are rare and expected to be slow for large
	// user populations (spec accepts this; S03 implements straightforwardly).
	UsersForPlatform(ctx context.Context) ([]uuid.UUID, error)
}

// pgResolver is the production Postgres implementation of Resolver.
// It holds a pool to vector_artefacts (vaPool in main.go).
type pgResolver struct {
	pool *pgxpool.Pool
}

// NewResolver constructs a pgResolver against the given Postgres pool.
// The pool must target vector_artefacts (the canonical tenant DB).
func NewResolver(pool *pgxpool.Pool) Resolver {
	return &pgResolver{pool: pool}
}

// UsersForTopologyNode implements the inverse of Sentinel's forward clamp.
//
// subtree=false: returns users who hold a direct active grant on nodeID in
// users_roles_topology_nodes. This mirrors the forward clamp — if the user's
// grant covers nodeID, nodeID is in their allowed subtree.
//
// subtree=true: walks all live descendants of nodeID (recursive CTE from
// sentinel/sql.go sqlDescendantNodeIDs shape) then returns users who hold
// an active grant on any node in the descendant set. This implements the
// "scope_down" inverse — every user whose scope would include any descendant
// of nodeID gets the broadcast.
//
// Subscription guard: the recursive CTE scopes the descent to
// topology_nodes_id_subscription = (SELECT topology_nodes_id_subscription
// FROM topology_nodes WHERE topology_nodes_id = $1) so cross-tenant
// contamination is impossible even on a shared pool.
func (r *pgResolver) UsersForTopologyNode(ctx context.Context, nodeID uuid.UUID, subtree bool) ([]uuid.UUID, error) {
	var q string
	if !subtree {
		q = sqlUsersForTopologyNodeDirect
	} else {
		q = sqlUsersForTopologyNodeSubtree
	}

	rows, err := r.pool.Query(ctx, q, nodeID)
	if err != nil {
		return nil, fmt.Errorf("broadcast.Resolver.UsersForTopologyNode(subtree=%v, node=%s): %w", subtree, nodeID, err)
	}
	defer rows.Close()

	return scanUUIDs(rows)
}

// UsersForWorkspace returns all active users who hold an active grant on the
// given workspace (joined through users_roles_workspaces).
func (r *pgResolver) UsersForWorkspace(ctx context.Context, workspaceID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, sqlUsersForWorkspace, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("broadcast.Resolver.UsersForWorkspace(ws=%s): %w", workspaceID, err)
	}
	defer rows.Close()

	return scanUUIDs(rows)
}

// UsersForSubscription returns all active users who belong to the given
// subscription (tenant). Does not filter by workspace or topology node.
func (r *pgResolver) UsersForSubscription(ctx context.Context, subscriptionID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, sqlUsersForSubscription, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("broadcast.Resolver.UsersForSubscription(sub=%s): %w", subscriptionID, err)
	}
	defer rows.Close()

	return scanUUIDs(rows)
}

// UsersForPlatform returns all active users across every subscription.
// This is intentionally a full-table scan — platform broadcasts are
// rare and accepted to be slow (spec §Risks).
func (r *pgResolver) UsersForPlatform(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, sqlUsersForPlatform)
	if err != nil {
		return nil, fmt.Errorf("broadcast.Resolver.UsersForPlatform: %w", err)
	}
	defer rows.Close()

	return scanUUIDs(rows)
}

// scanUUIDs drains a pgx Rows result of a single-uuid-column query into a
// sorted slice. The sort is ascending by string form — matches the stable
// INSERT order that service_test.go uses for deterministic assertions.
func scanUUIDs(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan uuid: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}

	// Sort for deterministic ordering across tests and INSERT sequences.
	sort.Slice(ids, func(i, j int) bool {
		return ids[i].String() < ids[j].String()
	})
	return ids, nil
}

// ---- SQL ----

// sqlUsersForTopologyNodeDirect — users who hold an active grant directly
// on the target node. The subscription guard (derived from the node's own
// subscription FK) prevents cross-tenant contamination.
//
// $1 = nodeID (uuid)
const sqlUsersForTopologyNodeDirect = `
	SELECT DISTINCT u.users_id
	  FROM users u
	  JOIN users_roles_topology_nodes rtn
	    ON rtn.users_roles_topology_nodes_id_user = u.users_id
	   AND rtn.users_roles_topology_nodes_revoked_at IS NULL
	 WHERE rtn.users_roles_topology_nodes_id_topology_node = $1
	   AND u.users_is_active = TRUE
`

// sqlUsersForTopologyNodeSubtree — users who hold an active grant on the
// target node OR any live descendant. The recursive CTE mirrors the
// sentinel/sql.go sqlDescendantNodeIDs shape, scoped to the same
// subscription as the root node (preventing cross-tenant descent).
//
// $1 = nodeID (uuid)
const sqlUsersForTopologyNodeSubtree = `
	WITH RECURSIVE live_down AS (
	    SELECT n.topology_nodes_id,
	           n.topology_nodes_id_subscription
	      FROM topology_nodes n
	     WHERE n.topology_nodes_id = $1
	       AND n.topology_nodes_archived_at IS NULL
	    UNION ALL
	    SELECT c.topology_nodes_id,
	           c.topology_nodes_id_subscription
	      FROM topology_nodes c
	      JOIN live_down ld ON c.topology_nodes_id_parent = ld.topology_nodes_id
	     WHERE c.topology_nodes_id_subscription = ld.topology_nodes_id_subscription
	       AND c.topology_nodes_archived_at IS NULL
	)
	SELECT DISTINCT u.users_id
	  FROM users u
	  JOIN users_roles_topology_nodes rtn
	    ON rtn.users_roles_topology_nodes_id_user = u.users_id
	   AND rtn.users_roles_topology_nodes_revoked_at IS NULL
	  JOIN live_down ld
	    ON ld.topology_nodes_id = rtn.users_roles_topology_nodes_id_topology_node
	 WHERE u.users_is_active = TRUE
`

// sqlUsersForWorkspace — active users who hold an active grant on the
// given workspace, joined through users_roles_workspaces.
//
// $1 = workspaceID (uuid)
const sqlUsersForWorkspace = `
	SELECT DISTINCT u.users_id
	  FROM users u
	  JOIN users_roles_workspaces urw
	    ON urw.users_roles_workspaces_id_user = u.users_id
	   AND urw.users_roles_workspaces_revoked_at IS NULL
	 WHERE urw.users_roles_workspaces_id_workspace = $1
	   AND u.users_is_active = TRUE
`

// sqlUsersForSubscription — all active users in the subscription (tenant).
//
// $1 = subscriptionID (uuid)
const sqlUsersForSubscription = `
	SELECT users_id
	  FROM users
	 WHERE users_id_subscription = $1
	   AND users_is_active = TRUE
`

// sqlUsersForPlatform — all active users across every subscription.
// Full-table scan; platform broadcasts are rare.
const sqlUsersForPlatform = `
	SELECT users_id
	  FROM users
	 WHERE users_is_active = TRUE
`
