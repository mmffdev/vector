// Package topology SQL constants.
//
// PLA-0048 / RF1.2.1. Every SQL string literal used by the topology
// package lives here as a named constant. The service / handler /
// middleware / commands files reference these constants; they DO NOT
// embed raw SQL.
//
// Naming: sqlVerbResource — sqlSelectCommitStatus, sqlUpsertCommit,
// etc. CTE-heavy queries use a descriptive name (sqlAncestorsHasGrant).
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// Dynamic fragments: a few queries splice in a workspace-clamp clause
// from workspaceClause(...) (sql_helpers.go). The clamp is the dynamic
// contribution; the constant here carries the STATIC template with
// `%s` placeholders where the clamp goes. Callers do fmt.Sprintf to
// combine.
package topology

// ── users_permissions.go ──────────────────────────────────────────────────────────

// sqlAncestorsHasGrantOnTargetOrAncestor walks UP from targetNodeID
// through parent_id and returns whether the user holds an active grant
// on any ancestor (incl. the node itself). PLA-0043 scope-read gate.
const sqlAncestorsHasGrantOnTargetOrAncestor = `
		WITH RECURSIVE ancestors AS (
		    SELECT id, parent_id
		      FROM topology_nodes
		     WHERE id = $1
		       AND subscription_id = $2
		       AND archived_at IS NULL
		    UNION ALL
		    SELECT p.id, p.parent_id
		      FROM topology_nodes p
		      JOIN ancestors a ON a.parent_id = p.id
		     WHERE p.subscription_id = $2
		       AND p.archived_at IS NULL
		)
		SELECT EXISTS (
		    SELECT 1
		      FROM ancestors a
		      JOIN users_roles_topology_nodes r
		        ON r.users_roles_topology_nodes_id_topology_node = a.id
		     WHERE r.users_roles_topology_nodes_id_subscription = $2
		       AND r.users_roles_topology_nodes_id_user = $3
		       AND r.users_roles_topology_nodes_revoked_at IS NULL
		)
	`

// ── commands.go ─────────────────────────────────────────────────────────────

// sqlSetNodeParentNull detaches a node from its parent (makes it a root).
// Used by Disconnect for the special "single root" early-exit case.
const sqlSetNodeParentNull = `UPDATE topology_nodes SET parent_id = NULL WHERE id = $1`

// sqlPatchNodeTemplate is the sparse-update shell used by PatchNode.
// First %s holds the comma-separated `col = $N` SET clause built from the
// supplied non-nil PatchNodeInput fields; second %s holds the `$M` placeholder
// for the WHERE id bind. Callers do fmt.Sprintf to combine.
const sqlPatchNodeTemplate = `UPDATE topology_nodes SET %s WHERE id = %s`

// sqlListDisconnectedRootsTemplate returns every live node whose
// parent_id IS NULL, excluding the canonical (lowest-sort_order) root.
// Two %s placeholders for the workspace clamp: one inside the roots CTE
// (clamped against the bare table), one for the outer SELECT (clamped
// against alias `n`). See workspaceClause / workspaceClauseAt in
// sql_helpers.go.
const sqlListDisconnectedRootsTemplate = `
		WITH roots AS (
		    SELECT id, sort_order,
		           ROW_NUMBER() OVER (ORDER BY sort_order, created_at) AS rn
		      FROM topology_nodes
		     WHERE subscription_id = $1
		       AND parent_id IS NULL
		       AND archived_at IS NULL%s
		)
		SELECT n.id, n.workspace_id, n.subscription_id, n.parent_id, n.name, n.description, n.label_override,
		       n.icon, n.colour, n.avatar_url,
		       n.layout_mode, n.x, n.y,
		       n.collapsed_default, n.sort_order, n.archived_at, n.created_at, n.updated_at
		  FROM topology_nodes n
		  JOIN roots r ON r.id = n.id
		 WHERE r.rn > 1%s
		 ORDER BY n.sort_order, n.created_at
	`

// sqlSelectCommitStatus reads the current commit checkpoint row from
// topology_commits. Used by GetCommitStatus.
const sqlSelectCommitStatus = `
		SELECT committed_at, committed_by
		  FROM topology_commits
		 WHERE subscription_id = $1
	`

