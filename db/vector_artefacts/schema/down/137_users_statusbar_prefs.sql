-- ============================================================
-- DOWN: 137_users_statusbar_prefs.sql
--
-- Drops the users_statusbar_prefs table introduced in migration 136.
-- Indexes are dropped implicitly when the table is dropped; explicit
-- DROP INDEX IF EXISTS guards are included for clarity and safety.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS users_statusbar_prefs_user_uidx;
DROP TABLE IF EXISTS users_statusbar_prefs;

COMMIT;
