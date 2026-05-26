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

// ── commands.go ─────────────────────────────────────────────────────────────

// sqlSetNodeParentNull detaches a node from its parent (makes it a root).
// Used by Disconnect for the special "single root" early-exit case.
const sqlSetNodeParentNull = `UPDATE topology_nodes SET topology_nodes_id_parent = NULL WHERE topology_nodes_id = $1`

// sqlPatchNodeTemplate is the sparse-update shell used by PatchNode.
// First %s holds the comma-separated `col = $N` SET clause built from the
// supplied non-nil PatchNodeInput fields; second %s holds the `$M` placeholder
// for the WHERE id bind. Callers do fmt.Sprintf to combine.
const sqlPatchNodeTemplate = `UPDATE topology_nodes SET %s WHERE topology_nodes_id = %s`

// sqlListDisconnectedRootsTemplate returns every live node whose
// parent_id IS NULL, excluding the canonical (lowest-sort_order) root.
// Two %s placeholders for the workspace clamp: one inside the roots CTE
// (clamped against the bare table), one for the outer SELECT (clamped
// against alias `n`). See workspaceClause / workspaceClauseAt in
// sql_helpers.go.
const sqlListDisconnectedRootsTemplate = `
		WITH roots AS (
		    SELECT topology_nodes_id, topology_nodes_sort_order,
		           ROW_NUMBER() OVER (ORDER BY topology_nodes_sort_order, topology_nodes_created_at) AS rn
		      FROM topology_nodes
		     WHERE topology_nodes_id_subscription = $1
		       AND topology_nodes_id_parent IS NULL
		       AND topology_nodes_archived_at IS NULL%s
		)
		SELECT n.topology_nodes_id, n.topology_nodes_id_workspace, n.topology_nodes_id_subscription, n.topology_nodes_id_parent, n.topology_nodes_name, n.topology_nodes_description, n.topology_nodes_label_override,
		       n.topology_nodes_icon, n.topology_nodes_colour, n.topology_nodes_avatar_url,
		       n.topology_nodes_layout_mode, n.topology_nodes_x, n.topology_nodes_y,
		       n.topology_nodes_collapsed_default, n.topology_nodes_sort_order, n.topology_nodes_archived_at, n.topology_nodes_created_at, n.topology_nodes_updated_at
		  FROM topology_nodes n
		  JOIN roots r ON r.topology_nodes_id = n.topology_nodes_id
		 WHERE r.rn > 1%s
		 ORDER BY n.topology_nodes_sort_order, n.topology_nodes_created_at
	`

// sqlSelectCommitStatus reads the current commit checkpoint row from
// topology_commits. Used by GetCommitStatus.
//
// RF1.5.2 — column prefixes applied to topology_commits (migration 097).
const sqlSelectCommitStatus = `
		SELECT topology_commits_committed_at, topology_commits_id_user_committed_by
		  FROM topology_commits
		 WHERE topology_commits_id_subscription = $1
	`

// sqlSelectMaxNodeUpdatedAt computes MAX(updated_at) across live
// topology_nodes for a subscription — the "dirty since commit" probe.
const sqlSelectMaxNodeUpdatedAt = `
		SELECT MAX(topology_nodes_updated_at) FROM topology_nodes WHERE topology_nodes_id_subscription = $1
	`

// sqlUpsertCommit stamps the working-model commit checkpoint. Single
// row per subscription; ON CONFLICT bumps committed_at/_by and the
// updated_at bookkeeping column.
//
// RF1.5.2 — column prefixes applied to topology_commits (migration 097).
const sqlUpsertCommit = `
		INSERT INTO topology_commits (
			topology_commits_id_subscription,
			topology_commits_committed_at,
			topology_commits_id_user_committed_by
		)
		VALUES ($1, NOW(), $2)
		ON CONFLICT (topology_commits_id_subscription) DO UPDATE
		   SET topology_commits_committed_at         = EXCLUDED.topology_commits_committed_at,
		       topology_commits_id_user_committed_by = EXCLUDED.topology_commits_id_user_committed_by,
		       topology_commits_updated_at           = NOW()
	`

