-- ============================================================
-- MMFFDev - Vector: Seed default flows for remaining system types
--                   and every portfolio_item_types row
-- Migration 110 — applied on top of 109_seed_defects_flow.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 110_seed_remaining_flows.sql
--
-- WHY ----------------------------------------------------------
-- All execution-system artefact types and every portfolio layer
-- get the same default 5-state flow out of the box:
--   1. Backlog   → backlog
--   2. Ready     → ready
--   3. Doing     → doing
--   4. Completed → completed
--   5. Accepted  → accepted
--
-- System types covered here (system seeds → o_flow_system):
--   - execution_test_cases
--   - execution_epics
--   - strategic
-- (execution_work_items, execution_defects, execution_tasks
--  already seeded in earlier migrations.)
--
-- Portfolio types covered here (per-subscription seeds → o_flow_tenant):
--   - Every existing portfolio_item_types row, for its subscription
-- Future portfolio_item_types rows must get the same default seeded
-- by the application on insert (subscription provisioning hook).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Seed o_flow_system for the remaining vendor execution types
-- ============================================================
INSERT INTO o_flow_system
    (system_artefact_type_id, flow_position, name, canonical_code, description)
SELECT t.id, v.flow_position, v.name, v.canonical_code, v.description
FROM   o_artefact_types_system t
CROSS  JOIN (VALUES
    (1, 'Backlog',   'backlog',   'Captured but not yet ready to start.'),
    (2, 'Ready',     'ready',     'Acceptance criteria met; ready for someone to pick up.'),
    (3, 'Doing',     'doing',     'Actively being worked on.'),
    (4, 'Completed', 'completed', 'Work finished; awaiting acceptance.'),
    (5, 'Accepted',  'accepted',  'Reviewed and accepted by the requester.')
) AS v(flow_position, name, canonical_code, description)
WHERE  t.scope_key IN ('execution_test_cases', 'execution_epics', 'strategic')
ON CONFLICT (system_artefact_type_id, flow_position) DO NOTHING;

-- ============================================================
-- 2. Seed o_flow_tenant for every existing portfolio_item_types row
-- (one flow row per (subscription × portfolio_item_type × position))
-- ============================================================
INSERT INTO o_flow_tenant
    (subscription_id, portfolio_item_type_id, flow_position, name, canonical_code, description)
SELECT pit.subscription_id, pit.id, v.flow_position, v.name, v.canonical_code, v.description
FROM   portfolio_item_types pit
CROSS  JOIN (VALUES
    (1, 'Backlog',   'backlog',   'Captured but not yet ready to start.'),
    (2, 'Ready',     'ready',     'Acceptance criteria met; ready for someone to pick up.'),
    (3, 'Doing',     'doing',     'Actively being worked on.'),
    (4, 'Completed', 'completed', 'Work finished; awaiting acceptance.'),
    (5, 'Accepted',  'accepted',  'Reviewed and accepted by the requester.')
) AS v(flow_position, name, canonical_code, description)
WHERE  pit.archived_at IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
