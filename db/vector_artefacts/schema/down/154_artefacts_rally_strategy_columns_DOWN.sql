-- ============================================================
-- 154_artefacts_rally_strategy_columns_DOWN.sql
--
-- Reverses 154 — drops the 2 CHECK constraints and the 2
-- strategy-* columns.
-- ============================================================

BEGIN;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_strategic_job_size_nonneg_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_strategic_preliminary_estimate_value_nonneg_chk;
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_strategic_job_size,
    DROP COLUMN IF EXISTS artefacts_strategic_preliminary_estimate_value;
COMMIT;
