-- mmff_vector: drop two dead-leaf legacy tables
-- 2026-05-13 — PLA-0023 P0' (mmff_vector → vector_artefacts consolidation)
--
-- Both tables have 0 readers/writers in Go and frontend (full-repo scan
-- 2026-05-13), and 0 inbound FKs from other tables. Rows are stale
-- legacy data from the pre-PoC `obj_*` substrate.
--
-- obj_flow_system (34 rows) — superseded by vector_artefacts.flows /
--   flow_states / flow_transitions. The flow-engine cutover (PLA-0023)
--   moved every live reader to vaPool; nothing reads obj_flow_system.
--
-- o_artefact_visibility_levels (4 rows) — superseded by the artefact-
--   types visibility model on VA. No service references it.
--
-- Two siblings (canonical_states, obj_execution_types) are also dead-
-- leaf at the Go/TS layer but still hold inbound FKs from obj_flow_tenant
-- + obj_execution_types_tenant — they stay until those blockers are
-- removed in a later pass.
--
-- subscription_item_type_icons stays — docs/c_scope.md flags it as
-- placeholder for an in-flight padmin icon-picker feature; dropping then
-- recreating would churn migration history for zero benefit.

BEGIN;

DROP TABLE IF EXISTS obj_flow_system CASCADE;
DROP TABLE IF EXISTS o_artefact_visibility_levels CASCADE;

COMMIT;
