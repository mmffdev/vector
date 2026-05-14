-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0026 / Story 00493 (B4)
-- Add library_layer_id provenance to flows.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 023_flows_library_layer.sql
--
-- Idempotency for flows in the adoption saga is already enforced by the
-- existing partial unique index `flows_one_default_per_type` (one default
-- flow per artefact_type) — see 004_flows.sql. So this migration is
-- additive observability rather than a uniqueness bump:
--
--   library_layer_id — denormalised library Layer.ID this default flow
--                      was minted from. Lets re-adoption / debugging
--                      answer "which library layer drove this flow?"
--                      without going through artefact_types.library_layer_id.
--                      NULL for tenant-built flows.
-- ============================================================

BEGIN;

ALTER TABLE flows
    ADD COLUMN library_layer_id UUID;

CREATE INDEX idx_flows_library_layer
    ON flows (library_layer_id)
    WHERE archived_at IS NULL;

COMMENT ON COLUMN flows.library_layer_id IS
    'Cross-DB soft FK to mmff_library.portfolio_template_layer_definitions.id. '
    'Denormalised from artefact_types.library_layer_id for fast "which '
    'library layer drove this flow?" lookups during re-adoption and '
    'debugging. NULL when the flow was tenant-built. Populated by the '
    'adoption saga (PLA-0026 B4 — writeFlowsAndStates).';

COMMIT;
