-- ============================================================
-- 247_nav_prefs_cascade_triggers_DOWN.sql
-- Rollback for 247_nav_prefs_cascade_triggers.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_users_role_change_cascade_nav_prefs ON users;
DROP TRIGGER IF EXISTS trg_users_roles_pages_cascade_nav_prefs ON users_roles_pages;

DROP FUNCTION IF EXISTS fn_users_role_change_cascade_nav_prefs();
DROP FUNCTION IF EXISTS fn_users_roles_pages_cascade_nav_prefs();
DROP FUNCTION IF EXISTS fn_users_nav_prefs_resequence(uuid, uuid, uuid);

COMMIT;
