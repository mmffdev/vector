-- ============================================================
-- DOWN: 263_fix_updated_at_triggers_pages_subscriptions_RF1_5_6_DOWN.sql
--
-- Reverts wave-5 trigger-function repair. Restores each trigger
-- binding to the shared set_updated_at() function, drops the
-- per-table functions, and restores fn_pages_cascade_nav_prefs()
-- to its OLD.key_enum body. Use only if you've also reverted
-- 261 + 262.
-- ============================================================

BEGIN;

-- pages: restore trigger to shared set_updated_at()
DROP TRIGGER IF EXISTS trg_pages_updated_at ON pages;
CREATE TRIGGER trg_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS pages_set_updated_at();

-- subscriptions: restore trigger to shared set_updated_at()
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS subscriptions_set_updated_at();

-- fn_pages_cascade_nav_prefs: restore OLD.key_enum body
CREATE OR REPLACE FUNCTION fn_pages_cascade_nav_prefs()
RETURNS trigger AS $$
DECLARE
    v_page_key text := OLD.key_enum;
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
