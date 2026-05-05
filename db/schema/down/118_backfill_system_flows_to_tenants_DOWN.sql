-- ============================================================
-- DOWN: 118_backfill_system_flows_to_tenants.sql
--
-- Removes ONLY the rows the backfill inserted: o_flow_tenant rows
-- whose (system_artefact_type_id, flow_position, name, canonical_code,
-- description) tuple matches a row in o_flow_system. Tenant edits
-- (different name / description / extra positions) are left alone.
--
-- Operationally this is "undo only what the backfill produced".
-- It cannot tell apart a tenant who hand-recreated the exact default
-- from the backfill itself — but the result is identical, so removing
-- either is the same outcome.
-- ============================================================

BEGIN;

DELETE FROM o_flow_tenant t
USING o_flow_system fs
WHERE t.system_artefact_type_id IS NOT NULL
  AND t.system_artefact_type_id = fs.system_artefact_type_id
  AND t.flow_position           = fs.flow_position
  AND t.name                    = fs.name
  AND t.canonical_code          = fs.canonical_code
  AND COALESCE(t.description, '') = COALESCE(fs.description, '')
  AND t.archived_at IS NULL;

COMMIT;