// sqlSelectMaxNodeUpdatedAt computes MAX(updated_at) across live
// topology_nodes for a subscription — the "dirty since commit" probe.
const sqlSelectMaxNodeUpdatedAt = `
		SELECT MAX(updated_at) FROM topology_nodes WHERE subscription_id = $1
	`

// sqlUpsertCommit stamps the working-model commit checkpoint. Single
// row per subscription; ON CONFLICT bumps committed_at/_by and the
// updated_at bookkeeping column.
const sqlUpsertCommit = `
		INSERT INTO topology_commits (subscription_id, committed_at, committed_by)
		VALUES ($1, NOW(), $2)
		ON CONFLICT (subscription_id) DO UPDATE
		   SET committed_at = EXCLUDED.committed_at,
		       committed_by = EXCLUDED.committed_by,
		       updated_at   = NOW()
	`

// sqlArchiveAllLiveNodes archives every live topology_nodes row in a
// subscription. Used by ResetCanvas — story 00310.
const sqlArchiveAllLiveNodes = `
		UPDATE topology_nodes
		   SET archived_at = NOW()
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
	`

// sqlRenameWorkspaceRootNode renames the root topology node of a single
// workspace ($2). Only touches the root (parent_id IS NULL) — child node
// names are independent. Called from workspaces.Service.Rename via the
// TopologySeeder interface so the writer-boundary lint stays green.
// $1 = newName, $2 = workspaceID.
const sqlRenameWorkspaceRootNode = `
		UPDATE topology_nodes
		   SET name = $1
		 WHERE workspace_id = $2
		   AND parent_id IS NULL
		   AND archived_at IS NULL
	`

// sqlArchiveWorkspaceTopology archives every live topology_nodes row
// belonging to a workspace so grants/me stops returning them after the
// workspace itself is archived. Called from workspaces.Service.Archive
// via TopologySeeder. $1 = workspaceID.
const sqlArchiveWorkspaceTopology = `
		UPDATE topology_nodes
		   SET archived_at = NOW()
		 WHERE workspace_id = $1
		   AND archived_at IS NULL
	`

// sqlRestoreWorkspaceTopology unarchives every topology_nodes row for
// a workspace on workspace restore so the nodes re-appear in grants/me.
// Mirror inverse of sqlArchiveWorkspaceTopology. $1 = workspaceID.
const sqlRestoreWorkspaceTopology = `
		UPDATE topology_nodes
		   SET archived_at = NULL
		 WHERE workspace_id = $1
	`

// ── middleware.go ───────────────────────────────────────────────────────────

// sqlSelectTenantRootID resolves the canonical root topology_node for a
// subscription (the live parent_id IS NULL row with the lowest
// sort_order). Used by ClampMiddleware when it needs the absolute
// tenant root (no workspace clamp).
const sqlSelectTenantRootID = `
		SELECT id FROM topology_nodes
		 WHERE subscription_id = $1
		   AND parent_id IS NULL
		   AND archived_at IS NULL
		 ORDER BY sort_order
		 LIMIT 1
	`

// sqlSelectTenantRootIDWorkspaceClampedTemplate is the workspace-clamped
// version of sqlSelectTenantRootID. The %s placeholder is filled by
// workspaceClause(...) which appends an `AND workspace_id = $N` fragment
// (or the empty string when no clamp is active).
const sqlSelectTenantRootIDWorkspaceClampedTemplate = `
		SELECT id FROM topology_nodes
		 WHERE subscription_id = $1
		   AND parent_id IS NULL
		   AND archived_at IS NULL%s
		 ORDER BY sort_order
		 LIMIT 1
	`

// sqlSelectFirstLiveWorkspaceID returns the earliest-created live
// workspace for a subscription. Used as the fallback when no ?ws=
// query param is provided.
const sqlSelectFirstLiveWorkspaceID = `
		SELECT id FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY created_at ASC
		 LIMIT 1
	`

// sqlSelectWorkspaceIDBySlug resolves a workspace by (subscription, slug).
const sqlSelectWorkspaceIDBySlug = `
		SELECT id FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND slug = $2
		   AND archived_at IS NULL
		 LIMIT 1
	`