// sqlArchiveAllLiveNodes archives every live topology_nodes row in a
// subscription. Used by ResetCanvas — story 00310.
const sqlArchiveAllLiveNodes = `
		UPDATE topology_nodes
		   SET topology_nodes_archived_at = NOW()
		 WHERE topology_nodes_id_subscription = $1
		   AND topology_nodes_archived_at IS NULL
	`

// sqlRenameWorkspaceRootNode renames the root topology node of a single
// workspace ($2). Only touches the root (parent_id IS NULL) — child node
// names are independent. Called from workspaces.Service.Rename via the
// TopologySeeder interface so the writer-boundary lint stays green.
// $1 = newName, $2 = workspaceID.
const sqlRenameWorkspaceRootNode = `
		UPDATE topology_nodes
		   SET topology_nodes_name = $1
		 WHERE topology_nodes_id_workspace = $2
		   AND topology_nodes_id_parent IS NULL
		   AND topology_nodes_archived_at IS NULL
	`

// sqlArchiveWorkspaceTopology archives every live topology_nodes row
// belonging to a workspace so grants/me stops returning them after the
// workspace itself is archived. Called from workspaces.Service.Archive
// via TopologySeeder. $1 = workspaceID.
const sqlArchiveWorkspaceTopology = `
		UPDATE topology_nodes
		   SET topology_nodes_archived_at = NOW()
		 WHERE topology_nodes_id_workspace = $1
		   AND topology_nodes_archived_at IS NULL
	`

// sqlRestoreWorkspaceTopology unarchives every topology_nodes row for
// a workspace on workspace restore so the nodes re-appear in grants/me.
// Mirror inverse of sqlArchiveWorkspaceTopology. $1 = workspaceID.
const sqlRestoreWorkspaceTopology = `
		UPDATE topology_nodes
		   SET topology_nodes_archived_at = NULL
		 WHERE topology_nodes_id_workspace = $1
	`

// ── middleware.go ───────────────────────────────────────────────────────────

// sqlSelectTenantRootID resolves the canonical root topology_node for a
// subscription (the live parent_id IS NULL row with the lowest
// sort_order). Used by ClampMiddleware when it needs the absolute
// tenant root (no workspace clamp).
const sqlSelectTenantRootID = `
		SELECT topology_nodes_id FROM topology_nodes
		 WHERE topology_nodes_id_subscription = $1
		   AND topology_nodes_id_parent IS NULL
		   AND topology_nodes_archived_at IS NULL
		 ORDER BY topology_nodes_sort_order
		 LIMIT 1
	`

// sqlSelectTenantRootIDWorkspaceClampedTemplate is the workspace-clamped
// version of sqlSelectTenantRootID. The %s placeholder is filled by
// workspaceClause(...) which appends an `AND topology_nodes_id_workspace = $N` fragment
// (or the empty string when no clamp is active).
const sqlSelectTenantRootIDWorkspaceClampedTemplate = `
		SELECT topology_nodes_id FROM topology_nodes
		 WHERE topology_nodes_id_subscription = $1
		   AND topology_nodes_id_parent IS NULL
		   AND topology_nodes_archived_at IS NULL%s
		 ORDER BY topology_nodes_sort_order
		 LIMIT 1
	`

// sqlSelectFirstLiveWorkspaceID returns the earliest-created live
// workspace for a subscription. Used as the fallback when no ?ws=
// query param is provided.
const sqlSelectFirstLiveWorkspaceID = `
		SELECT master_record_workspaces_id FROM master_record_workspaces
		 WHERE master_record_workspaces_id_subscription = $1
		   AND master_record_workspaces_archived_at IS NULL
		 ORDER BY master_record_workspaces_created_at ASC
		 LIMIT 1
	`

// sqlSelectWorkspaceIDBySlug resolves a workspace by (subscription, slug).
const sqlSelectWorkspaceIDBySlug = `
		SELECT master_record_workspaces_id FROM master_record_workspaces
		 WHERE master_record_workspaces_id_subscription = $1
		   AND master_record_workspaces_slug            = $2
		   AND master_record_workspaces_archived_at IS NULL
		 LIMIT 1
	`

