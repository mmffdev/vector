-- ============================================================
-- down/132_topology_nodes_members.sql
-- Rollback for 132_topology_nodes_members.sql
--
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
--
-- Drops the topology_nodes_members table and its indexes.
-- Indexes drop implicitly with the table but are listed
-- explicitly for clarity / round-trip verification.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS ix_topology_nodes_members_user;
DROP INDEX IF EXISTS ix_topology_nodes_members_node;
DROP TABLE IF EXISTS topology_nodes_members;

COMMIT;
