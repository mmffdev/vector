-- ============================================================
-- 260_fix_updated_at_triggers_RF1_5_5.sql
--
-- RF1.5.5 — Wave-4 trigger-function repair (mmff_vector side).
--
-- Repairs the same latent defect that 256 fixed for waves 1+2+3:
-- the shared `set_updated_at()` function references NEW.updated_at,
-- but tables swept in this wave (257–259) now expose the column as
-- `<table>_updated_at`. Any UPDATE on a swept table throws:
--   ERROR:  record "new" has no field "updated_at"
--
-- Per-table function pattern from 256: one tightly-scoped function
-- per swept table, trigger re-bound to it. Avoids the dynamic
-- TG_TABLE_NAME / EXECUTE format() route (works but ~10× slower
-- per row and obscures intent).
--
-- mmff_vector tables touched in wave 4:
--   - users_custom_page_views (257)
--   - users_custom_pages       (258)
--   - master_record_workspaces (259)
--
-- The shared set_updated_at() is left intact for the remaining
-- unswept tables in mmff_vector — their waves will move them onto
-- per-table functions. Final cleanup that drops the shared
-- set_updated_at() happens after every table is swept.
-- ============================================================

BEGIN;

-- ---- users_custom_page_views ----
CREATE OR REPLACE FUNCTION users_custom_page_views_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_custom_page_views_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_custom_page_views_updated_at ON users_custom_page_views;
CREATE TRIGGER trg_users_custom_page_views_updated_at
    BEFORE UPDATE ON users_custom_page_views
    FOR EACH ROW EXECUTE FUNCTION users_custom_page_views_set_updated_at();

-- ---- users_custom_pages ----
CREATE OR REPLACE FUNCTION users_custom_pages_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_custom_pages_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_custom_pages_updated_at ON users_custom_pages;
CREATE TRIGGER trg_users_custom_pages_updated_at
    BEFORE UPDATE ON users_custom_pages
    FOR EACH ROW EXECUTE FUNCTION users_custom_pages_set_updated_at();

-- ---- master_record_workspaces ----
CREATE OR REPLACE FUNCTION master_record_workspaces_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.master_record_workspaces_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_master_record_workspaces_updated_at ON master_record_workspaces;
CREATE TRIGGER trg_master_record_workspaces_updated_at
    BEFORE UPDATE ON master_record_workspaces
    FOR EACH ROW EXECUTE FUNCTION master_record_workspaces_set_updated_at();

COMMIT;
