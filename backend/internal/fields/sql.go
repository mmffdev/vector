// Package fields SQL constants.
//
// PLA-0048 / RF1.2.13. Single-DB-per-call package — vectorPool reads
// mmff_vector (workspaces + role grants); artefactsPool reads
// vector_artefacts (artefacts_fields_library + admit table).
package fields

// ── service.go ──────────────────────────────────────────────────────────────

// sqlSelectWorkspaceTenant returns the subscription_id for a workspace.
// pgx.ErrNoRows → ErrWorkspaceNotFound at the caller.
const sqlSelectWorkspaceTenant = `SELECT subscription_id FROM master_record_workspaces WHERE id = $1`

// sqlExistsActiveWorkspaceMembership probes whether a user holds any
// live role grant on a workspace. Used by AssertCallerMayRead for
// non-admin users_roles.
const sqlExistsActiveWorkspaceMembership = `
		SELECT EXISTS (
			SELECT 1 FROM users_roles_workspaces
			 WHERE user_id = $1 AND workspace_id = $2 AND revoked_at IS NULL
		)
	`

// sqlLoadAdmittedFields returns every artefacts_fields_library row
// admitted into a (workspace, tenant) pair. Admission rules: global
// scope always admitted; tenant scope when subscription_id matches;
// workspace scope when there's a matching workspaces_fields row.
const sqlLoadAdmittedFields = `
		SELECT
		    fl.id,
		    fl.subscription_id,
		    fl.field_name,
		    fl.label,
		    fl.field_type,
		    fl.options_json,
		    fl.config_json,
		    fl.description,
		    fl.scope,
		    fl.created_at,
		    fl.updated_at
		  FROM artefacts_fields_library fl
		 WHERE fl.archived_at IS NULL
		   AND (
		         fl.scope = 'global'
		      OR (fl.scope = 'tenant'    AND fl.subscription_id = $2)
		      OR (fl.scope = 'workspace' AND fl.subscription_id = $2 AND EXISTS (
		             SELECT 1 FROM workspaces_fields awf
		              WHERE awf.workspace_id = $1
		                AND awf.field_library_id = fl.id
		         ))
		       )
		 ORDER BY fl.label ASC, fl.field_name ASC
	`

// ── resolver.go ────────────────────────────────────────────────────────────

// sqlSelectFieldLibraryRow returns the scope + subscription_id columns
// the Resolver needs to decide admission for a single field.
const sqlSelectFieldLibraryRow = `
		SELECT scope, subscription_id
		  FROM artefacts_fields_library
		 WHERE id = $1 AND archived_at IS NULL
	`

// sqlExistsWorkspaceFieldAdmit is the admit-row probe for the
// workspace-scope resolver path.
const sqlExistsWorkspaceFieldAdmit = `
		SELECT EXISTS (
			SELECT 1 FROM workspaces_fields
			 WHERE workspace_id = $1 AND field_library_id = $2
		)
	`
