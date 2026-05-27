-- ============================================================
-- 135_flowboard_seed_members.sql
--
-- FlowBoard — integration smoke seed.
--
-- Seeds:
--   1. topology_nodes_members: 2 rows for user@mmffdev.com and
--      padmin@mmffdev.com on the "Insurance" node
--      (ae2d4ff5-4c8d-4839-af89-7769067476ae), which has the most
--      artefacts (63) in dev and belongs to workspace
--      a4df2e21-8d9a-452b-b4f9-eded455381c8.
--
--   2. topology_nodes_wip_limits: 3 rows for the Story flow states
--      on the Insurance node (Backlog=10, Doing=3, Completed=NULL).
--      Note: the Story flow uses "Completed" where the AC says
--      "Done" — there is no state named "Done" in the Story flow.
--      Completed is the canonical done-kind state.
--
-- IDEMPOTENCY:
--   All INSERTs use ON CONFLICT DO NOTHING so re-applying is safe.
--   The UNIQUE constraint on topology_nodes_members is
--   (topology_nodes_members_node_id, topology_nodes_members_user_id).
--   The UNIQUE constraint on topology_nodes_wip_limits is
--   topology_nodes_wip_limits_node_state_uq
--   (topology_nodes_wip_limits_node_id, topology_nodes_wip_limits_flow_state_id).
--
-- ROLLBACK:
--   See db/vector_artefacts/schema/down/135_flowboard_seed_members.sql
-- ============================================================

BEGIN;

-- ---- Member seed ----

INSERT INTO topology_nodes_members (
    topology_nodes_members_node_id,
    topology_nodes_members_user_id,
    topology_nodes_members_role,
    topology_nodes_members_workspace_id
) VALUES
    -- user@mmffdev.com
    (
        'ae2d4ff5-4c8d-4839-af89-7769067476ae',
        '583b8276-092f-4645-8e79-367fdcb5c4b6',
        'member',
        'a4df2e21-8d9a-452b-b4f9-eded455381c8'
    ),
    -- padmin@mmffdev.com
    (
        'ae2d4ff5-4c8d-4839-af89-7769067476ae',
        '6cabe266-b2f4-43f9-879c-06020c789a0b',
        'member',
        'a4df2e21-8d9a-452b-b4f9-eded455381c8'
    )
ON CONFLICT DO NOTHING;

-- ---- WIP-limit seed ----
-- Uses the Story flow (060d1387-3f98-492a-adfa-20b93650faf0) on the
-- Insurance node. The three states are Backlog, Doing, Completed.
-- Done is not a state name in this flow; Completed is the done-kind.

INSERT INTO topology_nodes_wip_limits (
    topology_nodes_wip_limits_node_id,
    topology_nodes_wip_limits_flow_state_id,
    topology_nodes_wip_limits_limit,
    topology_nodes_wip_limits_workspace_id
)
SELECT
    'ae2d4ff5-4c8d-4839-af89-7769067476ae'::uuid AS node_id,
    fs.flows_states_id,
    CASE fs.flows_states_name
        WHEN 'Backlog'   THEN 10
        WHEN 'Doing'     THEN 3
        WHEN 'Completed' THEN NULL
    END AS wip_limit,
    'a4df2e21-8d9a-452b-b4f9-eded455381c8'::uuid AS workspace_id
FROM flows_states fs
WHERE fs.flows_states_id_flow = '060d1387-3f98-492a-adfa-20b93650faf0'
  AND fs.flows_states_name IN ('Backlog', 'Doing', 'Completed')
  AND fs.flows_states_archived_at IS NULL
ON CONFLICT ON CONSTRAINT topology_nodes_wip_limits_node_state_uq
DO NOTHING;

COMMIT;
