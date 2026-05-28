package savedviews

// All SQL for the savedviews package lives here as named constants.
// Per the project convention (RF1.2): no raw SQL in service.go /
// handler.go / store.go.

const (
	// ── Reads ────────────────────────────────────────────────────────

	// sqlSelectViewByID — fetch one view by ID, tenant-clamped.
	sqlSelectViewByID = `
		SELECT
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at
		FROM saved_views
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id = $2
		  AND saved_views_archived_at IS NULL`

	// sqlListVisibleByUser — user-scope rows for (sub, user, kind, target).
	sqlListVisibleByUser = `
		SELECT
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at
		FROM saved_views
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id_user = $2
		  AND saved_views_kind = $3
		  AND saved_views_target = $4
		  AND saved_views_scope = 'user'
		  AND saved_views_archived_at IS NULL
		ORDER BY saved_views_name ASC`

	// sqlListVisibleByNode — node-scope rows for (sub, ANY(node_ids), kind, target).
	sqlListVisibleByNode = `
		SELECT
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at
		FROM saved_views
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id_node = ANY($2)
		  AND saved_views_kind = $3
		  AND saved_views_target = $4
		  AND saved_views_scope = 'node'
		  AND saved_views_archived_at IS NULL
		ORDER BY saved_views_name ASC`

	// sqlListVisibleByWorkspace — workspace-scope rows.
	sqlListVisibleByWorkspace = `
		SELECT
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at
		FROM saved_views
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id_workspace = $2
		  AND saved_views_kind = $3
		  AND saved_views_target = $4
		  AND saved_views_scope = 'workspace'
		  AND saved_views_archived_at IS NULL
		ORDER BY saved_views_name ASC`

	// ── Writes ───────────────────────────────────────────────────────

	sqlInsertView = `
		INSERT INTO saved_views (
			saved_views_id_subscription, saved_views_kind, saved_views_scope,
			saved_views_id_user, saved_views_id_node, saved_views_id_workspace,
			saved_views_target, saved_views_name, saved_views_body,
			saved_views_id_user_created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at`

	// sqlUpdateBody — patch name AND/OR body. NULL args leave that
	// column untouched (COALESCE pattern).
	sqlUpdateBody = `
		UPDATE saved_views
		SET saved_views_name = COALESCE($3, saved_views_name),
		    saved_views_body = COALESCE($4, saved_views_body)
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id = $2
		  AND saved_views_archived_at IS NULL
		RETURNING
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at`

	// sqlUpdateScope — promote/demote. Clears the two non-target scope
	// IDs to NULL; the CHECK constraint enforces exactly-one populated.
	sqlUpdateScope = `
		UPDATE saved_views
		SET saved_views_scope        = $3,
		    saved_views_id_user      = $4,
		    saved_views_id_node      = $5,
		    saved_views_id_workspace = $6
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id = $2
		  AND saved_views_archived_at IS NULL
		RETURNING
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at`

	sqlArchiveView = `
		UPDATE saved_views
		SET saved_views_archived_at = now()
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id = $2
		  AND saved_views_archived_at IS NULL`

	// ── Tenant-integrity probes (used by Service before writes) ──────

	// sqlVerifyUserInSubscription — confirms a user belongs to the
	// subscription. Used on scope='user' write paths.
	sqlVerifyUserInSubscription = `
		SELECT 1 FROM users
		WHERE users_id = $1
		  AND users_id_subscription = $2
		  AND users_archived_at IS NULL
		LIMIT 1`

	// sqlVerifyNodeInSubscription — confirms a topology node belongs
	// to the subscription. The node's workspace must live in the sub.
	sqlVerifyNodeInSubscription = `
		SELECT 1
		FROM topology_nodes tn
		JOIN master_record_workspaces mrw
		  ON mrw.master_record_workspaces_id = tn.topology_nodes_id_workspace
		WHERE tn.topology_nodes_id = $1
		  AND mrw.master_record_workspaces_id_subscription = $2
		  AND tn.topology_nodes_archived_at IS NULL
		LIMIT 1`

	// sqlVerifyWorkspaceInSubscription — confirms a workspace belongs
	// to the subscription.
	sqlVerifyWorkspaceInSubscription = `
		SELECT 1 FROM master_record_workspaces
		WHERE master_record_workspaces_id = $1
		  AND master_record_workspaces_id_subscription = $2
		  AND master_record_workspaces_archived_at IS NULL
		LIMIT 1`

	// sqlVerifyNodeMembership — confirms a user is a member of a
	// topology node. Used by the Service for node-scope write/edit
	// permission gating (Rally pattern: any node member may create
	// and edit node-scope views).
	sqlVerifyNodeMembership = `
		SELECT 1 FROM topology_nodes_members
		WHERE topology_nodes_members_user_id = $1
		  AND topology_nodes_members_node_id = $2
		LIMIT 1`
)
