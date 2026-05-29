-- ============================================================
-- 150_artefacts_rally_universal_columns_DOWN.sql
--
-- Reverses 150 — drops the GIN partial index, the actuals CHECK
-- constraint, and the three columns.
--
-- DESTRUCTIVE: dropping artefacts_tags loses any tag arrays
-- written into the column.
-- ============================================================

BEGIN;
DROP INDEX IF EXISTS idx_artefacts_tags_gin;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_actuals_nonneg_chk;
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_actuals,
    DROP COLUMN IF EXISTS artefacts_tags,
    DROP COLUMN IF EXISTS artefacts_actual_end_date;
COMMIT;
