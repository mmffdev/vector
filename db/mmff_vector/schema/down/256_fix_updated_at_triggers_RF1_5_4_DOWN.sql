-- ============================================================
-- DOWN: 256_fix_updated_at_triggers_RF1_5_4_DOWN.sql
-- Reverts each per-table function body to use NEW.updated_at,
-- restoring the latent (broken) wave-1 state. Trigger names also
-- restored. Use only if you've also reverted 251–255.
-- ============================================================

BEGIN;

-- cost_centres: restore trigger to point at shared set_updated_at()
DROP TRIGGER IF EXISTS trg_cost_centres_updated_at ON cost_centres;
CREATE TRIGGER trg_cost_centres_updated_at
    BEFORE UPDATE ON cost_centres
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS cost_centres_set_updated_at();

-- library_help_defaults: restore function body
CREATE OR REPLACE FUNCTION library_help_defaults_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- users_tab_order: restore trigger name + binding to shared function
DROP TRIGGER IF EXISTS trg_users_tab_order_updated_at ON users_tab_order;
CREATE TRIGGER trg_user_tab_order_updated_at
    BEFORE UPDATE ON users_tab_order
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS users_tab_order_set_updated_at();

COMMIT;
