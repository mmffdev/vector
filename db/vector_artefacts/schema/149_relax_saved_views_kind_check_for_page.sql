-- ============================================================
-- 149_relax_saved_views_kind_check_for_page.sql
--
-- Widen saved_views_kind_check to accept the new 'page' kind.
--
-- WHY:
--   Page-level saved views (one view applies across N grids on the
--   same page) need their own discriminator separate from the
--   per-grid 'objecttree' kind and the future 'page_layout' kind.
--   Body shape for kind='page' is { grids: { <gridKey>: { visible_columns: [] } } }
--   per the value-sprint single-dropdown design (2026-05-29).
--
-- IDEMPOTENCY:
--   DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. Safe to re-run.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/149_relax_saved_views_kind_check_for_page_DOWN.sql
--   Note: rolling back will FAIL if any rows already have kind='page'.
--   Archive or delete those rows first if rolling back.
-- ============================================================

BEGIN;

ALTER TABLE saved_views
    DROP CONSTRAINT IF EXISTS saved_views_kind_check;

ALTER TABLE saved_views
    ADD CONSTRAINT saved_views_kind_check
        CHECK (saved_views_kind IN ('objecttree', 'page_layout', 'page'));

COMMIT;
