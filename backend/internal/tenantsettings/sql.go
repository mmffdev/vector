// Package tenantsettings SQL constants.
//
// PLA-0048 / RF1.2.12. Sole writer for master_record_tenant (vector_artefacts).
package tenantsettings

// sqlEnsureTenantRow defensively inserts an empty row for workspaces
// seeded before mig 036. ON CONFLICT keeps it idempotent.
const sqlEnsureTenantRow = `
		INSERT INTO master_record_tenant (workspace_id) VALUES ($1)
		ON CONFLICT (workspace_id) DO NOTHING
	`

// sqlSelectTenantSettings hydrates the wire shape for one workspace.
const sqlSelectTenantSettings = `
		SELECT workspace_id, tenant_name, tenant_description, tenant_owner_user_id, tenant_primary_contact_email,
		       tenant_data_region, tenant_timezone, tenant_date_format, tenant_datetime_format,
		       tenant_workdays, tenant_week_start, tenant_rank_method, tenant_build_changeset_tracking,
		       tenant_notes,
		       tenant_created_at, tenant_updated_at, tenant_archived_at
		  FROM master_record_tenant
		 WHERE workspace_id = $1
	`

// sqlUpdateTenantTemplate is the sparse-UPDATE shell. First %s holds
// the comma-separated `col = $N` SET clause; %d holds the $N for the
// WHERE workspace_id bind.
const sqlUpdateTenantTemplate = `UPDATE master_record_tenant SET %s WHERE workspace_id = $%d`
