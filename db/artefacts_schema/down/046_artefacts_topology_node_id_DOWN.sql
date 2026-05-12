-- ============================================================
-- DOWN for 046_artefacts_topology_node_id.sql (PLA-0043 / FE-POR-0003.1)
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f down/046_artefacts_topology_node_id_DOWN.sql
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS artefacts_topology_node_id_live_idx;
ALTER TABLE artefacts DROP COLUMN IF EXISTS topology_node_id;

COMMIT;