// sqlSelectWorkspaceIDByIDAndSubscription resolves a workspace by
// (id, subscription) — the UUID branch of ResolveRef.
const sqlSelectWorkspaceIDByIDAndSubscription = `
			SELECT id FROM master_record_workspaces
			 WHERE id              = $1
			   AND subscription_id = $2
			   AND archived_at IS NULL
			 LIMIT 1
		`

// sqlExistsActiveWorkspaceRole returns whether a user holds a live
// role assignment on the given workspace.
const sqlExistsActiveWorkspaceRole = `
		SELECT EXISTS(
		    SELECT 1 FROM users_roles_workspaces
		     WHERE users_roles_workspaces_id_workspace = $1
		       AND users_roles_workspaces_id_user      = $2
		       AND users_roles_workspaces_revoked_at IS NULL
		)
	`

// ── handler.go ──────────────────────────────────────────────────────────────

// sqlCycleCheckAncestor returns whether $2 is an ancestor of $1
// (subscription $3). Used by the cycle-prevention check in the
// preview-move handler.
const sqlCycleCheckAncestor = `
			WITH RECURSIVE up AS (
			    SELECT id, parent_id FROM topology_nodes WHERE id = $1 AND subscription_id = $3
			    UNION ALL
			    SELECT n.id, n.parent_id
			      FROM topology_nodes n
			      JOIN up ON up.parent_id = n.id
			     WHERE n.subscription_id = $3
			)
			SELECT EXISTS(SELECT 1 FROM up WHERE id = $2)
		`

// ── service.go ──────────────────────────────────────────────────────────────

// sqlInsertNode inserts a new topology_nodes row and returns the full
// row for hydrating a Node. Used by CreateNode.
const sqlInsertNode = `
		INSERT INTO topology_nodes (
		    id,
		    workspace_id, subscription_id, parent_id, name, description, label_override,
		    icon, colour, avatar_url,
		    layout_mode, x, y,
		    collapsed_default, sort_order
		) VALUES (
		    gen_random_uuid(),
		    $1, $2, $3, $4, $5, $6,
		    $7, $8, $9,
		    $10, $11, $12,
		    $13, $14
		)
		RETURNING
		    id, workspace_id, subscription_id, parent_id, name, description, label_override,
		    icon, colour, avatar_url,
		    layout_mode, x, y,
		    collapsed_default, sort_order, archived_at, created_at, updated_at
	`

// sqlRenameNode updates topology_nodes.name. Subscription scope is
// enforced by the loadNode FOR UPDATE check in the caller.
const sqlRenameNode = `UPDATE topology_nodes SET name = $1 WHERE id = $2`

// sqlCycleCheckMoveAncestor walks UP from $1 (the prospective new parent)
// and returns whether $2 (the moving node) appears among its ancestors —
// i.e. moving $2 under $1 would create a cycle. No subscription guard:
// loadNode in MoveNode already established both rows live inside the
// caller's subscription.
const sqlCycleCheckMoveAncestor = `
			WITH RECURSIVE up AS (
			    SELECT id, parent_id FROM topology_nodes WHERE id = $1
			    UNION ALL
			    SELECT n.id, n.parent_id
			      FROM topology_nodes n
			      JOIN up ON up.parent_id = n.id
			)
			SELECT EXISTS(SELECT 1 FROM up WHERE id = $2)
		`

// sqlMoveNode reparents a node. parent_id may be NULL (move to root).
const sqlMoveNode = `UPDATE topology_nodes SET parent_id = $1 WHERE id = $2`

// sqlArchiveNode stamps archived_at = NOW() on a live node. Idempotent:
// the WHERE clause makes a re-archive a no-op.
const sqlArchiveNode = `
		UPDATE topology_nodes SET archived_at = NOW()
		 WHERE id = $1 AND archived_at IS NULL
	`

// sqlBulkPositionUpdate applies a (sort_order, layout_mode, x, y) update
// for a single node — the per-row exec inside BulkPosition's tx.
const sqlBulkPositionUpdate = `
		UPDATE topology_nodes
		   SET sort_order = $1, layout_mode = $2, x = $3, y = $4
		 WHERE id = $5
	`

// sqlShiftRootSiblingsUp opens a slot for a duplicate root by shifting
// all later root siblings (parent_id IS NULL) up by 1.
const sqlShiftRootSiblingsUp = `
		UPDATE topology_nodes
		   SET sort_order = sort_order + 1
		 WHERE subscription_id = $1
		   AND parent_id IS NULL
		   AND archived_at IS NULL
		   AND sort_order > $2
	`

