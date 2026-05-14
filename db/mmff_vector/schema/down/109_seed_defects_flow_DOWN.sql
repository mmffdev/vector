-- ============================================================
-- DOWN: 109_seed_defects_flow.sql
-- Removes the seeded default flow for execution_defects.
-- ============================================================

BEGIN;

DELETE FROM o_flow_system f
USING       o_artefact_types_system t
WHERE       f.system_artefact_type_id = t.id
  AND       t.scope_key = 'execution_defects';

COMMIT;
