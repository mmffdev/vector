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
	    SELECT n.id
	      FROM topology_nodes n
	     WHERE n.id = $1
	       AND n.subscription_id = $2
	       AND n.archived_at IS NULL
	    UNION ALL
	    SELECT c.id
	      FROM topology_nodes c
	      JOIN live_down ld ON c.parent_id = ld.id
	     WHERE c.subscription_id = $2
	       AND c.archived_at IS NULL
	)
	SELECT id FROM live_down
`

// sqlAncestorNodeIDs returns rootNodeID plus every live ancestor up to
// the subscription root (strict chain — no siblings). $1 = rootNodeID,
// $2 = subscriptionID.
const sqlAncestorNodeIDs = `
	WITH RECURSIVE live_up AS (
	    SELECT n.id, n.parent_id
	      FROM topology_nodes n
	     WHERE n.id = $1
	       AND n.subscription_id = $2
	       AND n.archived_at IS NULL
	    UNION ALL
	    SELECT p.id, p.parent_id
	      FROM topology_nodes p
	      JOIN live_up lu ON lu.parent_id = p.id
	     WHERE p.subscription_id = $2
	       AND p.archived_at IS NULL
	)
	SELECT id FROM live_up
`

// sqlNodeBelongsToTenant returns one row when the focus node exists
// in the given tenant AND is not archived. Used to short-circuit
// ErrFocusNotInTenant before running the expensive recursive CTE.
// $1 = nodeID, $2 = subscriptionID.
const sqlNodeBelongsToTenant = `
	SELECT 1
	  FROM topology_nodes
	 WHERE id = $1
	   AND subscription_id = $2
	   AND archived_at IS NULL
	 LIMIT 1
`

// sqlTenantRootNode returns the root topology node for the tenant
// (parent_id IS NULL, live). $1 = subscriptionID.
const sqlTenantRootNode = `
	SELECT id
	  FROM topology_nodes
	 WHERE subscription_id = $1
	   AND parent_id IS NULL
	   AND archived_at IS NULL
	 LIMIT 1
`

// sqlFirstLiveWorkspace returns the actor's first live workspace in
// their tenant ordered by created_at ASC (Default lands first). $1 =
// subscriptionID.
//
// Table is `workspace` (singular) per the rename in §2.6 of the
// naming-convention spec; every other handler in backend/internal/
// uses the same. Sentinel was copy-pasted from a pre-rename draft.
const sqlFirstLiveWorkspace = `
	SELECT id
	  FROM workspace
	 WHERE subscription_id = $1
	   AND archived_at IS NULL
	 ORDER BY created_at ASC
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
