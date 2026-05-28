-- ============================================================
-- 143_fix_role_cascade_bare_select_plpgsql.sql
--
-- Fix two trigger functions that end with a bare `SELECT fn_x(...) FROM cte`
-- statement (invalid plpgsql — Postgres requires PERFORM or SELECT INTO
-- for queries returning rows you don't consume).
--
-- WHY:
--   Pre-existing latent bug copied verbatim from mig 117 into mig 142.
--   The functions never fired in normal flow (users rarely change role,
--   page grants rarely get revoked at runtime), so the bug stayed
--   dormant until TestReplacePrefs_RejectsItemForbiddenForRole exercised
--   the UPDATE users SET users_id_role path and tripped:
--
--     ERROR: query has no destination for result data (SQLSTATE 42601)
--
--   Both affected functions are rewritten to the LOOP+PERFORM shape that
--   fn_pages_cascade_nav_prefs already uses (and which works correctly).
--
-- AFFECTED:
--   - fn_users_role_change_cascade_nav_prefs
--   - fn_users_roles_pages_cascade_nav_prefs
--
-- IDEMPOTENCY:
--   CREATE OR REPLACE FUNCTION — safe to re-run.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/143_fix_role_cascade_bare_select_plpgsql_DOWN.sql
--   restores the (buggy) mig 142 function bodies.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_users_role_change_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    rec record;
BEGIN
    IF NEW.users_id_role IS NOT DISTINCT FROM OLD.users_id_role THEN
        RETURN NEW;
    END IF;

    FOR rec IN
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
        )
        SELECT DISTINCT sub_id, prof_id FROM deleted_pinned
        UNION
        SELECT DISTINCT sub_id, prof_id FROM deleted_bookmarks
        UNION
        SELECT DISTINCT sub_id, prof_id FROM cleared
    LOOP
        PERFORM fn_users_nav_prefs_resequence(NEW.users_id, rec.sub_id, rec.prof_id);
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_users_roles_pages_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_page_key text;
    r record;
    rec record;
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
            FOR rec IN
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
                )
                SELECT DISTINCT sub_id, prof_id FROM deleted_pinned
                UNION
                SELECT DISTINCT sub_id, prof_id FROM deleted_bookmarks
                UNION
                SELECT DISTINCT sub_id, prof_id FROM cleared
            LOOP
                PERFORM fn_users_nav_prefs_resequence(r.user_id, rec.sub_id, rec.prof_id);
            END LOOP;
        END IF;
    END LOOP;

    RETURN OLD;
END;
$$;

COMMIT;
