-- ============================================================
-- Migration 003 DOWN: revert dev_reports 'system' addition
-- ============================================================
-- Drops the extended CHECK and restores the original 7-type
-- allow-list. WILL FAIL LOUDLY if any `type='system'` rows
-- exist — by design. Operator must delete or retype them
-- before this migration can run.
-- ============================================================

BEGIN;

ALTER TABLE dev_reports
    DROP CONSTRAINT dev_reports_type_check;

ALTER TABLE dev_reports
    ADD CONSTRAINT dev_reports_type_check
    CHECK (type IN (
        'research','plan','security','retro',
        'code','api','misc'
    ));

DELETE FROM schema_migrations WHERE filename = '003_dev_reports_add_system.sql';

COMMIT;