// sqlSelectWorkspaceIDByIDAndSubscription resolves a workspace by
// (id, subscription) — the UUID branch of ResolveRef.
const sqlSelectWorkspaceIDByIDAndSubscription = `
			SELECT master_record_workspaces_id FROM master_record_workspaces
			 WHERE master_record_workspaces_id              = $1
			   AND master_record_workspaces_id_subscription = $2
			   AND master_record_workspaces_archived_at IS NULL
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
			    SELECT topology_nodes_id, topology_nodes_id_parent FROM topology_nodes WHERE topology_nodes_id = $1 AND topology_nodes_id_subscription = $3
			    UNION ALL
			    SELECT n.topology_nodes_id, n.topology_nodes_id_parent
			      FROM topology_nodes n
			      JOIN up ON up.topology_nodes_id_parent = n.topology_nodes_id
			     WHERE n.topology_nodes_id_subscription = $3
			)
			SELECT EXISTS(SELECT 1 FROM up WHERE topology_nodes_id = $2)
		`

// ── service.go ──────────────────────────────────────────────────────────────

// sqlDeleteNodesForTestBySubscription is the cleanup counterpart to
// sqlInsertNodeForTest — deletes every topology_nodes row for one
// subscription. Used only by integration test cleanup hooks; production
// code archives via Service.ArchiveNode (soft delete, audit-trailed).
const sqlDeleteNodesForTestBySubscription = `DELETE FROM topology_nodes WHERE topology_nodes_id_subscription = $1`

// sqlInsertNodeForTest is the test-fixture writer used by SeedNodeForTest.
// Unlike sqlInsertNode it accepts a caller-supplied id so test code can
// generate deterministic UUIDs up front. Production code path (CreateNode)
// uses sqlInsertNode which DEFAULTs the id via gen_random_uuid().
//
// Kept inside the topology package to honour the write-boundary
// (boundary_test.go ratchets that topology is the sole writer of
// topology_nodes). PLA060 follow-up — fixes TestPackageBoundary fail
// surfaced by timeboxsprints/ancestor_walk_test.go's raw INSERT.
const sqlInsertNodeForTest = `
		INSERT INTO topology_nodes (
		    topology_nodes_id,
		    topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_id_parent, topology_nodes_name, topology_nodes_description,
		    topology_nodes_layout_mode, topology_nodes_collapsed_default, topology_nodes_sort_order
		) VALUES (
		    $1, $2, $3, $4, $5, '',
		    'auto-horizontal', false, 0
		)
	`

// sqlInsertNode inserts a new topology_nodes row and returns the full
// row for hydrating a Node. Used by CreateNode.
const sqlInsertNode = `
		INSERT INTO topology_nodes (
		    topology_nodes_id,
		    topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_id_parent, topology_nodes_name, topology_nodes_description, topology_nodes_label_override,
		    topology_nodes_icon, topology_nodes_colour, topology_nodes_avatar_url,
		    topology_nodes_layout_mode, topology_nodes_x, topology_nodes_y,
		    topology_nodes_collapsed_default, topology_nodes_sort_order
		) VALUES (
		    gen_random_uuid(),
		    $1, $2, $3, $4, $5, $6,
		    $7, $8, $9,
		    $10, $11, $12,
		    $13, $14
		)
		RETURNING
		    topology_nodes_id, topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_id_parent, topology_nodes_name, topology_nodes_description, topology_nodes_label_override,
		    topology_nodes_icon, topology_nodes_colour, topology_nodes_avatar_url,
		    topology_nodes_layout_mode, topology_nodes_x, topology_nodes_y,
		    topology_nodes_collapsed_default, topology_nodes_sort_order, topology_nodes_archived_at, topology_nodes_created_at, topology_nodes_updated_at
	`

// sqlRenameNode updates topology_nodes.name. Subscription scope is
// enforced by the loadNode FOR UPDATE check in the caller.
const sqlRenameNode = `UPDATE topology_nodes SET topology_nodes_name = $1 WHERE topology_nodes_id = $2`

