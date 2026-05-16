-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0026 / Story 00493 (B4)
-- Add library provenance to flow_states.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 022_flow_states_library_provenance.sql
--
-- The adoption saga's flows step (B4) mirrors every live library Workflow
-- row into a flow_states row. Idempotency on retry needs a stable natural
-- key — the (flow_id, library_workflow_id) pair. This migration adds the
-- provenance column + the partial unique index that backs the
-- ON CONFLICT … DO NOTHING in writeFlowsAndStates.
--
-- library_workflow_id stays nullable because tenant-built flow_states
-- (created by hand in the workspace, not minted from the library) carry
-- no library row — the partial index ignores those.
-- ============================================================

BEGIN;

ALTER TABLE flow_states
    ADD COLUMN library_workflow_id UUID;

CREATE UNIQUE INDEX uq_flow_states_flow_lib_workflow
    ON flow_states (flow_id, library_workflow_id)
    WHERE archived_at IS NULL AND library_workflow_id IS NOT NULL;

COMMENT ON COLUMN flow_states.library_workflow_id IS
    'Cross-DB soft FK to mmff_library.portfolio_template_workflow_definitions.id. '
    'NULL when the state was tenant-built rather than minted from a library '
    'workflow row; populated by the adoption saga (PLA-0026 B4 — '
    'writeFlowsAndStates). Used as the idempotency key for re-runs.';

COMMIT;
