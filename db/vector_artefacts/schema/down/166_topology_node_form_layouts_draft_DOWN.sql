-- ============================================================
-- 166_topology_node_form_layouts_draft_DOWN.sql
-- Rollback for 166_topology_node_form_layouts_draft.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
--
-- NOTE: dropping the column will also drop any draft rows' draft flag; if
-- draft rows exist they become orphaned published-looking rows. Delete
-- drafts first if that matters:
--   DELETE FROM topology_node_form_layouts WHERE topology_node_form_layouts_is_draft;
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS uq_topology_node_form_layouts_draft;

ALTER TABLE topology_node_form_layouts
    DROP COLUMN IF EXISTS topology_node_form_layouts_is_draft;

COMMIT;
