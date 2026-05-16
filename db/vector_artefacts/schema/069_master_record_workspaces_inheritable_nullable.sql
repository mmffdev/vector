-- ============================================================
-- 069_master_record_workspaces_inheritable_nullable.sql
--
-- PLA-0051 / Story 2 — make inheritable columns nullable on
-- master_record_workspaces so workspaces can store NULL to mean
-- "inherit from tenant" (the read-side COALESCE merge lands in
-- Story 3 / Service.Get).
--
-- DECISION recorded in PLA-0051 status_note (2026-05-15, Rick):
-- Option A — nullable columns, NULL = inherit. No new boolean
-- inherit_* columns.
--
-- The 11 inheritable columns (mirrors the canonical list in
-- backend/internal/workspacemasterrecord/service_inheritance_test.go):
--   - data_region, timezone
--   - date_format, datetime_format
--   - workdays, week_start
--   - rank_method, build_changeset_tracking
--   - primary_contact_email
--   - description, notes
--
-- Schema defaults are PRESERVED — direct INSERT INTO
-- master_record_workspaces (id_workspace) still populates the
-- columns with sensible system defaults (Europe/London, DD/MM/YYYY,
-- mon-fri, use1, etc.). The defaults still serve as the "system
-- default" fallback for the source-marker contract.
--
-- BACKFILL DELIBERATELY OMITTED: only one workspace row exists in
-- master_record_workspaces today (audited 2026-05-15 during PLA-0051
-- Story 2 scoping). New workspaces opt into inheritance via the
-- auto-create path (which still uses defaults — they appear as
-- workspace-level explicit values until the workspace's settings
-- editor flips them to inherit via PATCH ClearOverrides). A separate
-- bulk-null-matching-values migration can land later if the workspace
-- count grows and accumulates redundant explicit values.
--
-- DOWN migration: 069_DOWN restores NOT NULL. Safe because we kept
-- the defaults — any NULL inserted between UP and DOWN gets coerced
-- back to the default by an UPDATE before the NOT NULL re-add.
-- ============================================================

BEGIN;

ALTER TABLE master_record_workspaces
    ALTER COLUMN master_record_workspaces_data_region              DROP NOT NULL,
    ALTER COLUMN master_record_workspaces_timezone                 DROP NOT NULL,
    ALTER COLUMN master_record_workspaces_date_format              DROP NOT NULL,
    ALTER COLUMN master_record_workspaces_datetime_format          DROP NOT NULL,
    ALTER COLUMN master_record_workspaces_workdays                 DROP NOT NULL,
    ALTER COLUMN master_record_workspaces_week_start               DROP NOT NULL,
    ALTER COLUMN master_record_workspaces_rank_method              DROP NOT NULL,
    ALTER COLUMN master_record_workspaces_build_changeset_tracking DROP NOT NULL;

-- The other three were already nullable per the schema audit
-- (primary_contact_email, description, notes) — no-op for those.

-- Sanity check: confirm the 8 columns are now nullable.
DO $$
DECLARE not_nullable_count int;
BEGIN
    SELECT COUNT(*) INTO not_nullable_count
      FROM information_schema.columns
     WHERE table_name = 'master_record_workspaces'
       AND column_name IN (
         'master_record_workspaces_data_region',
         'master_record_workspaces_timezone',
         'master_record_workspaces_date_format',
         'master_record_workspaces_datetime_format',
         'master_record_workspaces_workdays',
         'master_record_workspaces_week_start',
         'master_record_workspaces_rank_method',
         'master_record_workspaces_build_changeset_tracking'
       )
       AND is_nullable = 'NO';
    IF not_nullable_count <> 0 THEN
        RAISE EXCEPTION 'mig 069 invariant: expected 0 NOT-NULL inheritable cols, found %', not_nullable_count;
    END IF;
END $$;

COMMIT;
