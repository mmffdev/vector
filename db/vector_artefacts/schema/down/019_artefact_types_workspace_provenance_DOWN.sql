-- ============================================================
-- DOWN: M4 (PLA-0026 / story 00479)
-- Reverse the workspace_id + library provenance additions on artefact_types.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts \
--        -f down/019_artefact_types_workspace_provenance_DOWN.sql
-- ============================================================

BEGIN;

-- 1. Drop the new partial indexes first (so the columns can be dropped).
DROP INDEX IF EXISTS uq_artefact_types_ws_scope_prefix;
DROP INDEX IF EXISTS idx_artefact_types_ws_scope_sort;

-- 2. Drop the three columns.
ALTER TABLE artefact_types
    DROP COLUMN IF EXISTS library_layer_tag,
    DROP COLUMN IF EXISTS library_layer_id,
    DROP COLUMN IF EXISTS workspace_id;

COMMIT;
