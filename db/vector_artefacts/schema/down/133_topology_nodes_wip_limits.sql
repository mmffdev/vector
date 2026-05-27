-- ============================================================
-- DOWN: 133_topology_nodes_wip_limits.sql
--
-- Reverses migration 133.
-- Drops the topology_nodes_wip_limits table (CASCADE drops the
-- index and the UNIQUE constraint automatically).
-- ============================================================

BEGIN;

DROP INDEX  IF EXISTS ix_topology_nodes_wip_limits_node;
DROP TABLE  IF EXISTS topology_nodes_wip_limits;

COMMIT;
