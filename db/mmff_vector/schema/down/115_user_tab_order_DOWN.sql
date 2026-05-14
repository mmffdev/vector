-- 115_user_tab_order_DOWN.sql
--
-- Drops user_tab_order, its indexes, constraints and trigger.
-- Reverses 115_user_tab_order.sql cleanly.

BEGIN;

DROP TRIGGER IF EXISTS trg_user_tab_order_updated_at ON user_tab_order;
DROP INDEX IF EXISTS idx_user_tab_order_lookup;
DROP TABLE IF EXISTS user_tab_order;

COMMIT;
