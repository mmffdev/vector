// Package tenantmasterrecord SQL constants.
//
// PLA-0050 / Story 00569. Sole writer for master_record_tenants
// (vector_artefacts, subscription-keyed). Distinct from
// workspacemasterrecord (which serves master_record_workspaces,
// workspace-keyed) — see docs/c_c_db_routing.md.
package tenantmasterrecord

// sqlEnsureTenantRow defensively inserts an empty row for subscriptions
// that don't have one yet. ON CONFLICT keeps it idempotent.
const sqlEnsureTenantRow = `
		INSERT INTO master_record_tenants (master_record_tenants_id_subscription) VALUES ($1)
		ON CONFLICT (master_record_tenants_id_subscription) DO NOTHING
	`

// sqlSelectTenantSettings hydrates the wire shape for one subscription.
//
// PLA-0051 mig 070 dropped NOT NULL on the inheritable tenant columns
// (so the workspacemasterrecord COALESCE merge can distinguish "tenant
// has no opinion" from "tenant says X"). This reader serves the
// **tenant-settings page itself**, where the wire shape promises
// non-nullable values for those fields — so we COALESCE-to-schema-default
// at read time. Net effect: a tenant row whose inheritable column is
// accidentally NULL still renders the canonical default to the editor,
// rather than crashing with "cannot scan NULL into *string". The schema
// defaults match those in vector_artefacts/schema/068 (column DEFAULTs)
// and tenantmasterrecord/service.go (validation sets); if either moves,
// this list must move with it.
const sqlSelectTenantSettings = `
		SELECT master_record_tenants_id_subscription,
		       master_record_tenants_name,
		       master_record_tenants_description,
		       master_record_tenants_primary_contact_email,
		       COALESCE(master_record_tenants_data_region, 'use1')                          AS master_record_tenants_data_region,
		       COALESCE(master_record_tenants_timezone, 'Europe/London')                    AS master_record_tenants_timezone,
		       COALESCE(master_record_tenants_date_format, 'DD/MM/YYYY')                    AS master_record_tenants_date_format,
		       COALESCE(master_record_tenants_datetime_format, 'DD/MM/YYYY HH:mm')          AS master_record_tenants_datetime_format,
		       COALESCE(master_record_tenants_workdays, ARRAY['mon','tue','wed','thu','fri']::text[]) AS master_record_tenants_workdays,
		       COALESCE(master_record_tenants_week_start, 'mon')                            AS master_record_tenants_week_start,
		       COALESCE(master_record_tenants_rank_method, 'dragdrop')                      AS master_record_tenants_rank_method,
		       COALESCE(master_record_tenants_build_changeset_tracking, FALSE)              AS master_record_tenants_build_changeset_tracking,
		       master_record_tenants_notes,
		       master_record_tenants_created_at,
		       master_record_tenants_updated_at,
		       master_record_tenants_archived_at
		  FROM master_record_tenants
		 WHERE master_record_tenants_id_subscription = $1
	`

// sqlUpdateTenantTemplate is the sparse-UPDATE shell. First %s holds
// the comma-separated `col = $N` SET clause; %d holds the $N for the
// WHERE master_record_tenants_id_subscription bind.
const sqlUpdateTenantTemplate = `UPDATE master_record_tenants SET %s WHERE master_record_tenants_id_subscription = $%d`
