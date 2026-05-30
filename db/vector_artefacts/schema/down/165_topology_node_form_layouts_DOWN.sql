-- ============================================================
-- 165_topology_node_form_layouts_DOWN.sql
-- Rollback for 165_topology_node_form_layouts.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
-- ============================================================

BEGIN;

ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_id_form_layout_fk;
DROP INDEX IF EXISTS idx_artefacts_id_form_layout;
ALTER TABLE artefacts DROP COLUMN IF EXISTS artefacts_id_form_layout;

DROP TRIGGER IF EXISTS trg_topology_node_form_layouts_updated_at ON topology_node_form_layouts;
DROP FUNCTION IF EXISTS topology_node_form_layouts_set_updated_at();
DROP TABLE IF EXISTS topology_node_form_layouts;

COMMIT;