// sqlShiftChildSiblingsUp opens a slot for a duplicate child by shifting
// all later siblings under the same parent up by 1.
const sqlShiftChildSiblingsUp = `
		UPDATE topology_nodes
		   SET sort_order = sort_order + 1
		 WHERE subscription_id = $1
		   AND parent_id = $2
		   AND archived_at IS NULL
		   AND sort_order > $3
	`

// sqlWalkSubtreeForClone walks a live subtree depth-first via a recursive
// CTE, ordered so every parent appears before its children. Used by
// DuplicateSubtree to enumerate rows to clone.
const sqlWalkSubtreeForClone = `
		WITH RECURSIVE down AS (
		    SELECT n.*, ARRAY[n.sort_order]::INT[] AS path
		      FROM topology_nodes n
		     WHERE n.id = $1 AND n.subscription_id = $2 AND n.archived_at IS NULL
		    UNION ALL
		    SELECT c.*, down.path || c.sort_order
		      FROM topology_nodes c
		      JOIN down ON c.parent_id = down.id
		     WHERE c.subscription_id = $2 AND c.archived_at IS NULL
		)
		SELECT id, workspace_id, parent_id, name, description, label_override,
		       icon, colour, avatar_url,
		       layout_mode, x, y,
		       collapsed_default, sort_order
		  FROM down
		 ORDER BY path
	`

// sqlSelectActiveGrantForUserOnNode is the idempotency probe for GrantRole.
const sqlSelectActiveGrantForUserOnNode = `
		SELECT users_roles_topology_nodes_id FROM users_roles_topology_nodes
		 WHERE users_roles_topology_nodes_id_topology_node = $1
		   AND users_roles_topology_nodes_id_user = $2
		   AND users_roles_topology_nodes_revoked_at IS NULL
		 LIMIT 1
	`

// sqlExistsActiveAdminGrantOnNode enforces the MVP single-admin invariant
// before inserting an admin grant.
const sqlExistsActiveAdminGrantOnNode = `
		SELECT EXISTS(
		    SELECT 1 FROM users_roles_topology_nodes
		     WHERE users_roles_topology_nodes_id_topology_node = $1
		       AND users_roles_topology_nodes_role_code = 'admin'
		       AND users_roles_topology_nodes_revoked_at IS NULL
		)
	`

// sqlInsertGrant inserts a new active role grant. role_id is NULL on the
// new substrate (legacy column kept for transitional reasons); see
// PLA-0007 for the role-table cutover plan.
const sqlInsertGrant = `
		INSERT INTO users_roles_topology_nodes (
			users_roles_topology_nodes_id,
			users_roles_topology_nodes_id_workspace,
			users_roles_topology_nodes_id_subscription,
			users_roles_topology_nodes_id_topology_node,
			users_roles_topology_nodes_id_user,
			users_roles_topology_nodes_role_code,
			users_roles_topology_nodes_id_role,
			users_roles_topology_nodes_can_redelegate,
			users_roles_topology_nodes_id_user_granter
		) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NULL, $6, $7)
		RETURNING users_roles_topology_nodes_id, users_roles_topology_nodes_granted_at
	`

// sqlRevokeGrant stamps users_roles_topology_nodes_revoked_at + users_roles_topology_nodes_id_user_revoker on an active grant
// scoped to the caller's subscription. RowsAffected = 0 signals
// "no active grant" (caller maps to ErrGrantNotFound).
const sqlRevokeGrant = `
		UPDATE users_roles_topology_nodes
		   SET users_roles_topology_nodes_revoked_at = NOW(),
		       users_roles_topology_nodes_id_user_revoker = $1
		 WHERE users_roles_topology_nodes_id = $2
		   AND users_roles_topology_nodes_id_subscription = $3
		   AND users_roles_topology_nodes_revoked_at IS NULL
	`