// sqlCycleCheckMoveAncestor walks UP from $1 (the prospective new parent)
// and returns whether $2 (the moving node) appears among its ancestors —
// i.e. moving $2 under $1 would create a cycle. No subscription guard:
// loadNode in MoveNode already established both rows live inside the
// caller's subscription.
const sqlCycleCheckMoveAncestor = `
			WITH RECURSIVE up AS (
			    SELECT topology_nodes_id, topology_nodes_id_parent FROM topology_nodes WHERE topology_nodes_id = $1
			    UNION ALL
			    SELECT n.topology_nodes_id, n.topology_nodes_id_parent
			      FROM topology_nodes n
			      JOIN up ON up.topology_nodes_id_parent = n.topology_nodes_id
			)
			SELECT EXISTS(SELECT 1 FROM up WHERE topology_nodes_id = $2)
		`

// sqlMoveNode reparents a node. topology_nodes_id_parent may be NULL (move to root).
const sqlMoveNode = `UPDATE topology_nodes SET topology_nodes_id_parent = $1 WHERE topology_nodes_id = $2`

// sqlArchiveNode stamps topology_nodes_archived_at = NOW() on a live node. Idempotent:
// the WHERE clause makes a re-archive a no-op.
const sqlArchiveNode = `
		UPDATE topology_nodes SET topology_nodes_archived_at = NOW()
		 WHERE topology_nodes_id = $1 AND topology_nodes_archived_at IS NULL
	`

// sqlBulkPositionUpdate applies a (sort_order, layout_mode, x, y) update
// for a single node — the per-row exec inside BulkPosition's tx.
const sqlBulkPositionUpdate = `
		UPDATE topology_nodes
		   SET topology_nodes_sort_order = $1, topology_nodes_layout_mode = $2, topology_nodes_x = $3, topology_nodes_y = $4
		 WHERE topology_nodes_id = $5
	`

// sqlShiftRootSiblingsUp opens a slot for a duplicate root by shifting
// all later root siblings (topology_nodes_id_parent IS NULL) up by 1.
const sqlShiftRootSiblingsUp = `
		UPDATE topology_nodes
		   SET topology_nodes_sort_order = topology_nodes_sort_order + 1
		 WHERE topology_nodes_id_subscription = $1
		   AND topology_nodes_id_parent IS NULL
		   AND topology_nodes_archived_at IS NULL
		   AND topology_nodes_sort_order > $2
	`

// sqlShiftChildSiblingsUp opens a slot for a duplicate child by shifting
// all later siblings under the same parent up by 1.
const sqlShiftChildSiblingsUp = `
		UPDATE topology_nodes
		   SET topology_nodes_sort_order = topology_nodes_sort_order + 1
		 WHERE topology_nodes_id_subscription = $1
		   AND topology_nodes_id_parent = $2
		   AND topology_nodes_archived_at IS NULL
		   AND topology_nodes_sort_order > $3
	`

