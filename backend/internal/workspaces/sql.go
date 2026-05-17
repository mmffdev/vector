// Package workspaces SQL constants.
//
// PLA-0048 / RF1.2.11. Sole writer for master_record_workspaces and
// users_roles_workspaces (mmff_vector); read-only over VAPool (vector_artefacts)
// via the cross-DB orphan scan in crossdb.go.
package workspaces

// ── commands.go: workspace CRUD ────────────────────────────────────────────

const sqlInsertWorkspace = `
		INSERT INTO master_record_workspaces (subscription_id, name, slug, description, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, subscription_id, name, slug, description,
		          created_by, created_at, updated_at, archived_at, archived_by
	`

// sqlInsertWorkspaceCreatorAdminGrant seeds the creator-as-admin
// users_roles_workspaces row so the clamp middleware lets them read it.
const sqlInsertWorkspaceCreatorAdminGrant = `
		INSERT INTO users_roles_workspaces (
			users_roles_workspaces_id_subscription,
			users_roles_workspaces_id_workspace,
			users_roles_workspaces_id_user,
			users_roles_workspaces_role,
			users_roles_workspaces_id_user_granted_by
		)
		VALUES ($1, $2, $3, 'admin', $3)
	`

const sqlRenameWorkspace = `UPDATE master_record_workspaces SET name = $1, updated_at = NOW() WHERE id = $2`

// sqlRenameTopologyRootNode syncs the root topology node name after a
// workspace rename. $1=newName, $2=workspaceID. Only touches the root
// (parent_id IS NULL); child nodes keep their own names.
const sqlRenameTopologyRootNode = `
		UPDATE topology_nodes
		SET    name = $1
		WHERE  workspace_id = $2
		  AND  parent_id IS NULL
		  AND  archived_at IS NULL
	`

const sqlCountLiveSiblingsExcluding = `
		SELECT COUNT(*)
		  FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND id <> $2
		   AND archived_at IS NULL
	`

const sqlArchiveWorkspace = `
		UPDATE master_record_workspaces
		   SET archived_at = NOW(),
		       archived_by = $1,
		       updated_at  = NOW()
		 WHERE id = $2
	`

// sqlArchiveTopologyNodes archives all live topology nodes for a workspace
// in vector_artefacts so they no longer appear in grants/me.
// $1=workspaceID. Non-fatal; called after the mmff_vector commit.
const sqlArchiveTopologyNodes = `
		UPDATE topology_nodes
		   SET archived_at = NOW()
		 WHERE workspace_id = $1
		   AND archived_at IS NULL
	`

// sqlRestoreTopologyNodes unarchives topology nodes on workspace restore.
const sqlRestoreTopologyNodes = `
		UPDATE topology_nodes
		   SET archived_at = NULL
		 WHERE workspace_id = $1
	`

// sqlExistsLiveSlugCollision is the slug-collision guard before restore.
const sqlExistsLiveSlugCollision = `
		SELECT EXISTS(
		    SELECT 1 FROM master_record_workspaces
		     WHERE subscription_id = $1
		       AND slug = $2
		       AND archived_at IS NULL
		)
	`

const sqlRestoreWorkspace = `
		UPDATE master_record_workspaces
		   SET archived_at = NULL,
		       archived_by = NULL,
		       updated_at  = NOW()
		 WHERE id = $1
	`

const sqlSelectWorkspaceByIDInTenant = `
		SELECT id, subscription_id, name, slug, description,
		       created_by, created_at, updated_at, archived_at, archived_by
		  FROM master_record_workspaces
		 WHERE id = $1 AND subscription_id = $2
	`

// sqlListWorkspacesTemplate is the dynamic list query. The %s holds
// the optional `AND archived_at IS NULL` clause (or empty string).
const sqlListWorkspacesTemplate = `
		SELECT id, subscription_id, name, slug, description,
		       created_by, created_at, updated_at, archived_at, archived_by
		  FROM master_record_workspaces
		 WHERE subscription_id = $1%s
		 ORDER BY created_at ASC
	`