// sqlUpsertViewState writes one row per (workspace, user) carrying the
// canvas viewport (pan + zoom). ON CONFLICT bumps coordinates + bookkeeping.
const sqlUpsertViewState = `
		INSERT INTO topology_view_states (
		    topology_view_states_id_workspace,
		    topology_view_states_id_subscription,
		    topology_view_states_id_user,
		    topology_view_states_viewport_x,
		    topology_view_states_viewport_y,
		    topology_view_states_viewport_zoom
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (topology_view_states_id_workspace, topology_view_states_id_user)
		DO UPDATE SET topology_view_states_viewport_x    = EXCLUDED.topology_view_states_viewport_x,
		              topology_view_states_viewport_y    = EXCLUDED.topology_view_states_viewport_y,
		              topology_view_states_viewport_zoom = EXCLUDED.topology_view_states_viewport_zoom,
		              topology_view_states_updated_at    = NOW()
	`

// sqlSubtreeTemplate is the depth-first live-subtree walker with archived
// descendant rollup. Three %s placeholders for workspace clamps (n / c / a).
const sqlSubtreeTemplate = `
		WITH RECURSIVE down AS (
		    SELECT n.*, ARRAY[n.sort_order, 0]::INT[] AS path
		      FROM topology_nodes n
		     WHERE n.id = $1 AND n.subscription_id = $2 AND n.archived_at IS NULL%s
		    UNION ALL
		    SELECT c.*, down.path || c.sort_order
		      FROM topology_nodes c
		      JOIN down ON c.parent_id = down.id
		     WHERE c.subscription_id = $2 AND c.archived_at IS NULL%s
		), archived_children AS (
		    SELECT a.id AS arch_id, d.id AS anchor_id
		      FROM topology_nodes a
		      JOIN down d ON a.parent_id = d.id
		     WHERE a.subscription_id = $2
		       AND a.archived_at IS NOT NULL%s
		), archived_subtree AS (
		    SELECT arch_id, anchor_id FROM archived_children
		    UNION ALL
		    SELECT c.id, ast.anchor_id
		      FROM topology_nodes c
		      JOIN archived_subtree ast ON c.parent_id = ast.arch_id
		     WHERE c.subscription_id = $2
		       AND c.archived_at IS NOT NULL%s
		), per_anchor AS (
		    SELECT anchor_id, COUNT(*)::INT AS arch_count
		      FROM archived_subtree
		     GROUP BY anchor_id
		), live_path AS (
		    SELECT d.id AS live_id, d.id AS anchor_id
		      FROM down d
		    UNION ALL
		    SELECT lp.live_id, c.id
		      FROM live_path lp
		      JOIN down c ON c.parent_id = lp.anchor_id
		), rollup AS (
		    SELECT lp.live_id, COALESCE(SUM(pa.arch_count), 0)::INT AS arch_total
		      FROM live_path lp
		      LEFT JOIN per_anchor pa ON pa.anchor_id = lp.anchor_id
		     GROUP BY lp.live_id
		)
		SELECT d.id, d.workspace_id, d.subscription_id, d.parent_id, d.name, d.description, d.label_override,
		       d.icon, d.colour, d.avatar_url,
		       d.layout_mode, d.x, d.y,
		       d.collapsed_default, d.sort_order, d.archived_at, d.created_at, d.updated_at,
		       COALESCE(r.arch_total, 0) AS archived_descendant_count
		  FROM down d
		  LEFT JOIN rollup r ON r.live_id = d.id
		 ORDER BY d.path
	`

// sqlAncestorsOf walks UP from a node and returns the chain root → node.
const sqlAncestorsOf = `
		WITH RECURSIVE up AS (
		    SELECT n.*, 0 AS depth
		      FROM topology_nodes n
		     WHERE n.id = $1 AND n.subscription_id = $2
		    UNION ALL
		    SELECT p.*, up.depth + 1
		      FROM topology_nodes p
		      JOIN up ON up.parent_id = p.id
		     WHERE p.subscription_id = $2
		)
		SELECT id, workspace_id, subscription_id, parent_id, name, description, label_override,
		       icon, colour, avatar_url,
		       layout_mode, x, y,
		       collapsed_default, sort_order, archived_at, created_at, updated_at
		  FROM up
		 ORDER BY depth DESC
	`

