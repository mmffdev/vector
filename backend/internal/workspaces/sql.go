// Package workspaces SQL constants.
//
// PLA-0048 / RF1.2.11. Sole writer for master_record_workspaces and
// users_roles_workspaces (mmff_vector); read-only over VAPool (vector_artefacts)
// via the cross-DB orphan scan in crossdb.go.
package workspaces

// ── commands.go: workspace CRUD ────────────────────────────────────────────

const sqlInsertWorkspace = `
		INSERT INTO master_record_workspaces (
			master_record_workspaces_id_subscription,
			master_record_workspaces_name,
			master_record_workspaces_slug,
			master_record_workspaces_description,
			master_record_workspaces_id_user_created_by
		)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING master_record_workspaces_id,
		          master_record_workspaces_id_subscription,
		          master_record_workspaces_name,
		          master_record_workspaces_slug,
		          master_record_workspaces_description,
		          master_record_workspaces_id_user_created_by,
		          master_record_workspaces_created_at,
		          master_record_workspaces_updated_at,
		          master_record_workspaces_archived_at,
		          master_record_workspaces_id_user_archived_by
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

const sqlRenameWorkspace = `UPDATE master_record_workspaces SET master_record_workspaces_name = $1, master_record_workspaces_updated_at = NOW() WHERE master_record_workspaces_id = $2`

// Note: the matching topology-root rename used to live here as
// sqlRenameTopologyRootNode. Moved to topology/sql.go +
// topology.Service.RenameWorkspaceRootNode 2026-05-18 so the writer-
// boundary lint catches any future regression. workspaces.Service.Rename
// calls topology.RenameWorkspaceRootNode via the TopologySeeder interface.

const sqlCountLiveSiblingsExcluding = `
		SELECT COUNT(*)
		  FROM master_record_workspaces
		 WHERE master_record_workspaces_id_subscription = $1
		   AND master_record_workspaces_id <> $2
		   AND master_record_workspaces_archived_at IS NULL
	`

const sqlArchiveWorkspace = `
		UPDATE master_record_workspaces
		   SET master_record_workspaces_archived_at         = NOW(),
		       master_record_workspaces_id_user_archived_by = $1,
		       master_record_workspaces_updated_at          = NOW()
		 WHERE master_record_workspaces_id = $2
	`

// Note: the matching topology archive/restore used to live here as
// sqlArchiveTopologyNodes / sqlRestoreTopologyNodes. Moved to
// topology/sql.go + topology.Service.{Archive,Restore}WorkspaceTopology
// 2026-05-18 (same writer-boundary fix as the rename hook above).

// sqlExistsLiveSlugCollision is the slug-collision guard before restore.
const sqlExistsLiveSlugCollision = `
		SELECT EXISTS(
		    SELECT 1 FROM master_record_workspaces
		     WHERE master_record_workspaces_id_subscription = $1
		       AND master_record_workspaces_slug            = $2
		       AND master_record_workspaces_archived_at IS NULL
		)
	`

const sqlRestoreWorkspace = `
		UPDATE master_record_workspaces
		   SET master_record_workspaces_archived_at         = NULL,
		       master_record_workspaces_id_user_archived_by = NULL,
		       master_record_workspaces_updated_at          = NOW()
		 WHERE master_record_workspaces_id = $1
	`

const sqlSelectWorkspaceByIDInTenant = `
		SELECT master_record_workspaces_id,
		       master_record_workspaces_id_subscription,
		       master_record_workspaces_name,
		       master_record_workspaces_slug,
		       master_record_workspaces_description,
		       master_record_workspaces_id_user_created_by,
		       master_record_workspaces_created_at,
		       master_record_workspaces_updated_at,
		       master_record_workspaces_archived_at,
		       master_record_workspaces_id_user_archived_by
		  FROM master_record_workspaces
		 WHERE master_record_workspaces_id = $1 AND master_record_workspaces_id_subscription = $2
	`

// sqlListWorkspacesTemplate is the dynamic list query. The %s holds
// the optional `AND master_record_workspaces_archived_at IS NULL`
// clause (or empty string).
const sqlListWorkspacesTemplate = `
		SELECT master_record_workspaces_id,
		       master_record_workspaces_id_subscription,
		       master_record_workspaces_name,
		       master_record_workspaces_slug,
		       master_record_workspaces_description,
		       master_record_workspaces_id_user_created_by,
		       master_record_workspaces_created_at,
		       master_record_workspaces_updated_at,
		       master_record_workspaces_archived_at,
		       master_record_workspaces_id_user_archived_by
		  FROM master_record_workspaces
		 WHERE master_record_workspaces_id_subscription = $1%s
		 ORDER BY master_record_workspaces_created_at ASC
	`

// sqlLoadWorkspaceForUpdate is the SELECT … FOR UPDATE helper used by
// every write path. Tenant scope checked in Go after scan.
const sqlLoadWorkspaceForUpdate = `
		SELECT master_record_workspaces_id,
		       master_record_workspaces_id_subscription,
		       master_record_workspaces_name,
		       master_record_workspaces_slug,
		       master_record_workspaces_description,
		       master_record_workspaces_id_user_created_by,
		       master_record_workspaces_created_at,
		       master_record_workspaces_updated_at,
		       master_record_workspaces_archived_at,
		       master_record_workspaces_id_user_archived_by
		  FROM master_record_workspaces
		 WHERE master_record_workspaces_id = $1
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
