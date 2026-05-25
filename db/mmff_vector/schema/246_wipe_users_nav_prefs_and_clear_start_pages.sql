-- ============================================================
-- 246_wipe_users_nav_prefs_and_clear_start_pages.sql
--
-- One-shot wipe of every user's nav prefs (pins + bookmarks +
-- children) and clearing of users_nav_profiles.start_page_key.
--
-- WHY:
--   The users_nav_prefs table accumulated stale rows over time —
--   pages a user once had grants for, that the user's current role
--   no longer permits. The application-side reads filter these out
--   (Service.GetPrefsForProfile uses the role-clamped catalogue),
--   so they're invisible in the UI, but the underlying rows survive.
--   This invisible-but-present state broke the Account-Settings
--   Homepage dropdown's read-modify-write path: positions appeared
--   contiguous client-side, but PUT /_site/nav/prefs blew up against
--   validatePinned's contiguity / MaxPinned checks once stale entries
--   crept into the round-trip. The wipe resets every user to a clean
--   baseline; the existing lazy-seed path
--   (sqlBackfillDefaultPinnedPages, Service.ResetAllForUser
--   semantics) re-pins pages.default_pinned=TRUE filtered through
--   each user's current role grants on next read.
--
--   start_page_key is cleared too so no stale homepage references
--   survive to point at pages a user can no longer reach.
--
--   Custom profiles (users_nav_profiles rows themselves) and custom
--   groups (users_nav_groups) are preserved — only the *contents*
--   of profiles are reset, not the profile registry.
--
-- IDEMPOTENCY:
--   TRUNCATE on an already-empty table is a no-op. UPDATE … SET = NULL
--   on already-NULL rows is a no-op. Re-running this migration after
--   it has been applied (and users have re-seeded) WOULD re-wipe their
--   prefs — but this migration only fires once per DB because
--   schema_migrations records its filename and the runner skips
--   already-applied files. The destructive nature is intentional and
--   gated by the runner's idempotency, not the SQL's.
--
-- ROLLBACK:
--   Forward-only. The wiped prefs are unrecoverable from this
--   migration alone — restoration would require a backup of
--   users_nav_prefs and users_nav_profiles taken before apply. None
--   was taken because the wipe was explicitly requested by the user
--   as a baseline reset, not a data-preservation event.
-- ============================================================

BEGIN;

TRUNCATE users_nav_prefs;

UPDATE users_nav_profiles
   SET users_nav_profiles_start_page_key = NULL
 WHERE users_nav_profiles_start_page_key IS NOT NULL;

COMMIT;
