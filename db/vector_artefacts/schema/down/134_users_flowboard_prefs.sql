-- ============================================================
-- DOWN: 134_users_flowboard_prefs.sql
--
-- Drops the users_flowboard_prefs table introduced in migration 134.
-- Indexes are dropped implicitly when the table is dropped; explicit
-- DROP INDEX IF EXISTS guards are included for clarity and safety.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS users_flowboard_prefs_workspace_idx;
DROP INDEX IF EXISTS users_flowboard_prefs_user_type_uidx;
DROP TABLE IF EXISTS users_flowboard_prefs;

COMMIT;
