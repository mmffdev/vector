-- ============================================================
-- 070_master_record_tenants_inheritable_nullable.sql
--
-- PLA-0051 / Story 3 follow-on. Mirror of mig 069 at the tenant tier:
-- make the inheritable columns on master_record_tenants nullable so
-- a tenant can carry NULL for "no org-wide value set; system default
-- applies" — same semantics workspaces have post-069.
--
-- Why this exists: the test TestGet_BothNull_SourceIsSystemDefault
-- in PLA-0051 Story 1 asserts that when both workspace + tenant are
-- NULL, the merge falls through to the schema default. Without 070
-- the tenant columns are NOT NULL so the test setup can't construct
-- the "both NULL" state.
--
-- In production this also matters: a freshly-provisioned tenant
-- (subscription-create path) carries the schema defaults today via
-- the column defaults; after 070 that path can opt to leave NULLs
-- and let workspaces inherit from "system default" until a global
-- admin explicitly sets tenant-tier values. Symmetric with 069.
--
-- The 11 inheritable columns (matches 069):
--   - data_region, timezone
--   - date_format, datetime_format
--   - workdays, week_start
--   - rank_method, build_changeset_tracking
--   - primary_contact_email
--   - description, notes
--
-- DOWN: re-imposes NOT NULL after coalescing NULLs back to defaults
-- (same shape as 069 DOWN).
-- ============================================================

BEGIN;

ALTER TABLE master_record_tenants
    ALTER COLUMN master_record_tenants_data_region              DROP NOT NULL,
    ALTER COLUMN master_record_tenants_timezone                 DROP NOT NULL,
    ALTER COLUMN master_record_tenants_date_format              DROP NOT NULL,
    ALTER COLUMN master_record_tenants_datetime_format          DROP NOT NULL,
    ALTER COLUMN master_record_tenants_workdays                 DROP NOT NULL,
    ALTER COLUMN master_record_tenants_week_start               DROP NOT NULL,
    ALTER COLUMN master_record_tenants_rank_method              DROP NOT NULL,
    ALTER COLUMN master_record_tenants_build_changeset_tracking DROP NOT NULL;

-- The other three were already nullable per the original schema
-- (primary_contact_email, description, notes) — no-op for those.

-- Sanity check.
DO $$
DECLARE not_nullable_count int;
BEGIN
    SELECT COUNT(*) INTO not_nullable_count
      FROM information_schema.columns
     WHERE table_name = 'master_record_tenants'
       AND column_name IN (
         'master_record_tenants_data_region',
         'master_record_tenants_timezone',
         'master_record_tenants_date_format',
         'master_record_tenants_datetime_format',
         'master_record_tenants_workdays',
         'master_record_tenants_week_start',
         'master_record_tenants_rank_method',
         'master_record_tenants_build_changeset_tracking'
       )
       AND is_nullable = 'NO';
    IF not_nullable_count <> 0 THEN
        RAISE EXCEPTION 'mig 070 invariant: expected 0 NOT-NULL inheritable cols on master_record_tenants, found %', not_nullable_count;
    END IF;
END $$;

COMMIT;
