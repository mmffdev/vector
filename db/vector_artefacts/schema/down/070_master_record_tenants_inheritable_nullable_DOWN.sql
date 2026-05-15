-- ============================================================
-- 070_master_record_tenants_inheritable_nullable_DOWN.sql
--
-- Rollback for 070. Re-imposes NOT NULL on the 8 inheritable cols
-- that we relaxed. COALESCE any NULLs back to the schema defaults
-- first (PG refuses NOT NULL with existing nulls).
-- ============================================================

BEGIN;

UPDATE master_record_tenants SET
    master_record_tenants_data_region              = COALESCE(master_record_tenants_data_region,              'use1'),
    master_record_tenants_timezone                 = COALESCE(master_record_tenants_timezone,                 'Europe/London'),
    master_record_tenants_date_format              = COALESCE(master_record_tenants_date_format,              'DD/MM/YYYY'),
    master_record_tenants_datetime_format          = COALESCE(master_record_tenants_datetime_format,          'DD/MM/YYYY HH:mm'),
    master_record_tenants_workdays                 = COALESCE(master_record_tenants_workdays,                 ARRAY['mon','tue','wed','thu','fri']),
    master_record_tenants_week_start               = COALESCE(master_record_tenants_week_start,               'mon'),
    master_record_tenants_rank_method              = COALESCE(master_record_tenants_rank_method,              'dragdrop'),
    master_record_tenants_build_changeset_tracking = COALESCE(master_record_tenants_build_changeset_tracking, false);

ALTER TABLE master_record_tenants
    ALTER COLUMN master_record_tenants_data_region              SET NOT NULL,
    ALTER COLUMN master_record_tenants_timezone                 SET NOT NULL,
    ALTER COLUMN master_record_tenants_date_format              SET NOT NULL,
    ALTER COLUMN master_record_tenants_datetime_format          SET NOT NULL,
    ALTER COLUMN master_record_tenants_workdays                 SET NOT NULL,
    ALTER COLUMN master_record_tenants_week_start               SET NOT NULL,
    ALTER COLUMN master_record_tenants_rank_method              SET NOT NULL,
    ALTER COLUMN master_record_tenants_build_changeset_tracking SET NOT NULL;

COMMIT;
