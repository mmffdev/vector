-- ============================================================
-- 063_master_record_tenants_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (2 of N).
--
-- Applies the §2.3 column-prefix convention to master_record_tenants.
-- The PK is also a FK to mmff_vector.workspaces.id (no Postgres-level
-- FK across DBs — invariant enforced by tenantmasterrecord.Service);
-- per §2.4 it carries the FK shape: <table>_id_<target>.
--
-- All other columns gain the master_record_tenants_ prefix, replacing
-- the legacy tenant_* prefix that referenced the old singular table
-- name. Index + check constraint + trigger function names normalised
-- to match. JSON wire tags on the Go Settings struct stay as-is
-- (deferred per TD-NAME-001 §2.9 trade-off; tracked separately).
-- ============================================================

BEGIN;

-- ---- Column renames (17 columns) ----

ALTER TABLE master_record_tenants RENAME COLUMN workspace_id                    TO master_record_tenants_id_workspace;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_name                     TO master_record_tenants_name;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_description             TO master_record_tenants_description;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_owner_user_id            TO master_record_tenants_id_user_owner;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_primary_contact_email    TO master_record_tenants_primary_contact_email;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_data_region              TO master_record_tenants_data_region;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_timezone                 TO master_record_tenants_timezone;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_date_format              TO master_record_tenants_date_format;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_datetime_format          TO master_record_tenants_datetime_format;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_workdays                 TO master_record_tenants_workdays;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_week_start               TO master_record_tenants_week_start;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_rank_method              TO master_record_tenants_rank_method;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_build_changeset_tracking TO master_record_tenants_build_changeset_tracking;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_notes                    TO master_record_tenants_notes;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_created_at               TO master_record_tenants_created_at;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_updated_at               TO master_record_tenants_updated_at;
ALTER TABLE master_record_tenants RENAME COLUMN tenant_archived_at              TO master_record_tenants_archived_at;

-- ---- Index renames ----

ALTER INDEX master_record_tenant_pkey                  RENAME TO master_record_tenants_pkey;
ALTER INDEX idx_master_record_tenant_archived_at       RENAME TO idx_master_record_tenants_archived_at;
ALTER INDEX idx_master_record_tenant_owner_user_id     RENAME TO idx_master_record_tenants_id_user_owner;

-- ---- Check constraint renames ----

ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenant_email_format                  TO master_record_tenants_primary_contact_email_format;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenant_tenant_data_region_check      TO master_record_tenants_data_region_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenant_tenant_date_format_check      TO master_record_tenants_date_format_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenant_tenant_datetime_format_check  TO master_record_tenants_datetime_format_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenant_tenant_rank_method_check      TO master_record_tenants_rank_method_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenant_tenant_week_start_check       TO master_record_tenants_week_start_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenant_workdays_valid                TO master_record_tenants_workdays_valid;

-- ---- Trigger function rewrite ----
-- The function name keeps the singular form (function names are not
-- table-prefixed by convention) but the column reference inside must
-- update to the new prefixed column name.

CREATE OR REPLACE FUNCTION fn_master_record_tenant_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.master_record_tenants_updated_at := now();
    RETURN NEW;
END;
$$;

COMMIT;
