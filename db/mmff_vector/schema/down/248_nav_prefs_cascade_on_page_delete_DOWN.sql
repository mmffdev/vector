-- ============================================================
-- 248_nav_prefs_cascade_on_page_delete_DOWN.sql
-- Rollback for 248_nav_prefs_cascade_on_page_delete.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_pages_cascade_nav_prefs ON pages;
DROP FUNCTION IF EXISTS fn_pages_cascade_nav_prefs();

COMMIT;
