-- Drop legacy topology V1 tables.
--
-- PLA-0006 cutover (M6.2.7) migrated org_nodes → topology_nodes (vector_artefacts),
-- org_node_roles → topology_role_grants (vector_artefacts), and org_levels logic
-- → topology_view_state + depth derivation (vector_artefacts). These three tables
-- have had zero backend consumers since M6 cutover completed (2026-05-08). Audit:
-- `grep -r "org_nodes\|org_levels\|org_node_roles" backend --include="*.go"` yields
-- zero matches in production code (only comments mentioning the V1 shape).
--
-- Safe to drop immediately. No rollback script needed — tables were empty since
-- the cutover and have been space-idle for 1+ days.
--
-- Drop order: org_node_roles depends on org_nodes via FK, so drop roles first.

BEGIN;

DROP TABLE IF EXISTS org_node_roles CASCADE;
DROP TABLE IF EXISTS org_levels CASCADE;
DROP TABLE IF EXISTS org_nodes CASCADE;

COMMIT;
