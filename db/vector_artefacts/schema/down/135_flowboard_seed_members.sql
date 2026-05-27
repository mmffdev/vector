-- ============================================================
-- DOWN: 135_flowboard_seed_members.sql
--
-- Reverses migration 135.
-- Removes the two seeded topology_nodes_members rows and the
-- three topology_nodes_wip_limits rows for the Insurance node.
-- ============================================================

BEGIN;

-- Remove WIP limits for Insurance node (Story flow states)
DELETE FROM topology_nodes_wip_limits
WHERE topology_nodes_wip_limits_node_id = 'ae2d4ff5-4c8d-4839-af89-7769067476ae'::uuid
  AND topology_nodes_wip_limits_flow_state_id IN (
      SELECT flows_states_id
      FROM flows_states
      WHERE flows_states_id_flow = '060d1387-3f98-492a-adfa-20b93650faf0'
        AND flows_states_name IN ('Backlog', 'Doing', 'Completed')
  );

-- Remove seeded members for Insurance node
DELETE FROM topology_nodes_members
WHERE topology_nodes_members_node_id = 'ae2d4ff5-4c8d-4839-af89-7769067476ae'::uuid
  AND topology_nodes_members_user_id IN (
      '583b8276-092f-4645-8e79-367fdcb5c4b6'::uuid,  -- user@mmffdev.com
      '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid   -- padmin@mmffdev.com
  );

COMMIT;
