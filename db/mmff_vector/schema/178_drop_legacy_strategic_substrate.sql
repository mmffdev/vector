-- Drop six legacy strategic-substrate tables from mmff_vector.
--
-- PLA-0023 cutover (P5 confirmed via Sonnet handler-binding audits 2026-05-13):
--
--   obj_strategy_types_layers (0 rows)
--     - Live readers: none. The 3 cited handlers in handler_layers.go are
--       compiled dead code (NewLayersBatchHandler never mounted in main.go).
--     - FE callers: none. FE calls /workspace/{id}/portfolio/layers (VA-backed).
--   obj_strategy_types (1 row)
--     - Live readers: none. Trigger seed_default_flow_for_portfolio_item_type
--       targets non-existent o_flow_tenant — broken landmine.
--   subscription_artifacts (0 rows)
--     - Adoption saga SA1 (2026-05-13) removed legacy mirror writes.
--   subscription_workflow_transitions (0 rows)
--     - Same — SA1 removed legacy writes; VA flow_transitions is canonical.
--   subscription_workflows (0 rows)
--     - Same — VA flows is canonical.
--   subscription_terminology (0 rows)
--     - stepTerminology removed from adoption saga in SA1; no VA equivalent
--       needed.
--
-- Canonical home for strategic substrate is now vector_artefacts:
--   - artefact_types WHERE scope='strategy'          (was obj_strategy_types)
--   - artefacts WHERE at.scope='strategy'            (canonical items)
--   - flows / flow_states / flow_transitions         (was subscription_workflow*)
--   - (no terminology equivalent — feature removed)
--
-- FK-safe drop order: children before parents.
--   1. subscription_workflow_transitions → subscription_workflows (CASCADE)
--   2. subscription_workflows           → obj_strategy_types_layers (CASCADE)
--   3. obj_strategy_types_layers        → (self-FK only)
--   4. obj_strategy_types               (no inbound FKs after #3)
--   5. subscription_artifacts           (no inbound FKs)
--   6. subscription_terminology         (no inbound FKs)
--
-- DOWN: db/schema/down/178_drop_legacy_strategic_substrate_DOWN.sql
--       — NOTE: rollback would recreate empty tables; no data restoration possible.

BEGIN;

-- Drop the broken trigger function first so its dropping with the table
-- doesn't leave an orphaned function.
DROP TRIGGER IF EXISTS trg_portfolio_item_types_seed_flow ON obj_strategy_types;
DROP FUNCTION IF EXISTS seed_default_flow_for_portfolio_item_type();

DROP TABLE IF EXISTS subscription_workflow_transitions;
DROP TABLE IF EXISTS subscription_workflows;
DROP TABLE IF EXISTS obj_strategy_types_layers;
DROP TABLE IF EXISTS obj_strategy_types;
DROP TABLE IF EXISTS subscription_artifacts;
DROP TABLE IF EXISTS subscription_terminology;

COMMIT;
