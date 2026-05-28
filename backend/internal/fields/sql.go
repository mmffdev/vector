// Package fields SQL constants.
//
// PLA-0048 / RF1.2.13. Single-DB-per-call package — vectorPool reads
// mmff_vector (workspaces + role grants); artefactsPool reads
// vector_artefacts (artefacts_fields_library + admit table).
package fields

// ── service.go ──────────────────────────────────────────────────────────────

// sqlSelectWorkspaceTenant returns the subscription_id for a workspace.
// pgx.ErrNoRows → ErrWorkspaceNotFound at the caller.
const sqlSelectWorkspaceTenant = `SELECT master_record_workspaces_id_subscription FROM master_record_workspaces WHERE master_record_workspaces_id = $1`

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
		    fl.artefacts_fields_library_id,
		    fl.artefacts_fields_library_id_subscription,
		    fl.artefacts_fields_library_field_name,
		    fl.artefacts_fields_library_label,
		    fl.artefacts_fields_library_field_type,
		    fl.artefacts_fields_library_options_json,
		    fl.artefacts_fields_library_config_json,
		    fl.artefacts_fields_library_description,
		    fl.artefacts_fields_library_scope,
		    fl.artefacts_fields_library_created_at,
		    fl.artefacts_fields_library_updated_at
		  FROM artefacts_fields_library fl
		 WHERE fl.artefacts_fields_library_archived_at IS NULL
		   AND (
		         fl.artefacts_fields_library_scope = 'global'
		      OR (fl.artefacts_fields_library_scope = 'tenant'    AND fl.artefacts_fields_library_id_subscription = $2)
		      OR (fl.artefacts_fields_library_scope = 'workspace' AND fl.artefacts_fields_library_id_subscription = $2 AND EXISTS (
		             SELECT 1 FROM workspaces_fields awf
		              WHERE awf.workspaces_fields_id_workspace = $1
		                AND awf.workspaces_fields_id_field_library = fl.artefacts_fields_library_id
		         ))
		       )
		 ORDER BY fl.artefacts_fields_library_label ASC, fl.artefacts_fields_library_field_name ASC
	`

// ── resolver.go ────────────────────────────────────────────────────────────

// sqlSelectFieldLibraryRow returns the scope + subscription_id columns
// the Resolver needs to decide admission for a single field.
const sqlSelectFieldLibraryRow = `
		SELECT artefacts_fields_library_scope,
		       artefacts_fields_library_id_subscription
		  FROM artefacts_fields_library
		 WHERE artefacts_fields_library_id = $1
		   AND artefacts_fields_library_archived_at IS NULL
	`

// sqlExistsWorkspaceFieldAdmit is the admit-row probe for the
// workspace-scope resolver path.
//
// RF1.5.2 — column prefixes applied to workspaces_fields (migration 098).
const sqlExistsWorkspaceFieldAdmit = `
		SELECT EXISTS (
			SELECT 1 FROM workspaces_fields
			 WHERE workspaces_fields_id_workspace = $1 AND workspaces_fields_id_field_library = $2
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
			(artefacts_fields_library_id_subscription,
			 artefacts_fields_library_field_name,
			 artefacts_fields_library_label,
			 artefacts_fields_library_field_type,
			 artefacts_fields_library_options_json,
			 artefacts_fields_library_config_json,
			 artefacts_fields_library_description,
			 artefacts_fields_library_scope)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING
			artefacts_fields_library_id,
			artefacts_fields_library_id_subscription,
			artefacts_fields_library_field_name,
			artefacts_fields_library_label,
			artefacts_fields_library_field_type,
			artefacts_fields_library_options_json,
			artefacts_fields_library_config_json,
			artefacts_fields_library_description,
			artefacts_fields_library_scope,
			artefacts_fields_library_created_at,
			artefacts_fields_library_updated_at
	`

// sqlInsertWorkspaceFieldAdmit admits a newly-created scope='workspace'
// field into the workspace that created it. Without this row the field
// is invisible to its own workspace (per the resolver's deny-by-default
// rule). PRIMARY KEY (workspaces_fields_id_workspace, workspaces_fields_id_field_library)
// makes the insert idempotent on retry.
//
// RF1.5.2 — column prefixes applied to workspaces_fields (migration 098).
const sqlInsertWorkspaceFieldAdmit = `
		INSERT INTO workspaces_fields (
			workspaces_fields_id_workspace,
			workspaces_fields_id_field_library,
			workspaces_fields_id_user_created_by
		)
		VALUES ($1, $2, $3)
		ON CONFLICT (workspaces_fields_id_workspace, workspaces_fields_id_field_library) DO NOTHING
	`

// sqlSelectFieldLibraryFull loads one row by id (including the columns
// the gate needs: scope + subscription_id). Used by Update / Archive to
// re-fetch the row before mutation so we don't trust the caller's view
// of what they're editing.
const sqlSelectFieldLibraryFull = `
		SELECT
			artefacts_fields_library_id,
			artefacts_fields_library_id_subscription,
			artefacts_fields_library_field_name,
			artefacts_fields_library_label,
			artefacts_fields_library_field_type,
			artefacts_fields_library_options_json,
			artefacts_fields_library_config_json,
			artefacts_fields_library_description,
			artefacts_fields_library_scope,
			artefacts_fields_library_created_at,
			artefacts_fields_library_updated_at,
			artefacts_fields_library_archived_at
		  FROM artefacts_fields_library
		 WHERE artefacts_fields_library_id = $1
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
			artefacts_fields_library_label        = COALESCE($2, artefacts_fields_library_label),
			artefacts_fields_library_field_type   = COALESCE($3, artefacts_fields_library_field_type),
			artefacts_fields_library_options_json = COALESCE($4, artefacts_fields_library_options_json),
			artefacts_fields_library_config_json  = COALESCE($5, artefacts_fields_library_config_json),
			artefacts_fields_library_description  = COALESCE($6, artefacts_fields_library_description),
			artefacts_fields_library_updated_at   = now()
		 WHERE artefacts_fields_library_id = $1
		   AND artefacts_fields_library_archived_at IS NULL
		 RETURNING
			artefacts_fields_library_id,
			artefacts_fields_library_id_subscription,
			artefacts_fields_library_field_name,
			artefacts_fields_library_label,
			artefacts_fields_library_field_type,
			artefacts_fields_library_options_json,
			artefacts_fields_library_config_json,
			artefacts_fields_library_description,
			artefacts_fields_library_scope,
			artefacts_fields_library_created_at,
			artefacts_fields_library_updated_at
	`

// sqlSelectFieldLibraryGate is the lightweight pre-fetch the Archive
// writer uses to clamp scope + tenant before the soft-delete. We only
// need the three discriminator columns; the heavier sqlSelectFieldLibraryFull
// is for Update which has to round-trip the full row state.
const sqlSelectFieldLibraryGate = `
		SELECT artefacts_fields_library_id_subscription,
		       artefacts_fields_library_scope,
		       artefacts_fields_library_archived_at
		  FROM artefacts_fields_library
		 WHERE artefacts_fields_library_id = $1
	`

// sqlArchiveFieldLibrary is the soft-delete writer: sets archived_at
// to now() iff still live. The WHERE archived_at IS NULL clause makes
// re-archive a no-op (we report not-found if zero rows affected, so the
// caller doesn't see a 200 for an already-archived row).
const sqlArchiveFieldLibrary = `
		UPDATE artefacts_fields_library
		   SET artefacts_fields_library_archived_at = now(),
		       artefacts_fields_library_updated_at  = now()
		 WHERE artefacts_fields_library_id = $1
		   AND artefacts_fields_library_archived_at IS NULL
	`

// ── Type bindings (artefacts_types_fields) ─────────────────────────────────
//
// Reads + writes for the binding between a catalogue field and an artefact
// type. Tenant clamp is on the SUBSCRIPTION_ID of the type AND of the field —
// the service layer parameterises both so cross-tenant probes return zero
// rows (and the service translates to ErrUnknownArtefactType → 404).
//
// Called by: ListBindingsForField, ReplaceBindingsForField, UpdateBinding.

// sqlListBindingsForField — every binding for one field, joined with the
// type label + scope for one-shot rendering. Skips archived types.
const sqlListBindingsForField = `
  SELECT tf.artefacts_types_fields_id_artefact_type,
         at.artefacts_types_name,
         at.artefacts_types_scope,
         tf.artefacts_types_fields_position,
         tf.artefacts_types_fields_required,
         tf.artefacts_types_fields_default_value
    FROM artefacts_types_fields tf
    JOIN artefacts_types at
      ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
    JOIN artefacts_fields_library fl
      ON fl.artefacts_fields_library_id = tf.artefacts_types_fields_id_field_library
   WHERE tf.artefacts_types_fields_id_field_library = $1
     AND fl.artefacts_fields_library_id_subscription IS NOT DISTINCT FROM $2
     AND at.artefacts_types_archived_at IS NULL
   ORDER BY at.artefacts_types_scope, at.artefacts_types_name
`

// sqlValidateArtefactTypesInTenant — given a field's subscription and a set of
// type IDs, returns ONLY the type IDs that exist, are not archived, and share
// the same subscription. Caller diffs against the requested set to compute
// unknown IDs (→ 404).
const sqlValidateArtefactTypesInTenant = `
  SELECT artefacts_types_id
    FROM artefacts_types
   WHERE artefacts_types_id = ANY($1::uuid[])
     AND artefacts_types_id_subscription = $2
     AND artefacts_types_archived_at IS NULL
`

// sqlUpsertBinding — single-row upsert by (type, field). Used inside the
// ReplaceBindingsForField transaction loop.
const sqlUpsertBinding = `
  INSERT INTO artefacts_types_fields (
    artefacts_types_fields_id_artefact_type,
    artefacts_types_fields_id_field_library,
    artefacts_types_fields_position,
    artefacts_types_fields_required,
    artefacts_types_fields_default_value
  ) VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (artefacts_types_fields_id_artefact_type,
               artefacts_types_fields_id_field_library)
  DO UPDATE SET
    artefacts_types_fields_position      = EXCLUDED.artefacts_types_fields_position,
    artefacts_types_fields_required      = EXCLUDED.artefacts_types_fields_required,
    artefacts_types_fields_default_value = EXCLUDED.artefacts_types_fields_default_value,
    artefacts_types_fields_updated_at    = now()
`

// sqlDeleteBindingsNotIn — removes any binding for this field whose type is
// NOT in the kept-set. Runs once at the end of the ReplaceBindingsForField
// transaction to enforce set semantics.
const sqlDeleteBindingsNotIn = `
  DELETE FROM artefacts_types_fields
   WHERE artefacts_types_fields_id_field_library = $1
     AND artefacts_types_fields_id_artefact_type <> ALL($2::uuid[])
`

// sqlPatchBinding — single-binding update used by UpdateBinding. Pointer
// args (NULL = don't change) map to COALESCE; default_value uses the
// "empty string means NULL" convention — service translates blank to NULL.
const sqlPatchBinding = `
  UPDATE artefacts_types_fields
     SET artefacts_types_fields_position      = COALESCE($3, artefacts_types_fields_position),
         artefacts_types_fields_required      = COALESCE($4, artefacts_types_fields_required),
         artefacts_types_fields_default_value = COALESCE($5, artefacts_types_fields_default_value),
         artefacts_types_fields_updated_at    = now()
   WHERE artefacts_types_fields_id_field_library = $1
     AND artefacts_types_fields_id_artefact_type = $2
   RETURNING artefacts_types_fields_id_artefact_type,
            artefacts_types_fields_position,
            artefacts_types_fields_required,
            artefacts_types_fields_default_value
`

// sqlFetchOneBinding — read one binding by (field, type), joined with the
// type label + scope. Used after Upsert/Patch when the caller wants the
// enriched return shape.
const sqlFetchOneBinding = `
  SELECT tf.artefacts_types_fields_id_artefact_type,
         at.artefacts_types_name,
         at.artefacts_types_scope,
         tf.artefacts_types_fields_position,
         tf.artefacts_types_fields_required,
         tf.artefacts_types_fields_default_value
    FROM artefacts_types_fields tf
    JOIN artefacts_types at
      ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
   WHERE tf.artefacts_types_fields_id_field_library = $1
     AND tf.artefacts_types_fields_id_artefact_type = $2
`
