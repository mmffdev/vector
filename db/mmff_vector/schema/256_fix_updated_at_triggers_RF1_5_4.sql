-- ============================================================
-- 256_fix_updated_at_triggers_RF1_5_4.sql
--
-- RF1.5.4 — Wave-1+2+3 trigger-function repair.
--
-- The shared `set_updated_at()` function and several per-table
-- variants reference NEW.updated_at — but after the column-prefix
-- sweep their target column is now `<table>_updated_at`. Any UPDATE
-- to a swept table throws:
--   ERROR:  record "new" has no field "updated_at"
--   CONTEXT: PL/pgSQL assignment "NEW.updated_at = NOW()"
--
-- This migration replaces each broken function body in mmff_vector
-- with a body that references the correctly-prefixed column. We
-- create one tightly-scoped function per swept table rather than
-- the dynamic TG_TABLE_NAME / EXECUTE format() pattern (the dynamic
-- approach works but is ~10× slower per row and obscures intent).
--
-- Per-table functions REPLACE the trigger's binding so each table
-- only ever fires its own column-correct function.
--
-- mmff_vector tables touched here:
--   wave-1: cost_centres, library_help_defaults, users_tab_order
--   wave-1 (no-op — function body already correct or trigger uses
--     pre-existing correctly-named function): pages_addressables,
--     pages_help — left untouched.
--
-- Tables that USE the shared set_updated_at() in mmff_vector but
-- have NOT been swept yet stay on the shared function as-is until
-- their wave; their wave's migration will move them onto a
-- per-table function with the correct prefixed column. The shared
-- set_updated_at() is left intact for those unswept tables.
--
-- After the column-prefix sweep is complete on every table, a
-- final cleanup will drop the shared set_updated_at() entirely.
-- ============================================================

BEGIN;

-- ---- cost_centres ----
CREATE OR REPLACE FUNCTION cost_centres_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.cost_centres_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cost_centres_updated_at ON cost_centres;
CREATE TRIGGER trg_cost_centres_updated_at
    BEFORE UPDATE ON cost_centres
    FOR EACH ROW EXECUTE FUNCTION cost_centres_set_updated_at();

-- ---- library_help_defaults ----
CREATE OR REPLACE FUNCTION library_help_defaults_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.library_help_defaults_updated_at = NOW();
    RETURN NEW;
END;
$$;

-- (trigger binding unchanged — library_help_defaults_updated_at trigger
--  already points at the per-table function; only the body changes)

-- ---- users_tab_order ----
CREATE OR REPLACE FUNCTION users_tab_order_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_tab_order_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_tab_order_updated_at ON users_tab_order;
CREATE TRIGGER trg_users_tab_order_updated_at
    BEFORE UPDATE ON users_tab_order
    FOR EACH ROW EXECUTE FUNCTION users_tab_order_set_updated_at();

COMMIT;
