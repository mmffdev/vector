// Package workspaces SQL constants.
//
// PLA-0048 / RF1.2.11. Sole writer for master_record_workspaces and
// roles_workspaces (mmff_vector); read-only over VAPool (vector_artefacts)
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
// roles_workspaces row so the clamp middleware lets them read it.
const sqlInsertWorkspaceCreatorAdminGrant = `
		INSERT INTO roles_workspaces (subscription_id, workspace_id, user_id, role, granted_by)
		VALUES ($1, $2, $3, 'admin', $3)
	`

const sqlRenameWorkspace = `UPDATE master_record_workspaces SET name = $1, updated_at = NOW() WHERE id = $2`

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

// ── roles.go: workspace_roles grant CRUD ───────────────────────────────────

const sqlSelectActiveGrantForUserOnWorkspace = `
		SELECT id FROM roles_workspaces
		 WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL
		 LIMIT 1
	`

const sqlExistsActiveAdminGrantOnWorkspace = `
		SELECT EXISTS(
		    SELECT 1 FROM roles_workspaces
		     WHERE workspace_id = $1 AND role = 'admin' AND revoked_at IS NULL
		)
	`

const sqlInsertWorkspaceRoleGrant = `
		INSERT INTO roles_workspaces
		    (subscription_id, workspace_id, user_id, role, can_redelegate, granted_by)
		VALUES ($1, $2, $3, $4, FALSE, $5)
		RETURNING id
	`

const sqlRevokeWorkspaceRoleGrant = `
		UPDATE roles_workspaces
		   SET revoked_at = NOW(),
		       revoked_by = $1,
		       updated_at = NOW()
		 WHERE workspace_id = $2
		   AND user_id      = $3
		   AND subscription_id = $4
		   AND revoked_at IS NULL
	`

const sqlListActiveWorkspaceRoles = `
		SELECT id, subscription_id, workspace_id, user_id, role,
		       can_redelegate, granted_by, granted_at,
		       revoked_at, revoked_by, created_at, updated_at
		  FROM roles_workspaces
		 WHERE workspace_id = $1
		   AND subscription_id = $2
		   AND revoked_at IS NULL
		 ORDER BY granted_at ASC
	`

// ── crossdb.go: cross-DB orphan scan (vector_artefacts read-only) ──────────

// sqlCountOrphansForWorkspaceTemplate counts rows referencing a
// workspace in a vector_artefacts table. First %s is the table name
// (hard-coded enum, never user input — see vaWorkspaceTables); second
// %s is the optional " AND archived_at IS NULL" clause appended when
// the table has an archived_at column.
const sqlCountOrphansForWorkspaceTemplate = `SELECT COUNT(*) FROM %s WHERE workspace_id = $1%s`
