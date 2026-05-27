-- ============================================================
-- 132_topology_nodes_members.sql
--
-- FlowBoard — team-membership foundation.
--
-- WHY:
--   One row per (user, topology_node) pair. Used by the FlowBoard
--   feature's permission gate: only members of a node may edit WIP
--   limits for that node. Also the foundation for any future
--   node-scoped notification fan-out or "my boards" filtering.
--   FB1.1.1 / docs/superpowers/specs/2026-05-27-flowboard-design.md §3.1
--
-- IDEMPOTENCY:
--   CREATE TABLE ... IF NOT EXISTS; indexes created without IF NOT
--   EXISTS but the whole migration is inside BEGIN/COMMIT and will
--   be applied exactly once by the runner.
--
-- ROLLBACK:
--   See db/vector_artefacts/schema/down/132_topology_nodes_members.sql
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE IF NOT EXISTS topology_nodes_members (
    topology_nodes_members_id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    topology_nodes_members_node_id      uuid        NOT NULL
        REFERENCES topology_nodes(topology_nodes_id) ON DELETE CASCADE,
    topology_nodes_members_user_id      uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    topology_nodes_members_role         text        NOT NULL DEFAULT 'member',
    topology_nodes_members_workspace_id uuid        NOT NULL,
    topology_nodes_members_created_at   timestamptz NOT NULL DEFAULT now(),

    UNIQUE (topology_nodes_members_node_id, topology_nodes_members_user_id)
);

CREATE INDEX ix_topology_nodes_members_node
    ON topology_nodes_members (topology_nodes_members_node_id);

CREATE INDEX ix_topology_nodes_members_user
    ON topology_nodes_members (topology_nodes_members_user_id);

-- ---- DOWN (inline reference — apply separately via down/ file) ----
-- DROP INDEX IF EXISTS ix_topology_nodes_members_user;
-- DROP INDEX IF EXISTS ix_topology_nodes_members_node;
-- DROP TABLE IF EXISTS topology_nodes_members;

COMMIT;
