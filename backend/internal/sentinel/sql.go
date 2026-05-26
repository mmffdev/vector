package sentinel

// SQL templates for the production Resolver (PoolResolver in resolver.go).
//
// These mirror the patterns in topology/sql.go but live INSIDE sentinel
// so the Replace decision (PLA062, 2026-05-24) holds: handlers depend
// on the sentinel package alone for the clamp substrate. Once S25
// deletes topology.ClampMiddleware + WorkspaceClampMiddleware, the
// duplicated SQL here becomes the sole source.
//
// All queries use $N parameter placeholders for pgx. Recursive CTEs
// for descendants/ancestors follow the same idempotent shape as the
// originals — descendants walk via parent_id, ancestors walk up via
// the same column reversed.

// sqlDescendantNodeIDs returns rootNodeID plus every live descendant
// (transitive children where archived_at IS NULL). $1 = rootNodeID,
// $2 = subscriptionID.
const sqlDescendantNodeIDs = `
	WITH RECURSIVE live_down AS (
	    SELECT n.topology_nodes_id
	      FROM topology_nodes n
	     WHERE n.topology_nodes_id = $1
	       AND n.topology_nodes_id_subscription = $2
	       AND n.topology_nodes_archived_at IS NULL
	    UNION ALL
	    SELECT c.topology_nodes_id
	      FROM topology_nodes c
	      JOIN live_down ld ON c.topology_nodes_id_parent = ld.topology_nodes_id
	     WHERE c.topology_nodes_id_subscription = $2
	       AND c.topology_nodes_archived_at IS NULL
	)
	SELECT topology_nodes_id FROM live_down
`

// sqlAncestorNodeIDs returns rootNodeID plus every live ancestor up to
// the subscription root (strict chain — no siblings). $1 = rootNodeID,
// $2 = subscriptionID.
const sqlAncestorNodeIDs = `
	WITH RECURSIVE live_up AS (
	    SELECT n.topology_nodes_id, n.topology_nodes_id_parent
	      FROM topology_nodes n
	     WHERE n.topology_nodes_id = $1
	       AND n.topology_nodes_id_subscription = $2
	       AND n.topology_nodes_archived_at IS NULL
	    UNION ALL
	    SELECT p.topology_nodes_id, p.topology_nodes_id_parent
	      FROM topology_nodes p
	      JOIN live_up lu ON lu.topology_nodes_id_parent = p.topology_nodes_id
	     WHERE p.topology_nodes_id_subscription = $2
	       AND p.topology_nodes_archived_at IS NULL
	)
	SELECT topology_nodes_id FROM live_up
`

// sqlNodeBelongsToTenant returns one row when the focus node exists
// in the given tenant AND is not archived. Used to short-circuit
// ErrFocusNotInTenant before running the expensive recursive CTE.
// $1 = nodeID, $2 = subscriptionID.
const sqlNodeBelongsToTenant = `
	SELECT 1
	  FROM topology_nodes
	 WHERE topology_nodes_id = $1
	   AND topology_nodes_id_subscription = $2
	   AND topology_nodes_archived_at IS NULL
	 LIMIT 1
`

// sqlTenantRootNode returns the root topology node for the tenant
// (topology_nodes_id_parent IS NULL, live). $1 = subscriptionID.
const sqlTenantRootNode = `
	SELECT topology_nodes_id
	  FROM topology_nodes
	 WHERE topology_nodes_id_subscription = $1
	   AND topology_nodes_id_parent IS NULL
	   AND topology_nodes_archived_at IS NULL
	 LIMIT 1
`

