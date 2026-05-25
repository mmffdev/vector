-- ============================================================
-- 248_nav_prefs_cascade_on_page_delete.sql
--
-- Third cascade trigger in the nav-prefs coherence set (after
-- migration 247): when a row is hard-deleted from `pages`, delete
-- every matching users_nav_prefs row (matched by key_enum →
-- users_nav_prefs_item_key) and clear every matching
-- users_nav_profiles.start_page_key.
--
-- WHY:
--   users_nav_prefs.users_nav_prefs_item_key is a TEXT column
--   storing pages.key_enum (a string identifier, not a UUID FK).
--   The text-by-value reference exists because the nav system was
--   designed before pages had stable UUIDs and the migration to
--   FK semantics never happened. Postgres cannot enforce a FK on
--   a TEXT column referencing another table's value, so a hard
--   DELETE on pages would leave dangling item_key references that
--   the read filter (Service.GetPrefsForProfile catalogue lookup)
--   silently drops — but the rows persist in the DB, the same
--   stale-row class of bug that migration 247 closed for role
--   revocation.
--
--   In practice today, pages are soft-archived rather than hard-
--   deleted (no live writer does DELETE FROM pages). This trigger
--   is therefore precautionary: it costs nothing in steady state
--   and prevents a future migration or admin script from creating
--   orphans without a follow-up cleanup. Same shape as the role-
--   revoke trigger in 247: delete prefs rows, clear start_page_key,
--   re-sequence positions.
--
-- IDEMPOTENCY:
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER + CREATE OR REPLACE
--   FUNCTION. Re-applying replaces the plumbing cleanly. No data
--   is mutated on apply — only the trigger is installed.
--
-- ROLLBACK:
--   db/mmff_vector/schema/down/248_nav_prefs_cascade_on_page_delete_DOWN.sql
-- ============================================================

BEGIN;

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

DROP TRIGGER IF EXISTS trg_pages_cascade_nav_prefs ON pages;

CREATE TRIGGER trg_pages_cascade_nav_prefs
    AFTER DELETE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION fn_pages_cascade_nav_prefs();

COMMIT;
