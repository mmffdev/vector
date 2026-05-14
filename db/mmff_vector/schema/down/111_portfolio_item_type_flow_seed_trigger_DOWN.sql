-- ============================================================
-- DOWN: 111_portfolio_item_type_flow_seed_trigger.sql
-- Drops the auto-seed trigger and its function.
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_portfolio_item_types_seed_flow ON portfolio_item_types;
DROP FUNCTION IF EXISTS seed_default_flow_for_portfolio_item_type();

COMMIT;
