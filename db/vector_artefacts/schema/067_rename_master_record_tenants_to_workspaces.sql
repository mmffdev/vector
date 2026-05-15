-- ============================================================
-- 067_rename_master_record_tenants_to_workspaces.sql
--
-- PLA-0032 / Story 00564 — vocabulary alignment.
--
-- The settings sidecar table for per-workspace locale/calendar/
-- owner data has been called master_record_tenants since it
-- landed in vector_artefacts (migration 036 → renamed plural in
-- 060 → column-prefixed in 063). It is keyed by workspace_id and
-- has always been workspace-scoped — the "tenant" name is a
-- legacy mental model from before the workspace-tier split
-- (R028 §8 Decision A.2, locked 2026-05-02).
--
-- This migration aligns the table's name with what it is. Same
-- row, same FK relationship (master_record_workspaces_id_workspace
-- → mmff_vector.workspaces.id, enforced by Go service since the
-- FK cannot live across DBs), new vocabulary.
--
-- Cross-DB name collision NOTE: mmff_vector already has a table
-- called master_record_workspaces (the workspace anchor identity
-- table, migration 131). After this migration runs, two databases
-- carry the same table name for different purposes:
--   - mmff_vector.master_record_workspaces   = anchor identity
--   - vector_artefacts.master_record_workspaces = settings sidecar
-- This is allowed by docs/c_c_db_routing.md (pool routing); the
-- application is the sole writer of the join across them.
--
-- 17 columns + 3 indexes + 7 check constraints + 1 trigger
-- function get the master_record_workspaces_* prefix to match.
-- ============================================================

BEGIN;

-- ---- 1. Drop the old trigger first (it depends on the function name we will replace) ----
DROP TRIGGER IF EXISTS trg_master_record_tenant_touch_updated_at ON master_record_tenants;

-- ---- 2. Column renames (17 columns) ----

ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_id_workspace             TO master_record_workspaces_id_workspace;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_name                     TO master_record_workspaces_name;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_description              TO master_record_workspaces_description;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_id_user_owner            TO master_record_workspaces_id_user_owner;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_primary_contact_email    TO master_record_workspaces_primary_contact_email;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_data_region              TO master_record_workspaces_data_region;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_timezone                 TO master_record_workspaces_timezone;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_date_format              TO master_record_workspaces_date_format;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_datetime_format          TO master_record_workspaces_datetime_format;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_workdays                 TO master_record_workspaces_workdays;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_week_start               TO master_record_workspaces_week_start;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_rank_method              TO master_record_workspaces_rank_method;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_build_changeset_tracking TO master_record_workspaces_build_changeset_tracking;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_notes                    TO master_record_workspaces_notes;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_created_at               TO master_record_workspaces_created_at;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_updated_at               TO master_record_workspaces_updated_at;
ALTER TABLE master_record_tenants RENAME COLUMN master_record_tenants_archived_at              TO master_record_workspaces_archived_at;

-- ---- 3. Index renames (3 indexes) ----

ALTER INDEX master_record_tenants_pkey                  RENAME TO master_record_workspaces_pkey;
ALTER INDEX idx_master_record_tenants_archived_at       RENAME TO idx_master_record_workspaces_archived_at;
ALTER INDEX idx_master_record_tenants_id_user_owner     RENAME TO idx_master_record_workspaces_id_user_owner;

-- ---- 4. Check constraint renames (7 constraints) ----

ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenants_primary_contact_email_format TO master_record_workspaces_primary_contact_email_format;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenants_data_region_check            TO master_record_workspaces_data_region_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenants_date_format_check            TO master_record_workspaces_date_format_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenants_datetime_format_check        TO master_record_workspaces_datetime_format_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenants_rank_method_check            TO master_record_workspaces_rank_method_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenants_week_start_check             TO master_record_workspaces_week_start_check;
ALTER TABLE master_record_tenants
    RENAME CONSTRAINT master_record_tenants_workdays_valid               TO master_record_workspaces_workdays_valid;

-- ---- 5. Trigger function — rewrite under new name, update body to new column ----

CREATE OR REPLACE FUNCTION fn_master_record_workspaces_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.master_record_workspaces_updated_at := now();
    RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS fn_master_record_tenant_touch_updated_at();

-- ---- 6. Table rename (last, after all dependents are stable) ----

ALTER TABLE master_record_tenants RENAME TO master_record_workspaces;

-- ---- 7. Re-create the trigger under the new name + function ----

CREATE TRIGGER trg_master_record_workspaces_touch_updated_at
    BEFORE UPDATE ON master_record_workspaces
    FOR EACH ROW EXECUTE FUNCTION fn_master_record_workspaces_touch_updated_at();

COMMIT;
