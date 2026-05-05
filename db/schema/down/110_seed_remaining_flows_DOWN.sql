-- ============================================================
-- DOWN: 110_seed_remaining_flows.sql
-- Removes the seeded flows for execution_test_cases / execution_epics /
-- strategic from o_flow_system, and removes the per-portfolio_item_type
-- flows from o_flow_tenant.
-- ============================================================

BEGIN;

-- Remove tenant portfolio flows (only the ones seeded by this migration:
-- 5-row Backlog/Ready/Doing/Completed/Accepted blocks linked to a
-- portfolio_item_type_id).
DELETE FROM o_flow_tenant
WHERE  portfolio_item_type_id IS NOT NULL
  AND  name IN ('Backlog', 'Ready', 'Doing', 'Completed', 'Accepted');

-- Remove system seeds for the three remaining types.
DELETE FROM o_flow_system f
USING       o_artefact_types_system t
WHERE       f.system_artefact_type_id = t.id
  AND       t.scope_key IN ('execution_test_cases', 'execution_epics', 'strategic');

COMMIT;