// sqlArchivedDescendantsTemplate walks DOWN from a live anchor, enters
// every archived child branch, and recurses through transitively-archived
// descendants. Three %s placeholders for workspace clamps (n / c / a).
const sqlArchivedDescendantsTemplate = `
		WITH RECURSIVE live_down AS (
		    SELECT n.id
		      FROM topology_nodes n
		     WHERE n.id = $1
		       AND n.subscription_id = $2
		       AND n.archived_at IS NULL%s
		    UNION ALL
		    SELECT c.id
		      FROM topology_nodes c
		      JOIN live_down ld ON c.parent_id = ld.id
		     WHERE c.subscription_id = $2
		       AND c.archived_at IS NULL%s
		), arch AS (
		    SELECT a.id, a.parent_id, a.name, a.archived_at
		      FROM topology_nodes a
		      JOIN live_down ld ON a.parent_id = ld.id
		     WHERE a.subscription_id = $2
		       AND a.archived_at IS NOT NULL%s
		    UNION ALL
		    SELECT c.id, c.parent_id, c.name, c.archived_at
		      FROM topology_nodes c
		      JOIN arch ON c.parent_id = arch.id
		     WHERE c.subscription_id = $2
		       AND c.archived_at IS NOT NULL%s
		)
		SELECT a.id, a.parent_id, a.name, a.archived_at,
		       (p.archived_at IS NOT NULL) AS parent_is_archived
		  FROM arch a
		  LEFT JOIN topology_nodes p ON p.id = a.parent_id
		 ORDER BY a.archived_at DESC, a.name
	`

// sqlDescendantNodeIDsTemplate returns rootNodeID plus every live
// descendant's ID. Two %s placeholders for workspace clamps (n / c).
const sqlDescendantNodeIDsTemplate = `
		WITH RECURSIVE live_down AS (
		    SELECT n.id
		      FROM topology_nodes n
		     WHERE n.id = $1
		       AND n.subscription_id = $2
		       AND n.archived_at IS NULL%s
		    UNION ALL
		    SELECT c.id
		      FROM topology_nodes c
		      JOIN live_down ld ON c.parent_id = ld.id
		     WHERE c.subscription_id = $2
		       AND c.archived_at IS NULL%s
		)
		SELECT id FROM live_down
	`

// sqlSelectParentForRestoreByID probes a candidate landing parent (by ID
// alone) so RestoreNode can validate it before reparenting.
const sqlSelectParentForRestoreByID = `
		SELECT subscription_id, archived_at FROM topology_nodes WHERE id = $1
	`

// sqlSelectParentForRestoreInTenant probes the node's current parent
// inside the caller's subscription so RestoreNode can decide whether
// "keep current parent" is safe.
const sqlSelectParentForRestoreInTenant = `
		SELECT archived_at FROM topology_nodes WHERE id = $1 AND subscription_id = $2
	`

// sqlRestoreNode clears archived_at and stamps parent_id + updated_at on
// a single node. Pair-or-null landing parent semantics enforced by the
// caller.
const sqlRestoreNode = `
		UPDATE topology_nodes
		   SET archived_at = NULL,
		       parent_id   = $2,
		       updated_at  = NOW()
		 WHERE id = $1
	`

// sqlListMyGrants is the self-pivot grant list for the scope picker.
// Joins active grants to live nodes for the (subscription, user) pair.
const sqlListMyGrants = `
		SELECT r.users_roles_topology_nodes_id, r.users_roles_topology_nodes_id_topology_node, n.workspace_id, n.parent_id,
		       n.name, n.label_override, n.colour, n.icon,
		       r.users_roles_topology_nodes_role_code, r.users_roles_topology_nodes_granted_at, n.sort_order
		  FROM users_roles_topology_nodes r
		  JOIN topology_nodes n ON n.id = r.users_roles_topology_nodes_id_topology_node
		 WHERE r.users_roles_topology_nodes_id_subscription = $1
		   AND r.users_roles_topology_nodes_id_user = $2
		   AND r.users_roles_topology_nodes_revoked_at IS NULL
		   AND n.archived_at IS NULL
		 ORDER BY n.sort_order, n.name
	`

// sqlListMyGrantsGadmin synthesises an admin grant on every live node in the
// subscription. The scope picker's buildTree reconstructs the hierarchy from
// parent_id so the user sees workspaces with their children nested beneath.
// Archived nodes are excluded at all levels.
const sqlListMyGrantsGadmin = `
		SELECT n.id, n.workspace_id, n.parent_id,
		       n.name, n.label_override, n.colour, n.icon,
		       n.created_at, n.sort_order
		  FROM topology_nodes n
		 WHERE n.subscription_id = $1
		   AND n.archived_at IS NULL
		 ORDER BY n.sort_order, n.name
	`

