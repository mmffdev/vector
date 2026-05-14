// Package portfolio SQL constants.
//
// PLA-0048 / RF1.2.18. Sole writer for master_record_portfolio
// (vector_artefacts); read-only against mmff_vector for the
// CanReadMasterRecord tenancy + membership probe.
package portfolio

// ── CanReadMasterRecord (mmff_vector) ──────────────────────────────────────

// sqlSelectWorkspaceSubscriptionID returns the workspace's owning
// subscription so callers can refuse cross-tenant reads.
const sqlSelectWorkspaceSubscriptionID = `SELECT subscription_id FROM master_record_workspaces WHERE id = $1`

// sqlExistsActiveWorkspaceMembership probes whether the user holds
// any active grant on the workspace.
const sqlExistsActiveWorkspaceMembership = `
		SELECT EXISTS (
		    SELECT 1 FROM roles_workspaces
		     WHERE workspace_id = $1
		       AND user_id = $2
		       AND revoked_at IS NULL
		)
	`

// ── master_record_portfolio CRUD (vector_artefacts) ────────────────────────

// sqlSelectMasterRecord returns one row by workspace_id.
const sqlSelectMasterRecord = `
		SELECT workspace_id, model_id, model_name, model_description,
		       adopted_at, adopted_by_user_id,
		       created_at, updated_at, archived_at
		  FROM master_record_portfolio
		 WHERE workspace_id = $1
	`

// sqlUpsertMasterRecord is the adoption-saga write. ON CONFLICT
// resurrects an archived record (archived_at cleared) and overwrites
// model identity.
const sqlUpsertMasterRecord = `
		INSERT INTO master_record_portfolio (
			workspace_id, model_id, model_name, model_description, adopted_by_user_id
		) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (workspace_id) DO UPDATE SET
			model_id           = EXCLUDED.model_id,
			model_name         = EXCLUDED.model_name,
			model_description  = EXCLUDED.model_description,
			adopted_at         = now(),
			adopted_by_user_id = EXCLUDED.adopted_by_user_id,
			archived_at        = NULL
	`

// sqlUpdateMasterRecordTemplate is the sparse-UPDATE shell. First %s
// holds the comma-separated `col = $N` SET clause; %d holds the
// workspace_id bind index.
const sqlUpdateMasterRecordTemplate = `UPDATE master_record_portfolio SET %s WHERE workspace_id = $%d`

// sqlArchiveMasterRecord soft-archives the row idempotently
// (COALESCE preserves the original archived_at on re-archive).
const sqlArchiveMasterRecord = `
		UPDATE master_record_portfolio SET archived_at = COALESCE(archived_at, now()) WHERE workspace_id = $1
	`