// sqlWalkSubtreeForClone walks a live subtree depth-first via a recursive
// CTE, ordered so every parent appears before its children. Used by
// DuplicateSubtree to enumerate rows to clone.
const sqlWalkSubtreeForClone = `
		WITH RECURSIVE down AS (
		    SELECT n.*, ARRAY[n.topology_nodes_sort_order]::INT[] AS path
		      FROM topology_nodes n
		     WHERE n.topology_nodes_id = $1 AND n.topology_nodes_id_subscription = $2 AND n.topology_nodes_archived_at IS NULL
		    UNION ALL
		    SELECT c.*, down.path || c.topology_nodes_sort_order
		      FROM topology_nodes c
		      JOIN down ON c.topology_nodes_id_parent = down.topology_nodes_id
		     WHERE c.topology_nodes_id_subscription = $2 AND c.topology_nodes_archived_at IS NULL
		)
		SELECT topology_nodes_id, topology_nodes_id_workspace, topology_nodes_id_parent, topology_nodes_name, topology_nodes_description, topology_nodes_label_override,
		       topology_nodes_icon, topology_nodes_colour, topology_nodes_avatar_url,
		       topology_nodes_layout_mode, topology_nodes_x, topology_nodes_y,
		       topology_nodes_collapsed_default, topology_nodes_sort_order
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
		    SELECT n.*, ARRAY[n.topology_nodes_sort_order, 0]::INT[] AS path
		      FROM topology_nodes n
		     WHERE n.topology_nodes_id = $1 AND n.topology_nodes_id_subscription = $2 AND n.topology_nodes_archived_at IS NULL%s
		    UNION ALL
		    SELECT c.*, down.path || c.topology_nodes_sort_order
		      FROM topology_nodes c
		      JOIN down ON c.topology_nodes_id_parent = down.topology_nodes_id
		     WHERE c.topology_nodes_id_subscription = $2 AND c.topology_nodes_archived_at IS NULL%s
		), archived_children AS (
		    SELECT a.topology_nodes_id AS arch_id, d.topology_nodes_id AS anchor_id
		      FROM topology_nodes a
		      JOIN down d ON a.topology_nodes_id_parent = d.topology_nodes_id
		     WHERE a.topology_nodes_id_subscription = $2
		       AND a.topology_nodes_archived_at IS NOT NULL%s
		), archived_subtree AS (
		    SELECT arch_id, anchor_id FROM archived_children
		    UNION ALL
		    SELECT c.topology_nodes_id, ast.anchor_id
		      FROM topology_nodes c
		      JOIN archived_subtree ast ON c.topology_nodes_id_parent = ast.arch_id
		     WHERE c.topology_nodes_id_subscription = $2
		       AND c.topology_nodes_archived_at IS NOT NULL%s
		), per_anchor AS (
		    SELECT anchor_id, COUNT(*)::INT AS arch_count
		      FROM archived_subtree
		     GROUP BY anchor_id
		), live_path AS (
		    SELECT d.topology_nodes_id AS live_id, d.topology_nodes_id AS anchor_id
		      FROM down d
		    UNION ALL
		    SELECT lp.live_id, c.topology_nodes_id
		      FROM live_path lp
		      JOIN down c ON c.topology_nodes_id_parent = lp.anchor_id
		), rollup AS (
		    SELECT lp.live_id, COALESCE(SUM(pa.arch_count), 0)::INT AS arch_total
		      FROM live_path lp
		      LEFT JOIN per_anchor pa ON pa.anchor_id = lp.anchor_id
		     GROUP BY lp.live_id
		)
		SELECT d.topology_nodes_id, d.topology_nodes_id_workspace, d.topology_nodes_id_subscription, d.topology_nodes_id_parent, d.topology_nodes_name, d.topology_nodes_description, d.topology_nodes_label_override,
		       d.topology_nodes_icon, d.topology_nodes_colour, d.topology_nodes_avatar_url,
		       d.topology_nodes_layout_mode, d.topology_nodes_x, d.topology_nodes_y,
		       d.topology_nodes_collapsed_default, d.topology_nodes_sort_order, d.topology_nodes_archived_at, d.topology_nodes_created_at, d.topology_nodes_updated_at,
		       COALESCE(r.arch_total, 0) AS archived_descendant_count
		  FROM down d
		  LEFT JOIN rollup r ON r.live_id = d.topology_nodes_id
		 ORDER BY d.path
	`

// sqlAncestorsOf walks UP from a node and returns the chain root → node.
const sqlAncestorsOf = `
		WITH RECURSIVE up AS (
		    SELECT n.*, 0 AS depth
		      FROM topology_nodes n
		     WHERE n.topology_nodes_id = $1 AND n.topology_nodes_id_subscription = $2
		    UNION ALL
		    SELECT p.*, up.depth + 1
		      FROM topology_nodes p
		      JOIN up ON up.topology_nodes_id_parent = p.topology_nodes_id
		     WHERE p.topology_nodes_id_subscription = $2
		)
		SELECT topology_nodes_id, topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_id_parent, topology_nodes_name, topology_nodes_description, topology_nodes_label_override,
		       topology_nodes_icon, topology_nodes_colour, topology_nodes_avatar_url,
		       topology_nodes_layout_mode, topology_nodes_x, topology_nodes_y,
		       topology_nodes_collapsed_default, topology_nodes_sort_order, topology_nodes_archived_at, topology_nodes_created_at, topology_nodes_updated_at
		  FROM up
		 ORDER BY depth DESC
	`

