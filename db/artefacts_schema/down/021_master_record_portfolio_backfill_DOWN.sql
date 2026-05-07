-- ============================================================
-- DOWN: M6 (PLA-0026 / story 00481)
-- Reverse the master_record_portfolio backfill — drop the rows that came
-- from this migration and clean up the new fdw_mmff_library server.
--
-- We only delete rows that were inserted by the backfill (those whose
-- adopted_at matches the legacy obj_strategy_types_layers MIN(created_at)
-- proof-of-origin). To keep the down strictly reversible we simply
-- TRUNCATE master_record_portfolio — by the time anyone runs this DOWN
-- there should be no live B-series writers; PLA-0026 hasn't shipped past
-- M6 yet. If that changes, this DOWN must be revisited.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts \
--        -f down/021_master_record_portfolio_backfill_DOWN.sql
-- ============================================================

BEGIN;

TRUNCATE master_record_portfolio;

DROP FOREIGN TABLE IF EXISTS fdw_obj_strategy_types_layers;
DROP FOREIGN TABLE IF EXISTS fdw_portfolio_templates;
DROP SERVER         IF EXISTS fdw_mmff_library CASCADE;

COMMIT;
