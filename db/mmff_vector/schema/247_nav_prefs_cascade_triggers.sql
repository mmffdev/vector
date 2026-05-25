-- ============================================================
-- 247_nav_prefs_cascade_triggers.sql
--
-- Cascade-clean users_nav_prefs + users_nav_profiles when the
-- underlying page grant for a user disappears. Closes the
-- stale-row class of bug that broke the Account-Settings
-- Homepage dropdown's read-modify-write path (see migration 246).
--
-- WHY:
--   users_nav_prefs rows survived role-grant revocation because no
--   cascade existed. Reads filtered them out via the role-clamped
--   catalogue in Service.GetPrefsForProfile, so they were invisible
--   in the UI — but any feature that read prefs and PUT them back
--   (the navigation editor, the new homepage dropdown) tripped over
--   the stale entries either failing validatePinned's role check or
--   producing position gaps. Cleaning at the data layer means every
--   read returns coherent data without depending on application-side
--   filters; defence-in-depth for SOC2 / defence-finance buyers
--   ("the database itself enforces this").
--
--   Two trigger surfaces cover the two ways a user can lose access:
--     (a) AFTER DELETE ON users_roles_pages — admin revoked a
--         (page, role) grant; every user holding that role loses
--         access to the page.
--     (b) AFTER UPDATE OF role_id ON users — admin reassigned a
--         user to a different role; the user's reachable page set
--         changes.
--
--   Both triggers re-sequence top-level positions per
--   (user, subscription, profile) using a window function so the
--   "positions form contiguous 0..N-1" invariant
--   (validatePinned at backend/internal/nav/service.go:678) holds
--   after the delete.
--
--   start_page_key is cleared on the matching users_nav_profiles
--   row whenever the stored value no longer points at a page the
--   user can reach.
--
-- IDEMPOTENCY:
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER. Re-applying the
--   migration replaces the trigger functions cleanly via CREATE OR
--   REPLACE FUNCTION. No data is mutated on apply — only the trigger
--   plumbing is installed. Future row deletions cascade as a
--   side-effect of those operations, not of this migration.
--
-- ROLLBACK:
--   db/mmff_vector/schema/down/247_nav_prefs_cascade_triggers_DOWN.sql
--   (DROP TRIGGER + DROP FUNCTION).
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- Helper: re-sequence top-level positions for a (user, sub, profile)
-- triple so positions run 0..N-1 with no gaps.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_users_nav_prefs_resequence(
    p_user_id         uuid,
    p_subscription_id uuid,
    p_profile_id      uuid
) RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------
-- Trigger 1: page grant revoked from a role.
-- After a row leaves users_roles_pages, every user whose only path
-- to the page was via that role loses access. Delete matching
-- nav_prefs rows and clear matching start_page_key.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_users_roles_pages_cascade_nav_prefs()
RETURNS trigger AS $$
DECLARE
    v_page_key text;
    r record;
BEGIN
    -- Resolve the page key once; if the page itself was deleted in the
    -- same transaction, FK should have prevented this, but be defensive.
    SELECT key_enum INTO v_page_key
      FROM pages
     WHERE id = OLD.users_roles_pages_id_page;
    IF v_page_key IS NULL THEN
        RETURN OLD;
    END IF;

    -- For every user holding the revoked role, check whether ANY of
    -- their remaining roles still grants this page. If none do, delete
    -- their nav_prefs rows for this page key and clear start_page_key.
    --
    -- The current schema stores a single role per user (users.role_id),
    -- but we express the check as "no remaining grant" so the trigger
    -- survives a future migration to a many-to-many users↔roles model.
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
            -- Delete the prefs rows + clear start_page_key in affected
            -- profiles. Capture distinct (subscription, profile) tuples
            -- so we can re-sequence each one exactly once.
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_roles_pages_cascade_nav_prefs
    ON users_roles_pages;

CREATE TRIGGER trg_users_roles_pages_cascade_nav_prefs
    AFTER DELETE ON users_roles_pages
    FOR EACH ROW
    EXECUTE FUNCTION fn_users_roles_pages_cascade_nav_prefs();

-- ----------------------------------------------------------------
-- Trigger 2: user's role changed.
-- Walk the user's existing nav_prefs; drop any whose item_key is no
-- longer reachable via the new role. Clear start_page_key if it
-- points at a now-forbidden page.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_users_role_change_cascade_nav_prefs()
RETURNS trigger AS $$
BEGIN
    -- No-op if the role didn't change.
    IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
        RETURN NEW;
    END IF;

    -- Delete prefs rows for pages the new role can't reach.
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_role_change_cascade_nav_prefs
    ON users;

CREATE TRIGGER trg_users_role_change_cascade_nav_prefs
    AFTER UPDATE OF role_id ON users
    FOR EACH ROW
    EXECUTE FUNCTION fn_users_role_change_cascade_nav_prefs();

COMMIT;
