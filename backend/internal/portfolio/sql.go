// Package portfolio SQL constants.
//
// PLA-0048 / RF1.2.18 (consts) + RF1.4.2.master_record (column-prefix
// rule, migration 060). Sole writer for master_record_portfolios
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
		    SELECT 1 FROM users_roles_workspaces
		     WHERE workspace_id = $1
		       AND user_id = $2
		       AND revoked_at IS NULL
		)
	`

// ── master_record_portfolios CRUD (vector_artefacts) ────────────────────────

// sqlSelectMasterRecord returns one row by workspace id.
const sqlSelectMasterRecord = `
		SELECT master_record_portfolios_id_workspace,
		       master_record_portfolios_id_library_portfolio_model,
		       master_record_portfolios_model_name,
		       master_record_portfolios_model_description,
		       master_record_portfolios_adopted_at,
		       master_record_portfolios_id_user_adopter,
		       master_record_portfolios_created_at,
		       master_record_portfolios_updated_at,
		       master_record_portfolios_archived_at
		  FROM master_record_portfolios
		 WHERE master_record_portfolios_id_workspace = $1
	`

// sqlUpsertMasterRecord is the adoption-saga write.
const sqlUpsertMasterRecord = `
		INSERT INTO master_record_portfolios (
			master_record_portfolios_id_workspace,
			master_record_portfolios_id_library_portfolio_model,
			master_record_portfolios_model_name,
			master_record_portfolios_model_description,
			master_record_portfolios_id_user_adopter
		) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (master_record_portfolios_id_workspace) DO UPDATE SET
			master_record_portfolios_id_library_portfolio_model = EXCLUDED.master_record_portfolios_id_library_portfolio_model,
			master_record_portfolios_model_name                 = EXCLUDED.master_record_portfolios_model_name,
			master_record_portfolios_model_description          = EXCLUDED.master_record_portfolios_model_description,
			master_record_portfolios_adopted_at                 = now(),
			master_record_portfolios_id_user_adopter            = EXCLUDED.master_record_portfolios_id_user_adopter,
			master_record_portfolios_archived_at                = NULL
	`

// sqlUpdateMasterRecordTemplate is the sparse-UPDATE shell.
const sqlUpdateMasterRecordTemplate = `UPDATE master_record_portfolios SET %s WHERE master_record_portfolios_id_workspace = $%d`

// sqlArchiveMasterRecord soft-archives the row idempotently.
const sqlArchiveMasterRecord = `
		UPDATE master_record_portfolios
		   SET master_record_portfolios_archived_at = COALESCE(master_record_portfolios_archived_at, now())
		 WHERE master_record_portfolios_id_workspace = $1
	`
