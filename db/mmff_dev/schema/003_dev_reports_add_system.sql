-- ============================================================
-- Migration 003: dev_reports.type — add 'system' to CHECK
-- ============================================================
-- Purpose: extend the dev_reports.type allow-list with 'system'
-- so the new `<report> -sy` flag can file System papers
-- (developer-facing explainers of a section/feature of the
-- codebase — what it is, how it works, I/O, how to use).
--
-- Postgres auto-generated the original constraint name
-- `dev_reports_type_check` when the table was created by
-- migration 002. Drop + re-add with the extended set.
--
-- Keep in sync with:
--   backend/internal/devreports/types.go  (ValidTypes slice)
--   app/lib/apiSite/index.ts              (DevReportType union)
--   dev/pages/DevReportingPanel.tsx       (TYPE_TABS)
-- ============================================================

BEGIN;

ALTER TABLE dev_reports
    DROP CONSTRAINT dev_reports_type_check;

ALTER TABLE dev_reports
    ADD CONSTRAINT dev_reports_type_check
    CHECK (type IN (
        'research','plan','security','retro',
        'code','api','misc','system'
    ));

INSERT INTO schema_migrations (filename) VALUES ('003_dev_reports_add_system.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
