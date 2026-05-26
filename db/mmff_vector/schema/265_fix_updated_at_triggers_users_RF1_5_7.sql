-- ============================================================
-- 265_fix_updated_at_triggers_users_RF1_5_7.sql
--
-- RF1.5.7 — Wave-6a trigger-function repair (mmff_vector side).
--
-- Repairs the same latent defect that 256 / 260 / 263 fixed for
-- earlier waves: the shared `set_updated_at()` function references
-- NEW.updated_at, but the table swept in this wave (264) now
-- exposes the column as `users_updated_at`. Any UPDATE on the
-- swept table throws:
--   ERROR:  record "new" has no field "updated_at"
--
-- Per-table function pattern from 256 / 260 / 263: one
-- tightly-scoped function per swept table, trigger re-bound to it.
--
-- ALSO repairs `fn_users_role_change_cascade_nav_prefs()` which
-- references NEW.id / OLD.role_id / NEW.role_id (now NEW.users_id /
-- OLD.users_id_role / NEW.users_id_role post-264). The function
-- ALSO joins against pages.id + pages.key_enum — both columns are
-- already swept to pages_id / pages_key_enum (migration 261), and
-- the function body was NOT updated when 261 shipped (only
-- fn_pages_cascade_nav_prefs was repaired in 263). So this single
-- migration carries the full repair: the WHEN clause column names
-- on the trigger binding, the new NEW/OLD references, AND the
-- pages join column references.
--
-- mmff_vector tables touched in wave 6a:
--   - users (264)
--
-- The shared set_updated_at() is left intact for the remaining
-- unswept tables in mmff_vector — their waves will move them onto
-- per-table functions. Final cleanup that drops the shared
-- set_updated_at() happens after every table is swept.
-- ============================================================

BEGIN;

-- ---- users.set_updated_at ----
CREATE OR REPLACE FUNCTION users_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION users_set_updated_at();

-- ---- fn_users_role_change_cascade_nav_prefs: repoint to swept columns ----
--
-- Pre-264 references:
--   NEW.id            -> NEW.users_id
--   OLD.role_id       -> OLD.users_id_role
--   NEW.role_id       -> NEW.users_id_role
-- Pre-261 references inside the function body (never repaired):
--   pages p ... p.id         -> p.pages_id
--   p.key_enum               -> p.pages_key_enum
--
-- Also re-create the trigger binding so its WHEN-clause column
-- name (it's bound `AFTER UPDATE OF role_id`) tracks the rename
-- to users_id_role.
CREATE OR REPLACE FUNCTION fn_users_role_change_cascade_nav_prefs()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- No-op if the role didn't change.
    IF NEW.users_id_role IS NOT DISTINCT FROM OLD.users_id_role THEN
        RETURN NEW;
    END IF;

    -- Delete prefs rows for pages the new role can't reach.
    WITH deleted AS (
        DELETE FROM users_nav_prefs np
         WHERE np.users_nav_prefs_id_user = NEW.users_id
           AND NOT EXISTS (
               SELECT 1
                 FROM pages p
                 JOIN users_roles_pages urp
                   ON urp.users_roles_pages_id_page = p.pages_id
                WHERE p.pages_key_enum = np.users_nav_prefs_item_key
                  AND urp.users_roles_pages_id_role = NEW.users_id_role
           )
        RETURNING users_nav_prefs_id_subscription AS sub_id,
                  users_nav_prefs_id_profile      AS prof_id
    ),
    cleared AS (
        UPDATE users_nav_profiles unp
           SET users_nav_profiles_start_page_key = NULL
         WHERE unp.users_nav_profiles_id_user = NEW.users_id
           AND unp.users_nav_profiles_start_page_key IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
                 FROM pages p
                 JOIN users_roles_pages urp
                   ON urp.users_roles_pages_id_page = p.pages_id
                WHERE p.pages_key_enum = unp.users_nav_profiles_start_page_key
                  AND urp.users_roles_pages_id_role = NEW.users_id_role
           )
        RETURNING users_nav_profiles_id_subscription AS sub_id,
                  users_nav_profiles_id              AS prof_id
    ),
    distinct_profiles AS (
        SELECT DISTINCT sub_id, prof_id FROM deleted
        UNION
        SELECT DISTINCT sub_id, prof_id FROM cleared
    )
    SELECT fn_users_nav_prefs_resequence(NEW.users_id, sub_id, prof_id)
      FROM distinct_profiles;

    RETURN NEW;
END;
$$;

-- Re-bind the trigger so its `UPDATE OF role_id` clause tracks
-- the rename to `users_id_role`.
DROP TRIGGER IF EXISTS trg_users_role_change_cascade_nav_prefs ON users;
CREATE TRIGGER trg_users_role_change_cascade_nav_prefs
    AFTER UPDATE OF users_id_role ON users
    FOR EACH ROW EXECUTE FUNCTION fn_users_role_change_cascade_nav_prefs();

COMMIT;