// sqlListGrantsByUser is the admin-pivot read (PLA-0046, B6.8): gadmin
// enumerates a target user's active grants. Shape mirrors sqlListMyGrants.
const sqlListGrantsByUser = `
		SELECT r.users_roles_topology_nodes_id, r.users_roles_topology_nodes_id_topology_node, n.workspace_id, n.parent_id,
		       n.name, n.label_override, n.colour, n.icon,
		       r.users_roles_topology_nodes_role_code, r.users_roles_topology_nodes_granted_at, n.sort_order
		  FROM users_roles_topology_nodes r
		  JOIN topology_nodes n ON n.id = r.users_roles_topology_nodes_id_topology_node
		 WHERE r.users_roles_topology_nodes_id_subscription = $1
		   AND r.users_roles_topology_nodes_id_user = $2
		   AND r.users_roles_topology_nodes_revoked_at IS NULL
		   AND n.archived_at IS NULL
		 ORDER BY n.sort_order, n.name
	`

// sqlClampPredicate is the PLA-0043 scope clamp: the union of the live
// subtrees rooted at every active grant the user holds in this
// subscription. Empty result = "no Topology access".
const sqlClampPredicate = `
		WITH RECURSIVE grants AS (
		    SELECT n.id
		      FROM users_roles_topology_nodes r
		      JOIN topology_nodes n ON n.id = r.users_roles_topology_nodes_id_topology_node
		     WHERE r.users_roles_topology_nodes_id_subscription = $1
		       AND r.users_roles_topology_nodes_id_user = $2
		       AND r.users_roles_topology_nodes_revoked_at IS NULL
		       AND n.archived_at IS NULL
		), reachable AS (
		    SELECT id FROM grants
		    UNION
		    SELECT c.id
		      FROM topology_nodes c
		      JOIN reachable ON c.parent_id = reachable.id
		     WHERE c.subscription_id = $1 AND c.archived_at IS NULL
		)
		SELECT id FROM reachable
	`

// ── dev-reset purge (used only by PurgeTenantTopologyData / SeedRootNode) ───

const sqlPurgeTenantRoleGrants = `DELETE FROM users_roles_topology_nodes WHERE users_roles_topology_nodes_id_subscription = $1`

const sqlPurgeTenantViewStates = `DELETE FROM topology_view_states WHERE topology_view_states_id_subscription = $1`

const sqlDetachTenantNodeParents = `UPDATE topology_nodes SET parent_id = NULL WHERE subscription_id = $1`

const sqlPurgeTenantNodes = `DELETE FROM topology_nodes WHERE subscription_id = $1`

const sqlInsertRootNode = `
		INSERT INTO topology_nodes (
			id, workspace_id, subscription_id, parent_id,
			name, description, layout_mode, collapsed_default, sort_order
		) VALUES (
			gen_random_uuid(), $1, $2, NULL,
			$3, '', 'auto-horizontal', FALSE, 0
		)
	`

// sqlLoadNodeForUpdate is the SELECT … FOR UPDATE helper used by every
// write path in service.go. Returns the full Node hydration column set.
const sqlLoadNodeForUpdate = `
		SELECT id, workspace_id, subscription_id, parent_id, name, description, label_override,
		       icon, colour, avatar_url,
		       layout_mode, x, y,
		       collapsed_default, sort_order, archived_at, created_at, updated_at
		  FROM topology_nodes
		 WHERE id = $1
		 FOR UPDATE
	`

// sqlLoadNodeReadOnly is the lock-free sibling used by read paths
// (CanReadScope on the artefacts query). Same column projection so
// the Scan(...) call site is shared with loadNode. Tx must be opened
// ReadOnly (pgx.ReadOnly) otherwise the optimiser still doesn't
// touch row locks — but expressing intent is the point.
const sqlLoadNodeReadOnly = `
		SELECT id, workspace_id, subscription_id, parent_id, name, description, label_override,
		       icon, colour, avatar_url,
		       layout_mode, x, y,
		       collapsed_default, sort_order, archived_at, created_at, updated_at
		  FROM topology_nodes
		 WHERE id = $1
	`
