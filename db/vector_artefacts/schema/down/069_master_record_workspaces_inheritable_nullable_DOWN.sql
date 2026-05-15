-- ============================================================
-- 069_master_record_workspaces_inheritable_nullable_DOWN.sql
--
-- Rollback for 069. Re-imposes NOT NULL on the 8 inheritable
-- columns that we relaxed. First populates any NULLs back to the
-- schema default for that column (matches the original defaults
-- in mig 067/068) — required because PG refuses to add NOT NULL
-- if any NULLs exist.
-- ============================================================

BEGIN;

UPDATE master_record_workspaces SET
    master_record_workspaces_data_region              = COALESCE(master_record_workspaces_data_region,              'use1'),
    master_record_workspaces_timezone                 = COALESCE(master_record_workspaces_timezone,                 'Europe/London'),
    master_record_workspaces_date_format              = COALESCE(master_record_workspaces_date_format,              'DD/MM/YYYY'),
    master_record_workspaces_datetime_format          = COALESCE(master_record_workspaces_datetime_format,          'DD/MM/YYYY HH:mm'),
    master_record_workspaces_workdays                 = COALESCE(master_record_workspaces_workdays,                 ARRAY['mon','tue','wed','thu','fri']),
    master_record_workspaces_week_start               = COALESCE(master_record_workspaces_week_start,               'mon'),
    master_record_workspaces_rank_method              = COALESCE(master_record_workspaces_rank_method,              'dragdrop'),
    master_record_workspaces_build_changeset_tracking = COALESCE(master_record_workspaces_build_changeset_tracking, false);

ALTER TABLE master_record_workspaces
    ALTER COLUMN master_record_workspaces_data_region              SET NOT NULL,
    ALTER COLUMN master_record_workspaces_timezone                 SET NOT NULL,
    ALTER COLUMN master_record_workspaces_date_format              SET NOT NULL,
    ALTER COLUMN master_record_workspaces_datetime_format          SET NOT NULL,
    ALTER COLUMN master_record_workspaces_workdays                 SET NOT NULL,
    ALTER COLUMN master_record_workspaces_week_start               SET NOT NULL,
    ALTER COLUMN master_record_workspaces_rank_method              SET NOT NULL,
    ALTER COLUMN master_record_workspaces_build_changeset_tracking SET NOT NULL;

COMMIT;
