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
//
// PLA-0049 / RF1.4.4 — column-prefix shape (mig 188): user_id →
// users_roles_workspaces_id_user, workspace_id →
// users_roles_workspaces_id_workspace, revoked_at →
// users_roles_workspaces_revoked_at. Pre-rename this query silently
// 500'd on every non-admin GET /api/workspace/{id}/fields call;
// resolved by TD-FIELDS-WSPERMS-RENAME.
const sqlExistsActiveWorkspaceMembership = `
		SELECT EXISTS (
			SELECT 1 FROM users_roles_workspaces
			 WHERE users_roles_workspaces_id_user      = $1
			   AND users_roles_workspaces_id_workspace = $2
			   AND users_roles_workspaces_revoked_at IS NULL
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

// ── writers: Create / Update / Archive ─────────────────────────────────────

// sqlInsertFieldLibrary inserts one row into artefacts_fields_library.
// subscription_id is NULL when scope='global' (the CHECK constraint
// chk_afl_global_no_subscription enforces this); otherwise it carries
// the caller's tenant. options_json / config_json / description may be
// NULL.
//
// Returns the full row in the same column order as sqlLoadAdmittedFields
// so the caller can hydrate a FieldRow without an extra round-trip.
const sqlInsertFieldLibrary = `
		INSERT INTO artefacts_fields_library
			(subscription_id, field_name, label, field_type,
			 options_json, config_json, description, scope)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING
			id,
			subscription_id,
			field_name,
			label,
			field_type,
			options_json,
			config_json,
			description,
			scope,
			created_at,
			updated_at
	`

// sqlInsertWorkspaceFieldAdmit admits a newly-created scope='workspace'
// field into the workspace that created it. Without this row the field
// is invisible to its own workspace (per the resolver's deny-by-default
// rule). PRIMARY KEY (workspace_id, field_library_id) makes the insert
// idempotent on retry.
const sqlInsertWorkspaceFieldAdmit = `
		INSERT INTO workspaces_fields (workspace_id, field_library_id, created_by)
		VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id, field_library_id) DO NOTHING
	`

// sqlSelectFieldLibraryFull loads one row by id (including the columns
// the gate needs: scope + subscription_id). Used by Update / Archive to
// re-fetch the row before mutation so we don't trust the caller's view
// of what they're editing.
const sqlSelectFieldLibraryFull = `
		SELECT
			id,
			subscription_id,
			field_name,
			label,
			field_type,
			options_json,
			config_json,
			description,
			scope,
			created_at,
			updated_at,
			archived_at
		  FROM artefacts_fields_library
		 WHERE id = $1
	`

// sqlCountFieldValues returns the number of artefacts_fields_values
// rows that reference a given field_library row. Update uses this to
// block field_type changes once values exist (mirrors Jira's behaviour —
// a typed-EAV column swap silently corrupts existing values).
const sqlCountFieldValues = `
		SELECT COUNT(*)
		  FROM artefacts_fields_values
		 WHERE artefacts_fields_values_id_field_library = $1
	`

// sqlUpdateFieldLibrary is a sparse UPDATE — COALESCE on every nullable
// patch column lets callers send only the columns they want to change.
// field_type is patched only when the values-count gate passes.
//
// Notes on the JSONB columns: passing NULL via the wire means "leave
// alone" because we can't distinguish "set to null" from "omit" in a
// sparse PATCH; if a caller needs to clear options_json they pass the
// literal JSON null (`null`), which Postgres stores as JSONB null —
// distinguishable from SQL NULL. config_json + description follow the
// same convention.
//
// Returns the hydrated row so the handler can echo the post-state.
const sqlUpdateFieldLibrary = `
		UPDATE artefacts_fields_library SET
			label        = COALESCE($2, label),
			field_type   = COALESCE($3, field_type),
			options_json = COALESCE($4, options_json),
			config_json  = COALESCE($5, config_json),
			description  = COALESCE($6, description),
			updated_at   = now()
		 WHERE id = $1
		   AND archived_at IS NULL
		 RETURNING
			id,
			subscription_id,
			field_name,
			label,
			field_type,
			options_json,
			config_json,
			description,
			scope,
			created_at,
			updated_at
	`

// sqlSelectFieldLibraryGate is the lightweight pre-fetch the Archive
// writer uses to clamp scope + tenant before the soft-delete. We only
// need the three discriminator columns; the heavier sqlSelectFieldLibraryFull
// is for Update which has to round-trip the full row state.
const sqlSelectFieldLibraryGate = `
		SELECT subscription_id, scope, archived_at
		  FROM artefacts_fields_library
		 WHERE id = $1
	`

// sqlArchiveFieldLibrary is the soft-delete writer: sets archived_at
// to now() iff still live. The WHERE archived_at IS NULL clause makes
// re-archive a no-op (we report not-found if zero rows affected, so the
// caller doesn't see a 200 for an already-archived row).
const sqlArchiveFieldLibrary = `
		UPDATE artefacts_fields_library
		   SET archived_at = now(),
		       updated_at  = now()
		 WHERE id = $1
		   AND archived_at IS NULL
	`
