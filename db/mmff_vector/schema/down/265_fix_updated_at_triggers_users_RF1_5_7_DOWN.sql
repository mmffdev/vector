-- ============================================================
-- 265_fix_updated_at_triggers_users_RF1_5_7_DOWN.sql
--
-- Reverses 265_fix_updated_at_triggers_users_RF1_5_7.sql.
--
-- Restores the shared set_updated_at() binding on users. Drops the
-- per-table users_set_updated_at(). For
-- fn_users_role_change_cascade_nav_prefs() this DOWN restores the
-- pre-264 function body (referencing NEW.id / OLD.role_id /
-- NEW.role_id + p.id / p.key_enum) but DOES NOT re-create the
-- trigger binding — the trigger's WHEN clause references a
-- column name that only exists after 264_DOWN reverts columns. The
-- trigger re-creation is therefore deferred to 264_DOWN's tail.
-- Apply order: 265_DOWN, then 264_DOWN.
-- ============================================================

BEGIN;

-- ---- Restore shared set_updated_at on users ----
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP FUNCTION IF EXISTS users_set_updated_at();

-- ---- Drop the role-change cascade trigger ----
-- (264_DOWN re-creates it bound on pre-264 column `role_id`.)
DROP TRIGGER IF EXISTS trg_users_role_change_cascade_nav_prefs ON users;

-- ---- Restore fn_users_role_change_cascade_nav_prefs body ----
--
-- This restores the function body that referenced NEW.id /
-- OLD.role_id / NEW.role_id and p.id / p.key_enum. plpgsql function
-- bodies are not validated against column existence at CREATE
-- time (unless check_function_bodies = on), so this CREATE OR
-- REPLACE succeeds even though the columns it references won't
-- exist again until 264_DOWN runs. The function only executes when
-- the trigger fires, and 264_DOWN re-binds the trigger after the
-- columns are reverted.
CREATE OR REPLACE FUNCTION fn_users_role_change_cascade_nav_prefs()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
        RETURN NEW;
    END IF;

    WITH deleted AS (
        DELETE FROM users_nav_prefs np
         WHERE np.users_nav_prefs_id_user = NEW.id
           AND NOT EXISTS (
               SELECT 1
                 FROM pages p
                 JOIN users_roles_pages urp
                   ON urp.users_roles_pages_id_page = p.id
                WHERE p.key_enum = np.users_nav_prefs_item_key
                  AND urp.users_roles_pages_id_role = NEW.role_id
           )
        RETURNING users_nav_prefs_id_subscription AS sub_id,
                  users_nav_prefs_id_profile      AS prof_id
    ),
    cleared AS (
        UPDATE users_nav_profiles unp
           SET users_nav_profiles_start_page_key = NULL
         WHERE unp.users_nav_profiles_id_user = NEW.id
           AND unp.users_nav_profiles_start_page_key IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
                 FROM pages p
                 JOIN users_roles_pages urp
                   ON urp.users_roles_pages_id_page = p.id
                WHERE p.key_enum = unp.users_nav_profiles_start_page_key
                  AND urp.users_roles_pages_id_role = NEW.role_id
           )
        RETURNING users_nav_profiles_id_subscription AS sub_id,
                  users_nav_profiles_id              AS prof_id
    ),
    distinct_profiles AS (
        SELECT DISTINCT sub_id, prof_id FROM deleted
        UNION
        SELECT DISTINCT sub_id, prof_id FROM cleared
    )
    SELECT fn_users_nav_prefs_resequence(NEW.id, sub_id, prof_id)
      FROM distinct_profiles;

    RETURN NEW;
END;
$$;

COMMIT;
