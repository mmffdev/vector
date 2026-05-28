-- ============================================================
-- 142_nav_cascade_triggers_after_split.sql
--
-- Update the four nav-cascade Postgres functions that reference the
-- now-gone users_nav_prefs table.
--
-- Mig 141 split users_nav_prefs into users_nav_pinned + users_nav_bookmarks.
-- That rename was invisible to the Go layer (string-only SQL constants
-- were swept) but DB-side trigger functions installed in migration 117
-- still reference the dropped table. They fire on:
--
--   - DELETE on users_roles_pages           → fn_users_roles_pages_cascade_nav_prefs
--   - DELETE on pages                       → fn_pages_cascade_nav_prefs
--   - UPDATE of users.users_id_role         → fn_users_role_change_cascade_nav_prefs
--
-- and they all call the shared helper:
--   fn_users_nav_prefs_resequence(user_id, sub_id, prof_id)
--
-- WHY:
--   Without this migration any role swap, page deletion, or role-grant
--   revoke would 500 with "relation users_nav_prefs does not exist".
--   Found by TestReplacePrefs_RejectsItemForbiddenForRole during the
--   141-split work.
--
--   This migration ALSO fixes the long-standing TD-NAV-CASCADE-BROKEN
--   bug noted in mig 117 lines 366-379:
--   fn_users_roles_pages_cascade_nav_prefs referenced bare column
--   names (pages.id, pages.key_enum, users.id, users.role_id) that
--   were removed by the Pillar 1 column-prefix rule. Rewriting the
--   function anyway as part of the table split — the right time to
--   pay this debt down is when you're touching the file.
--
-- BEHAVIOUR after this migration:
--   On role change / page delete / grant revoke, the cascade deletes
--   from BOTH users_nav_pinned AND users_nav_bookmarks (a removed
--   page should also disappear from a user's bookmarks).
--
-- IDEMPOTENCY:
--   CREATE OR REPLACE FUNCTION — safe to re-run.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/142_nav_cascade_triggers_after_split_DOWN.sql
--   restores the mig-117 function bodies (which reference the gone
--   users_nav_prefs table — only useful AFTER rolling 141 back too).
-- ============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. fn_users_nav_prefs_resequence — operate on users_nav_pinned.
--    Bookmarks live in their own table and are unordered with respect
--    to the rail's contiguous-position invariant.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_users_nav_prefs_resequence(
    p_user_id uuid, p_subscription_id uuid, p_profile_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    WITH ordered AS (
        SELECT users_nav_pinned_id,
               row_number() OVER (
                   ORDER BY users_nav_pinned_position,
                            users_nav_pinned_item_key
               ) - 1 AS new_pos
          FROM users_nav_pinned
         WHERE users_nav_pinned_id_user         = p_user_id
           AND users_nav_pinned_id_subscription = p_subscription_id
           AND users_nav_pinned_id_profile      = p_profile_id
           AND users_nav_pinned_parent_item_key IS NULL
    )
    UPDATE users_nav_pinned np
       SET users_nav_pinned_position = ordered.new_pos
      FROM ordered
     WHERE np.users_nav_pinned_id = ordered.users_nav_pinned_id
       AND np.users_nav_pinned_position IS DISTINCT FROM ordered.new_pos;
END;
$$;

-- ---------------------------------------------------------------
-- 2. fn_pages_cascade_nav_prefs — cascade page deletion into BOTH
--    users_nav_pinned and users_nav_bookmarks.
-- ---------------------------------------------------------------
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
        WITH deleted_pinned AS (
            DELETE FROM users_nav_pinned
             WHERE users_nav_pinned_item_key = v_page_key
            RETURNING users_nav_pinned_id_user         AS user_id,
                      users_nav_pinned_id_subscription AS sub_id,
                      users_nav_pinned_id_profile      AS prof_id
        ),
        deleted_bookmarks AS (
            DELETE FROM users_nav_bookmarks
             WHERE users_nav_bookmarks_item_key = v_page_key
            RETURNING users_nav_bookmarks_id_user         AS user_id,
                      users_nav_bookmarks_id_subscription AS sub_id,
                      users_nav_bookmarks_id_profile      AS prof_id
        ),
        cleared AS (
            UPDATE users_nav_profiles
               SET users_nav_profiles_start_page_key = NULL
             WHERE users_nav_profiles_start_page_key = v_page_key
            RETURNING users_nav_profiles_id_user         AS user_id,
                      users_nav_profiles_id_subscription AS sub_id,
                      users_nav_profiles_id              AS prof_id
        )
        SELECT DISTINCT user_id, sub_id, prof_id FROM deleted_pinned
        UNION
        SELECT DISTINCT user_id, sub_id, prof_id FROM deleted_bookmarks
        UNION
        SELECT DISTINCT user_id, sub_id, prof_id FROM cleared
    LOOP
        PERFORM fn_users_nav_prefs_resequence(rec.user_id, rec.sub_id, rec.prof_id);
    END LOOP;

    RETURN OLD;
END;
$$;

-- ---------------------------------------------------------------
-- 3. fn_users_role_change_cascade_nav_prefs — when users.users_id_role
--    changes, drop pinned + bookmark rows whose item_key references a
--    page that the new role isn't granted, and null any orphaned start
--    page. Then resequence remaining pinned rows.
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- 4. fn_users_roles_pages_cascade_nav_prefs — when a grant is revoked
--    (users_roles_pages row deleted), drop pinned + bookmark rows for
--    users on that role whose item_key referenced the revoked page,
--    iff no OTHER role they hold still grants the page.
--
--    Fixes TD-NAV-CASCADE-BROKEN (mig 117 lines 366-379): the original
--    function referenced pages.key_enum / pages.id / users.id /
--    users.role_id — bare columns dropped by the column-prefix rule.
--    Rewritten with the canonical prefixed columns + the user→role
--    join via users_id_role.
--    Note: users currently has a single role per user via users_id_role,
--    so "user holds any other granting role" simplifies to "user has a
--    different role that grants this page" — exact-old-behavior pending
--    the role-multiplicity epic.
-- ---------------------------------------------------------------
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
