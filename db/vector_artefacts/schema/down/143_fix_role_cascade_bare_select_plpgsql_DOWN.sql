-- ============================================================
-- 143_fix_role_cascade_bare_select_plpgsql_DOWN.sql
-- Rollback for 143_fix_role_cascade_bare_select_plpgsql.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
--
-- Re-installs the mig 142 function bodies (which contain the latent
-- bare-SELECT-from-CTE bug that 143 fixed). Only useful if you also
-- need to revert mig 142.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_users_role_change_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.users_id_role IS NOT DISTINCT FROM OLD.users_id_role THEN
        RETURN NEW;
    END IF;

    WITH deleted_pinned AS (
        DELETE FROM users_nav_pinned np
         WHERE np.users_nav_pinned_id_user = NEW.users_id
           AND NOT EXISTS (
               SELECT 1
                 FROM pages p
                 JOIN users_roles_pages urp
                   ON urp.users_roles_pages_id_page = p.pages_id
                WHERE p.pages_key_enum = np.users_nav_pinned_item_key
                  AND urp.users_roles_pages_id_role = NEW.users_id_role
           )
        RETURNING users_nav_pinned_id_subscription AS sub_id,
                  users_nav_pinned_id_profile      AS prof_id
    ),
    deleted_bookmarks AS (
        DELETE FROM users_nav_bookmarks nb
         WHERE nb.users_nav_bookmarks_id_user = NEW.users_id
           AND NOT EXISTS (
               SELECT 1
                 FROM pages p
                 JOIN users_roles_pages urp
                   ON urp.users_roles_pages_id_page = p.pages_id
                WHERE p.pages_key_enum = nb.users_nav_bookmarks_item_key
                  AND urp.users_roles_pages_id_role = NEW.users_id_role
           )
        RETURNING users_nav_bookmarks_id_subscription AS sub_id,
                  users_nav_bookmarks_id_profile      AS prof_id
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
        SELECT DISTINCT sub_id, prof_id FROM deleted_pinned
        UNION
        SELECT DISTINCT sub_id, prof_id FROM deleted_bookmarks
        UNION
        SELECT DISTINCT sub_id, prof_id FROM cleared
    )
    SELECT fn_users_nav_prefs_resequence(NEW.users_id, sub_id, prof_id)
      FROM distinct_profiles;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_users_roles_pages_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_page_key text;
    r record;
BEGIN
    SELECT pages_key_enum INTO v_page_key
      FROM pages
     WHERE pages_id = OLD.users_roles_pages_id_page;
    IF v_page_key IS NULL THEN
        RETURN OLD;
    END IF;

    FOR r IN
        SELECT users_id AS user_id
          FROM users
         WHERE users_id_role = OLD.users_roles_pages_id_role
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM users_roles_pages urp
              JOIN users u ON u.users_id_role = urp.users_roles_pages_id_role
             WHERE u.users_id = r.user_id
               AND urp.users_roles_pages_id_page = OLD.users_roles_pages_id_page
        ) THEN
            WITH deleted_pinned AS (
                DELETE FROM users_nav_pinned
                 WHERE users_nav_pinned_id_user   = r.user_id
                   AND users_nav_pinned_item_key  = v_page_key
                RETURNING users_nav_pinned_id_subscription AS sub_id,
                          users_nav_pinned_id_profile      AS prof_id
            ),
            deleted_bookmarks AS (
                DELETE FROM users_nav_bookmarks
                 WHERE users_nav_bookmarks_id_user   = r.user_id
                   AND users_nav_bookmarks_item_key  = v_page_key
                RETURNING users_nav_bookmarks_id_subscription AS sub_id,
                          users_nav_bookmarks_id_profile      AS prof_id
            ),
            cleared AS (
                UPDATE users_nav_profiles
                   SET users_nav_profiles_start_page_key = NULL
                 WHERE users_nav_profiles_id_user = r.user_id
                   AND users_nav_profiles_start_page_key = v_page_key
                RETURNING users_nav_profiles_id_subscription AS sub_id,
                          users_nav_profiles_id              AS prof_id
            ),
            distinct_profiles AS (
                SELECT DISTINCT sub_id, prof_id FROM deleted_pinned
                UNION
                SELECT DISTINCT sub_id, prof_id FROM deleted_bookmarks
                UNION
                SELECT DISTINCT sub_id, prof_id FROM cleared
            )
            SELECT fn_users_nav_prefs_resequence(r.user_id, sub_id, prof_id)
              FROM distinct_profiles;
        END IF;
    END LOOP;

    RETURN OLD;
END;
$$;

COMMIT;
