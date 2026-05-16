-- ============================================================
-- 067_rename_master_record_tenants_to_workspaces_DOWN.sql
--
-- Rollback for 067. Reverses the table + column + index +
-- constraint + trigger renames, restoring the master_record_tenants
-- naming exactly as it stood after migration 063.
-- ============================================================

BEGIN;

-- ---- 1. Drop the new trigger ----
DROP TRIGGER IF EXISTS trg_master_record_workspaces_touch_updated_at ON master_record_workspaces;

-- ---- 2. Table rename back ----
ALTER TABLE master_record_workspaces RENAME TO master_record_tenants;

-- ---- 3. Trigger function — restore under old name ----
CREATE OR REPLACE FUNCTION fn_master_record_tenant_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.master_record_tenants_updated_at := now();
    RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS fn_master_record_workspaces_touch_updated_at();

-- ---- 4. Check constraint renames back ----
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_workspaces_primary_contact_email_format TO master_record_tenants_primary_contact_email_format;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_workspaces_data_region_check            TO master_record_tenants_data_region_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_workspaces_date_format_check            TO master_record_tenants_date_format_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_workspaces_datetime_format_check        TO master_record_tenants_datetime_format_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_workspaces_rank_method_check            TO master_record_tenants_rank_method_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_workspaces_week_start_check             TO master_record_tenants_week_start_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_workspaces_workdays_valid               TO master_record_tenants_workdays_valid;

-- ---- 5. Index renames back ----
ALTER INDEX master_record_workspaces_pkey                  RENAME TO master_record_tenants_pkey;
ALTER INDEX idx_master_record_workspaces_archived_at       RENAME TO idx_master_record_tenants_archived_at;
ALTER INDEX idx_master_record_workspaces_id_user_owner     RENAME TO idx_master_record_tenants_id_user_owner;

-- ---- 6. Column renames back (17 columns) ----
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_id_workspace             TO master_record_tenants_id_workspace;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_name                     TO master_record_tenants_name;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_description              TO master_record_tenants_description;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_id_user_owner            TO master_record_tenants_id_user_owner;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_primary_contact_email    TO master_record_tenants_primary_contact_email;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_data_region              TO master_record_tenants_data_region;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_timezone                 TO master_record_tenants_timezone;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_date_format              TO master_record_tenants_date_format;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_datetime_format          TO master_record_tenants_datetime_format;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_workdays                 TO master_record_tenants_workdays;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_week_start               TO master_record_tenants_week_start;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_rank_method              TO master_record_tenants_rank_method;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_build_changeset_tracking TO master_record_tenants_build_changeset_tracking;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_notes                    TO master_record_tenants_notes;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_created_at               TO master_record_tenants_created_at;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_updated_at               TO master_record_tenants_updated_at;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_workspaces_archived_at              TO master_record_tenants_archived_at;

-- ---- 7. Re-create the trigger under the old name + function ----
CREATE TRIGGER trg_master_record_tenant_touch_updated_at
    BEFORE UPDATE ON master_record_tenants
    FOR EACH ROW EXECUTE FUNCTION fn_master_record_tenant_touch_updated_at();

COMMIT;
