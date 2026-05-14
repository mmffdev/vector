// Package tenantsettings SQL constants.
//
// PLA-0048 / RF1.2.12. Sole writer for master_record_tenants (vector_artefacts).
package tenantmasterrecord

// sqlEnsureTenantRow defensively inserts an empty row for workspaces
// seeded before mig 036. ON CONFLICT keeps it idempotent.
const sqlEnsureTenantRow = `
		INSERT INTO master_record_tenants (master_record_tenants_id_workspace) VALUES ($1)
		ON CONFLICT (master_record_tenants_id_workspace) DO NOTHING
	`

// sqlSelectTenantSettings hydrates the wire shape for one workspace.
const sqlSelectTenantSettings = `
		SELECT master_record_tenants_id_workspace,
		       master_record_tenants_name,
		       master_record_tenants_description,
		       master_record_tenants_id_user_owner,
		       master_record_tenants_primary_contact_email,
		       master_record_tenants_data_region,
		       master_record_tenants_timezone,
		       master_record_tenants_date_format,
		       master_record_tenants_datetime_format,
		       master_record_tenants_workdays,
		       master_record_tenants_week_start,
		       master_record_tenants_rank_method,
		       master_record_tenants_build_changeset_tracking,
		       master_record_tenants_notes,
		       master_record_tenants_created_at,
		       master_record_tenants_updated_at,
		       master_record_tenants_archived_at
		  FROM master_record_tenants
		 WHERE master_record_tenants_id_workspace = $1
	`

// sqlUpdateTenantTemplate is the sparse-UPDATE shell. First %s holds
// the comma-separated `col = $N` SET clause; %d holds the $N for the
// WHERE master_record_tenants_id_workspace bind.
const sqlUpdateTenantTemplate = `UPDATE master_record_tenants SET %s WHERE master_record_tenants_id_workspace = $%d`