// sqlArchivedDescendantsTemplate walks DOWN from a live anchor, enters
// every archived child branch, and recurses through transitively-archived
// descendants. Three %s placeholders for workspace clamps (n / c / a).
const sqlArchivedDescendantsTemplate = `
		WITH RECURSIVE live_down AS (
		    SELECT n.topology_nodes_id
		      FROM topology_nodes n
		     WHERE n.topology_nodes_id = $1
		       AND n.topology_nodes_id_subscription = $2
		       AND n.topology_nodes_archived_at IS NULL%s
		    UNION ALL
		    SELECT c.topology_nodes_id
		      FROM topology_nodes c
		      JOIN live_down ld ON c.topology_nodes_id_parent = ld.topology_nodes_id
		     WHERE c.topology_nodes_id_subscription = $2
		       AND c.topology_nodes_archived_at IS NULL%s
		), arch AS (
		    SELECT a.topology_nodes_id, a.topology_nodes_id_parent, a.topology_nodes_name, a.topology_nodes_archived_at
		      FROM topology_nodes a
		      JOIN live_down ld ON a.topology_nodes_id_parent = ld.topology_nodes_id
		     WHERE a.topology_nodes_id_subscription = $2
		       AND a.topology_nodes_archived_at IS NOT NULL%s
		    UNION ALL
		    SELECT c.topology_nodes_id, c.topology_nodes_id_parent, c.topology_nodes_name, c.topology_nodes_archived_at
		      FROM topology_nodes c
		      JOIN arch ON c.topology_nodes_id_parent = arch.topology_nodes_id
		     WHERE c.topology_nodes_id_subscription = $2
		       AND c.topology_nodes_archived_at IS NOT NULL%s
		)
		SELECT a.topology_nodes_id, a.topology_nodes_id_parent, a.topology_nodes_name, a.topology_nodes_archived_at,
		       (p.topology_nodes_archived_at IS NOT NULL) AS parent_is_archived
		  FROM arch a
		  LEFT JOIN topology_nodes p ON p.topology_nodes_id = a.topology_nodes_id_parent
		 ORDER BY a.topology_nodes_archived_at DESC, a.topology_nodes_name
	`

// sqlDescendantNodeIDsTemplate returns rootNodeID plus every live
// descendant's ID. Two %s placeholders for workspace clamps (n / c).
const sqlDescendantNodeIDsTemplate = `
		WITH RECURSIVE live_down AS (
		    SELECT n.topology_nodes_id
		      FROM topology_nodes n
		     WHERE n.topology_nodes_id = $1
		       AND n.topology_nodes_id_subscription = $2
		       AND n.topology_nodes_archived_at IS NULL%s
		    UNION ALL
		    SELECT c.topology_nodes_id
		      FROM topology_nodes c
		      JOIN live_down ld ON c.topology_nodes_id_parent = ld.topology_nodes_id
		     WHERE c.topology_nodes_id_subscription = $2
		       AND c.topology_nodes_archived_at IS NULL%s
		)
		SELECT topology_nodes_id FROM live_down
	`