// sqlLoadWorkspaceForUpdate is the SELECT … FOR UPDATE helper used by
// every write path. Tenant scope checked in Go after scan.
const sqlLoadWorkspaceForUpdate = `
		SELECT id, subscription_id, name, slug, description,
		       created_by, created_at, updated_at, archived_at, archived_by
		  FROM master_record_workspaces
		 WHERE id = $1
		 FOR UPDATE
	`

// ── users_roles.go: workspace_roles grant CRUD ───────────────────────────────────

const sqlSelectActiveGrantForUserOnWorkspace = `
		SELECT users_roles_workspaces_id
		  FROM users_roles_workspaces
		 WHERE users_roles_workspaces_id_workspace = $1
		   AND users_roles_workspaces_id_user      = $2
		   AND users_roles_workspaces_revoked_at IS NULL
		 LIMIT 1
	`

const sqlExistsActiveAdminGrantOnWorkspace = `
		SELECT EXISTS(
		    SELECT 1 FROM users_roles_workspaces
		     WHERE users_roles_workspaces_id_workspace = $1
		       AND users_roles_workspaces_role         = 'admin'
		       AND users_roles_workspaces_revoked_at IS NULL
		)
	`

const sqlInsertWorkspaceRoleGrant = `
		INSERT INTO users_roles_workspaces (
			users_roles_workspaces_id_subscription,
			users_roles_workspaces_id_workspace,
			users_roles_workspaces_id_user,
			users_roles_workspaces_role,
			users_roles_workspaces_can_redelegate,
			users_roles_workspaces_id_user_granted_by
		)
		VALUES ($1, $2, $3, $4, FALSE, $5)
		RETURNING users_roles_workspaces_id
	`

const sqlRevokeWorkspaceRoleGrant = `
		UPDATE users_roles_workspaces
		   SET users_roles_workspaces_revoked_at         = NOW(),
		       users_roles_workspaces_id_user_revoked_by = $1,
		       users_roles_workspaces_updated_at         = NOW()
		 WHERE users_roles_workspaces_id_workspace    = $2
		   AND users_roles_workspaces_id_user         = $3
		   AND users_roles_workspaces_id_subscription = $4
		   AND users_roles_workspaces_revoked_at IS NULL
	`

const sqlListActiveWorkspaceRoles = `
		SELECT users_roles_workspaces_id,
		       users_roles_workspaces_id_subscription,
		       users_roles_workspaces_id_workspace,
		       users_roles_workspaces_id_user,
		       users_roles_workspaces_role,
		       users_roles_workspaces_can_redelegate,
		       users_roles_workspaces_id_user_granted_by,
		       users_roles_workspaces_granted_at,
		       users_roles_workspaces_revoked_at,
		       users_roles_workspaces_id_user_revoked_by,
		       users_roles_workspaces_created_at,
		       users_roles_workspaces_updated_at
		  FROM users_roles_workspaces
		 WHERE users_roles_workspaces_id_workspace    = $1
		   AND users_roles_workspaces_id_subscription = $2
		   AND users_roles_workspaces_revoked_at IS NULL
		 ORDER BY users_roles_workspaces_granted_at ASC
	`

// ── crossdb.go: cross-DB orphan scan (vector_artefacts read-only) ──────────

// sqlCountOrphansForWorkspaceTemplate counts rows referencing a
// workspace in a vector_artefacts table. Slots: %s = table name
// (hard-coded enum), %s = workspace-id column name (hard-coded enum),
// %s = optional " AND <archive-pred>" clause when the table has an
// archived_at column. The column names are now table-prefixed after
// RF1.4.2 column-prefix sweep, so the orphan-scan registry carries the
// column name explicitly per row.
const sqlCountOrphansForWorkspaceTemplate = `SELECT COUNT(*) FROM %s WHERE %s = $1%s`
