-- ============================================================
-- Migration 004: dev_reports.type — add 'architecture' to CHECK
-- ============================================================
-- Purpose: extend the dev_reports.type allow-list with
-- 'architecture' so the new `<report> -a` flag can file the
-- living Architecture Site Map (ARC001) — every Rail1 bucket,
-- page, purpose, component tree + reverse used-by registry.
--
-- Mirrors migration 003 (which added 'system'). Postgres
-- auto-generated the constraint name `dev_reports_type_check`
-- on table create (migration 002); drop + re-add with the
-- extended set.
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
        'code','api','misc','system','architecture'
    ));

INSERT INTO schema_migrations (filename) VALUES ('004_dev_reports_add_architecture.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
