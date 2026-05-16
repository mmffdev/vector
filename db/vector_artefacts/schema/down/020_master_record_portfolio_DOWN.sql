-- ============================================================
-- DOWN: M5 (PLA-0026 / story 00480)
-- Drop master_record_portfolio + trigger + function.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts \
--        -f down/020_master_record_portfolio_DOWN.sql
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_master_record_portfolio_touch_updated_at
    ON master_record_portfolio;
DROP FUNCTION IF EXISTS fn_master_record_portfolio_touch_updated_at();
DROP TABLE IF EXISTS master_record_portfolio;

COMMIT;