// sqlFirstLiveWorkspace returns the actor's first live workspace in
// their tenant that they hold an active grant on, ordered by
// created_at ASC (Default lands first). $1 = subscriptionID,
// $2 = userID.
//
// The JOIN against users_roles_workspaces (added 2026-05-25
// alongside the auth.Refresh JWT re-derivation fix) prevents the
// fallback from returning a workspace the user has no grant on
// — which then 403'd at sqlExistsActiveWorkspaceRole one step
// later. Column-prefix convention (PLA naming spec §2.3): every
// column on users_roles_workspaces carries the table-name prefix.
const sqlFirstLiveWorkspace = `
	SELECT mw.master_record_workspaces_id
	  FROM master_record_workspaces mw
	  JOIN users_roles_workspaces urw
	    ON urw.users_roles_workspaces_id_workspace = mw.master_record_workspaces_id
	   AND urw.users_roles_workspaces_id_user = $2
	   AND urw.users_roles_workspaces_revoked_at IS NULL
	 WHERE mw.master_record_workspaces_id_subscription = $1
	   AND mw.master_record_workspaces_archived_at IS NULL
	 ORDER BY mw.master_record_workspaces_created_at ASC
	 LIMIT 1
`

// sqlExistsActiveWorkspaceRole returns TRUE when the user holds any
// active grant on the workspace. $1 = workspaceID, $2 = userID.
//
// Table is `users_roles_workspaces` (renamed from the older
// `workspace_roles` → `roles_workspaces` lineage by migration 132).
// Column-prefix convention (PLA naming spec §2.3): every column on a
// renamed root-family table carries the table-name prefix. The
// "active" gate is `users_roles_workspaces_revoked_at IS NULL`.
const sqlExistsActiveWorkspaceRole = `
	SELECT EXISTS (
	  SELECT 1
	    FROM users_roles_workspaces rw
	   WHERE rw.users_roles_workspaces_id_workspace = $1
	     AND rw.users_roles_workspaces_id_user = $2
	     AND rw.users_roles_workspaces_revoked_at IS NULL
	)
`

// sqlUserDefaultFocus returns the user's persisted default focus node.
// $1 = userID. NULL result → no default set, fall through to tenant
// root. Added by S06 migration (users.default_focus_node_id).
const sqlUserDefaultFocus = `
	SELECT default_focus_node_id
	  FROM users
	 WHERE id = $1
	   AND is_active = TRUE
`

// sqlUpdateUserDefaultFocus persists the user's home/default focus
// node. Pass NULL ($1) to clear (user falls back to tenant root on
// next boot). $2 = userID. Closes the write-side counterpart of
// sqlUserDefaultFocus — the read side has shipped since S06.
const sqlUpdateUserDefaultFocus = `
	UPDATE users
	   SET default_focus_node_id = $1,
	       updated_at = NOW()
	 WHERE id = $2
	   AND is_active = TRUE
`

// sqlUserHasGrantOnNodeOrAncestor walks UP from $1 (nodeID) through
// parent_id within $2 (tenant/subscription) and returns TRUE when $3
// (userID) holds an active grant on the node OR any ancestor —
// matching the PLA-0043 scope-read gate already used by
// topology.ClampPredicate (sql.go:23 sqlAncestorsHasGrantOnTargetOrAncestor).
//
// Used by PutFocus to gate writes: a user must not be able to store
// a default focus pointing at a node they have no descend-inheritance
// access to. The recursive walk matches how the request-time middleware
// expands the user's access at read time (scope-down by default).
const sqlUserHasGrantOnNodeOrAncestor = `
	WITH RECURSIVE ancestors AS (
	    SELECT topology_nodes_id, topology_nodes_id_parent
	      FROM topology_nodes
	     WHERE topology_nodes_id = $1
	       AND topology_nodes_id_subscription = $2
	       AND topology_nodes_archived_at IS NULL
	    UNION ALL
	    SELECT p.topology_nodes_id, p.topology_nodes_id_parent
	      FROM topology_nodes p
	      JOIN ancestors a ON a.topology_nodes_id_parent = p.topology_nodes_id
	     WHERE p.topology_nodes_id_subscription = $2
	       AND p.topology_nodes_archived_at IS NULL
	)
	SELECT EXISTS (
	    SELECT 1
	      FROM ancestors a
	      JOIN users_roles_topology_nodes r
	        ON r.users_roles_topology_nodes_id_topology_node = a.topology_nodes_id
	     WHERE r.users_roles_topology_nodes_id_subscription = $2
	       AND r.users_roles_topology_nodes_id_user = $3
	       AND r.users_roles_topology_nodes_revoked_at IS NULL
	)
`
