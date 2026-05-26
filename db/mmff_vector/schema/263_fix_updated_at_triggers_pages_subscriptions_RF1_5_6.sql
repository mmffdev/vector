-- ============================================================
-- 263_fix_updated_at_triggers_pages_subscriptions_RF1_5_6.sql
--
-- RF1.5.6 — Wave-5 trigger-function repair (mmff_vector side).
--
-- Repairs the same latent defect that 256 fixed for waves 1+2+3
-- and 260 fixed for wave 4: the shared `set_updated_at()` function
-- references NEW.updated_at, but tables swept in this wave
-- (261, 262) now expose the column as `<table>_updated_at`. Any
-- UPDATE on a swept table throws:
--   ERROR:  record "new" has no field "updated_at"
--
-- Per-table function pattern from 256: one tightly-scoped function
-- per swept table, trigger re-bound to it. Avoids the dynamic
-- TG_TABLE_NAME / EXECUTE format() route (works but ~10× slower
-- per row and obscures intent).
--
-- mmff_vector tables touched in wave 5:
--   - pages         (261)
--   - subscriptions (262)
--
-- ALSO repairs `fn_pages_cascade_nav_prefs()` which references
-- `OLD.key_enum` — that column is now `pages_key_enum` post-261.
-- The trigger fires AFTER DELETE on pages and would throw the same
-- "record has no field" error on the first delete otherwise. The
-- trigger binding stays unchanged; only the function body changes.
--
-- The shared set_updated_at() is left intact for the remaining
-- unswept tables in mmff_vector — their waves will move them onto
-- per-table functions. Final cleanup that drops the shared
-- set_updated_at() happens after every table is swept.
-- ============================================================

BEGIN;

-- ---- pages.set_updated_at ----
CREATE OR REPLACE FUNCTION pages_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.pages_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pages_updated_at ON pages;
CREATE TRIGGER trg_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW EXECUTE FUNCTION pages_set_updated_at();

-- ---- subscriptions.set_updated_at ----
CREATE OR REPLACE FUNCTION subscriptions_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.subscriptions_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION subscriptions_set_updated_at();

-- ---- fn_pages_cascade_nav_prefs: repoint OLD.key_enum → OLD.pages_key_enum ----
CREATE OR REPLACE FUNCTION fn_pages_cascade_nav_prefs()
RETURNS trigger AS $$
DECLARE
    v_page_key text := OLD.pages_key_enum;
    rec record;
BEGIN
    IF v_page_key IS NULL THEN
        RETURN OLD;
    END IF;

    -- Capture distinct (user, sub, profile) tuples touched by the
    -- delete + clear so we can re-sequence each one exactly once.
    FOR rec IN
        WITH deleted AS (
            DELETE FROM users_nav_prefs
             WHERE users_nav_prefs_item_key = v_page_key
            RETURNING users_nav_prefs_id_user         AS user_id,
                      users_nav_prefs_id_subscription AS sub_id,
                      users_nav_prefs_id_profile      AS prof_id
        ),
        cleared AS (
            UPDATE users_nav_profiles
               SET users_nav_profiles_start_page_key = NULL
             WHERE users_nav_profiles_start_page_key = v_page_key
            RETURNING users_nav_profiles_id_user         AS user_id,
                      users_nav_profiles_id_subscription AS sub_id,
                      users_nav_profiles_id              AS prof_id
        )
        SELECT DISTINCT user_id, sub_id, prof_id FROM deleted
        UNION
        SELECT DISTINCT user_id, sub_id, prof_id FROM cleared
    LOOP
        PERFORM fn_users_nav_prefs_resequence(rec.user_id, rec.sub_id, rec.prof_id);
    END LOOP;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMIT;