// sqlAncestorNodeIDs returns rootNodeID plus every live ancestor up to the
// subscription root (strict chain — no siblings). $1 = rootNodeID,
// $2 = subscriptionID. Archived nodes are excluded at all levels so
// a scope clamp built from this set never reaches dead branches.
// Used by the "ascend" direction of the PLA-0043 scope clamp.
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
		      JOIN live_up lu ON p.topology_nodes_id = lu.topology_nodes_id_parent
		     WHERE p.topology_nodes_id_subscription = $2
		       AND p.topology_nodes_archived_at IS NULL
		)
		SELECT topology_nodes_id FROM live_up
	`

// sqlSelectParentForRestoreByID probes a candidate landing parent (by ID
// alone) so RestoreNode can validate it before reparenting.
const sqlSelectParentForRestoreByID = `
		SELECT topology_nodes_id_subscription, topology_nodes_archived_at FROM topology_nodes WHERE topology_nodes_id = $1
	`

// sqlSelectParentForRestoreInTenant probes the node's current parent
// inside the caller's subscription so RestoreNode can decide whether
// "keep current parent" is safe.
const sqlSelectParentForRestoreInTenant = `
		SELECT topology_nodes_archived_at FROM topology_nodes WHERE topology_nodes_id = $1 AND topology_nodes_id_subscription = $2
	`

// sqlRestoreNode clears archived_at and stamps parent_id + updated_at on
// a single node. Pair-or-null landing parent semantics enforced by the
// caller.
const sqlRestoreNode = `
		UPDATE topology_nodes
		   SET topology_nodes_archived_at = NULL,
		       topology_nodes_id_parent   = $2,
		       topology_nodes_updated_at  = NOW()
		 WHERE topology_nodes_id = $1
	`

// sqlListMyGrants is the self-pivot grant list for the scope picker.
// Joins active grants to live nodes for the (subscription, user) pair.
const sqlListMyGrants = `
		SELECT r.users_roles_topology_nodes_id, r.users_roles_topology_nodes_id_topology_node, n.topology_nodes_id_workspace, n.topology_nodes_id_parent,
		       n.topology_nodes_name, n.topology_nodes_label_override, n.topology_nodes_colour, n.topology_nodes_icon,
		       r.users_roles_topology_nodes_role_code, r.users_roles_topology_nodes_granted_at, n.topology_nodes_sort_order
		  FROM users_roles_topology_nodes r
		  JOIN topology_nodes n ON n.topology_nodes_id = r.users_roles_topology_nodes_id_topology_node
		 WHERE r.users_roles_topology_nodes_id_subscription = $1
		   AND r.users_roles_topology_nodes_id_user = $2
		   AND r.users_roles_topology_nodes_revoked_at IS NULL
		   AND n.topology_nodes_archived_at IS NULL
		 ORDER BY n.topology_nodes_sort_order, n.topology_nodes_name
	`

// sqlListMyGrantsGadmin synthesises an admin grant on every live node in the
// subscription. The scope picker's buildTree reconstructs the hierarchy from
// topology_nodes_id_parent so the user sees workspaces with their children nested beneath.
// Archived nodes are excluded at all levels.
const sqlListMyGrantsGadmin = `
		SELECT n.topology_nodes_id, n.topology_nodes_id_workspace, n.topology_nodes_id_parent,
		       n.topology_nodes_name, n.topology_nodes_label_override, n.topology_nodes_colour, n.topology_nodes_icon,
		       n.topology_nodes_created_at, n.topology_nodes_sort_order
		  FROM topology_nodes n
		 WHERE n.topology_nodes_id_subscription = $1
		   AND n.topology_nodes_archived_at IS NULL
		 ORDER BY n.topology_nodes_sort_order, n.topology_nodes_name
	`

// sqlListGrantsByUser is the admin-pivot read (PLA-0046, B6.8): gadmin
// enumerates a target user's active grants. Shape mirrors sqlListMyGrants.
const sqlListGrantsByUser = `
		SELECT r.users_roles_topology_nodes_id, r.users_roles_topology_nodes_id_topology_node, n.topology_nodes_id_workspace, n.topology_nodes_id_parent,
		       n.topology_nodes_name, n.topology_nodes_label_override, n.topology_nodes_colour, n.topology_nodes_icon,
		       r.users_roles_topology_nodes_role_code, r.users_roles_topology_nodes_granted_at, n.topology_nodes_sort_order
		  FROM users_roles_topology_nodes r
		  JOIN topology_nodes n ON n.topology_nodes_id = r.users_roles_topology_nodes_id_topology_node
		 WHERE r.users_roles_topology_nodes_id_subscription = $1
		   AND r.users_roles_topology_nodes_id_user = $2
		   AND r.users_roles_topology_nodes_revoked_at IS NULL
		   AND n.topology_nodes_archived_at IS NULL
		 ORDER BY n.topology_nodes_sort_order, n.topology_nodes_name
	`

// sqlClampPredicate is the PLA-0043 scope clamp: the union of the live
// subtrees rooted at every active grant the user holds in this
// subscription. Empty result = "no Topology access".
const sqlClampPredicate = `
		WITH RECURSIVE grants AS (
		    SELECT n.topology_nodes_id
		      FROM users_roles_topology_nodes r
		      JOIN topology_nodes n ON n.topology_nodes_id = r.users_roles_topology_nodes_id_topology_node
		     WHERE r.users_roles_topology_nodes_id_subscription = $1
		       AND r.users_roles_topology_nodes_id_user = $2
		       AND r.users_roles_topology_nodes_revoked_at IS NULL
		       AND n.topology_nodes_archived_at IS NULL
		), reachable AS (
		    SELECT topology_nodes_id FROM grants
		    UNION
		    SELECT c.topology_nodes_id
		      FROM topology_nodes c
		      JOIN reachable ON c.topology_nodes_id_parent = reachable.topology_nodes_id
		     WHERE c.topology_nodes_id_subscription = $1 AND c.topology_nodes_archived_at IS NULL
		)
		SELECT topology_nodes_id FROM reachable
	`

// ── dev-reset purge (used only by PurgeTenantTopologyData / SeedRootNode) ───

const sqlPurgeTenantRoleGrants = `DELETE FROM users_roles_topology_nodes WHERE users_roles_topology_nodes_id_subscription = $1`

const sqlPurgeTenantViewStates = `DELETE FROM topology_view_states WHERE topology_view_states_id_subscription = $1`

const sqlDetachTenantNodeParents = `UPDATE topology_nodes SET topology_nodes_id_parent = NULL WHERE topology_nodes_id_subscription = $1`

const sqlPurgeTenantNodes = `DELETE FROM topology_nodes WHERE topology_nodes_id_subscription = $1`

const sqlInsertRootNode = `
		INSERT INTO topology_nodes (
			topology_nodes_id, topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_id_parent,
			topology_nodes_name, topology_nodes_description, topology_nodes_layout_mode, topology_nodes_collapsed_default, topology_nodes_sort_order
		) VALUES (
			gen_random_uuid(), $1, $2, NULL,
			$3, '', 'auto-horizontal', FALSE, 0
		)
	`

// sqlLoadNodeForUpdate is the SELECT … FOR UPDATE helper used by every
// write path in service.go. Returns the full Node hydration column set.
const sqlLoadNodeForUpdate = `
		SELECT topology_nodes_id, topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_id_parent, topology_nodes_name, topology_nodes_description, topology_nodes_label_override,
		       topology_nodes_icon, topology_nodes_colour, topology_nodes_avatar_url,
		       topology_nodes_layout_mode, topology_nodes_x, topology_nodes_y,
		       topology_nodes_collapsed_default, topology_nodes_sort_order, topology_nodes_archived_at, topology_nodes_created_at, topology_nodes_updated_at
		  FROM topology_nodes
		 WHERE topology_nodes_id = $1
		 FOR UPDATE
	`

// sqlLoadNodeReadOnly is the lock-free sibling used by read paths
// (CanReadScope on the artefacts query). Same column projection so
// the Scan(...) call site is shared with loadNode. Tx must be opened
// ReadOnly (pgx.ReadOnly) otherwise the optimiser still doesn't
// touch row locks — but expressing intent is the point.
const sqlLoadNodeReadOnly = `
		SELECT topology_nodes_id, topology_nodes_id_workspace, topology_nodes_id_subscription, topology_nodes_id_parent, topology_nodes_name, topology_nodes_description, topology_nodes_label_override,
		       topology_nodes_icon, topology_nodes_colour, topology_nodes_avatar_url,
		       topology_nodes_layout_mode, topology_nodes_x, topology_nodes_y,
		       topology_nodes_collapsed_default, topology_nodes_sort_order, topology_nodes_archived_at, topology_nodes_created_at, topology_nodes_updated_at
		  FROM topology_nodes
		 WHERE topology_nodes_id = $1
	`
