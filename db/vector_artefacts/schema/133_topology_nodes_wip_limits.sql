-- ============================================================
-- 133_topology_nodes_wip_limits.sql
--
-- FlowBoard — WIP-limit policy table.
--
-- Per-node-per-flow-state WIP cap. One row per (node, flow_state)
-- pair. NULL limit = unlimited (matches Rally's blank-means-infinity
-- convention). The board reads these rows to render the
-- "Doing (11/10) +1" overage header via <BoardColumnHeader>.
--
-- FKs:
--   topology_nodes_wip_limits_node_id       → topology_nodes(topology_nodes_id)   ON DELETE CASCADE
--   topology_nodes_wip_limits_flow_state_id → flows_states(flows_states_id)       ON DELETE CASCADE
--   topology_nodes_wip_limits_updated_by    → users(users_id)                     (nullable, SET NULL on user delete handled at app layer)
--
-- topology_nodes_wip_limits_workspace_id is denormalised — every
-- sentinel-clamped query needs it without a join.
--
-- UNIQUE on (node_id, flow_state_id) — one WIP row per column
-- per node. Application UPSERT targets this constraint.
--
-- Part of the FlowBoard PLA (FB1.1.2 — mig 133).
-- See docs/superpowers/specs/2026-05-27-flowboard-design.md § 3.2
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE topology_nodes_wip_limits (
    topology_nodes_wip_limits_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    topology_nodes_wip_limits_node_id       UUID        NOT NULL
        REFERENCES topology_nodes(topology_nodes_id) ON DELETE CASCADE,
    topology_nodes_wip_limits_flow_state_id UUID        NOT NULL
        REFERENCES flows_states(flows_states_id) ON DELETE CASCADE,
    topology_nodes_wip_limits_limit         INT,        -- NULL = unlimited
    topology_nodes_wip_limits_workspace_id  UUID        NOT NULL,
    topology_nodes_wip_limits_updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    topology_nodes_wip_limits_updated_by    UUID
        REFERENCES users(users_id),

    CONSTRAINT topology_nodes_wip_limits_node_state_uq
        UNIQUE (topology_nodes_wip_limits_node_id, topology_nodes_wip_limits_flow_state_id)
);

-- Drives the primary WIP-row lookup: all limits for a node
CREATE INDEX ix_topology_nodes_wip_limits_node
    ON topology_nodes_wip_limits (topology_nodes_wip_limits_node_id);

COMMIT;
