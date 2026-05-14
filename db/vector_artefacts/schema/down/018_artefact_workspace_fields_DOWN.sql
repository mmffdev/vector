-- ============================================================
-- DOWN: M3 (PLA-0026 / story 00478)
-- Drop the workspace whitelist table.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts \
--        -f down/018_artefact_workspace_fields_DOWN.sql
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS artefact_workspace_fields;

COMMIT;
