-- ============================================================
-- 142_nav_cascade_triggers_after_split_DOWN.sql
-- Rollback for 142_nav_cascade_triggers_after_split.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
--
-- Restores the mig 117 function bodies (which reference the gone
-- users_nav_prefs table). This is only useful if 141 has ALSO been
-- rolled back via its DOWN script — otherwise these functions will
-- 500 the moment a role change / page delete / grant revoke fires.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_users_nav_prefs_resequence(
    p_user_id uuid, p_subscription_id uuid, p_profile_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    WITH ordered AS (
        SELECT users_nav_prefs_id,
               row_number() OVER (
                   ORDER BY users_nav_prefs_position,
                            users_nav_prefs_item_key
               ) - 1 AS new_pos
          FROM users_nav_prefs
         WHERE users_nav_prefs_id_user         = p_user_id
           AND users_nav_prefs_id_subscription = p_subscription_id
           AND users_nav_prefs_id_profile      = p_profile_id
           AND users_nav_prefs_parent_item_key IS NULL
           AND users_nav_prefs_is_bookmark     = FALSE
    )
    UPDATE users_nav_prefs np
       SET users_nav_prefs_position = ordered.new_pos
      FROM ordered
     WHERE np.users_nav_prefs_id = ordered.users_nav_prefs_id
       AND np.users_nav_prefs_position IS DISTINCT FROM ordered.new_pos;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_pages_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_page_key text := OLD.pages_key_enum;
    rec record;
BEGIN
    IF v_page_key IS NULL THEN
        RETURN OLD;
    END IF;

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
$$;

CREATE OR REPLACE FUNCTION public.fn_users_role_change_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.users_id_role IS NOT DISTINCT FROM OLD.users_id_role THEN
        RETURN NEW;
    END IF;

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

-- Restore the known-broken mig-117 body verbatim (bare-column names).
CREATE OR REPLACE FUNCTION public.fn_users_roles_pages_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_page_key text;
    r record;
BEGIN
    SELECT key_enum INTO v_page_key
      FROM pages
     WHERE id = OLD.users_roles_pages_id_page;
    IF v_page_key IS NULL THEN
        RETURN OLD;
    END IF;

    FOR r IN
        SELECT id AS user_id
          FROM users
         WHERE role_id = OLD.users_roles_pages_id_role
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM users_roles_pages urp
              JOIN users u ON u.role_id = urp.users_roles_pages_id_role
             WHERE u.id = r.user_id
               AND urp.users_roles_pages_id_page = OLD.users_roles_pages_id_page
        ) THEN
            WITH deleted AS (
                DELETE FROM users_nav_prefs
                 WHERE users_nav_prefs_id_user   = r.user_id
                   AND users_nav_prefs_item_key  = v_page_key
                RETURNING users_nav_prefs_id_subscription AS sub_id,
                          users_nav_prefs_id_profile      AS prof_id
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
                SELECT DISTINCT sub_id, prof_id FROM deleted
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
