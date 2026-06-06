-- ============================================================
-- Migration 004 DOWN: revert dev_reports 'architecture' addition
-- ============================================================
-- Drops the extended CHECK and restores the 8-type allow-list
-- (the post-003 state, with 'system' but without 'architecture').
-- WILL FAIL LOUDLY if any `type='architecture'` rows exist —
-- by design. Operator must delete or retype them (e.g. ARC001)
-- before this migration can run.
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

DELETE FROM schema_migrations WHERE filename = '004_dev_reports_add_architecture.sql';

COMMIT;
