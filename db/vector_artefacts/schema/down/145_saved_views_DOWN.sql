-- ============================================================
-- 145_saved_views_DOWN.sql — reverses 145_saved_views.sql
-- ============================================================

BEGIN;
DROP TRIGGER IF EXISTS saved_views_touch_updated_at ON saved_views;
DROP FUNCTION IF EXISTS saved_views_touch_updated_at();
DROP TABLE IF EXISTS saved_views;
COMMIT;
