-- ============================================================
-- 149_relax_saved_views_kind_check_for_page_DOWN.sql
-- Rollback for 149_relax_saved_views_kind_check_for_page.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
--
-- WARNING: this will FAIL if any saved_views rows still have
-- kind='page'. Archive or delete those rows first:
--   UPDATE saved_views SET saved_views_archived_at = now()
--     WHERE saved_views_kind = 'page' AND saved_views_archived_at IS NULL;
-- (or DELETE FROM saved_views WHERE saved_views_kind = 'page';)
-- ============================================================

BEGIN;

ALTER TABLE saved_views
    DROP CONSTRAINT IF EXISTS saved_views_kind_check;

ALTER TABLE saved_views
    ADD CONSTRAINT saved_views_kind_check
        CHECK (saved_views_kind IN ('objecttree', 'page_layout'));

COMMIT;
