-- ============================================================
-- MMFFDev - vector_artefacts: M4 (PLA-0026 / story 00479)
-- Extend artefact_types with workspace_id + library provenance columns
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 019_artefact_types_workspace_provenance.sql
--
-- Per R047 §4.1: every artefact_type belongs to exactly one workspace, and
-- when it was minted from a library layer it remembers which one (so re-
-- adoption can detect "already adopted" without re-introspection).
--
--   workspace_id       — cross-DB soft FK to mmff_vector.workspaces.id; the
--                        canonical scoping column for every read path post-
--                        cutover. NOT NULL after backfill.
--   library_layer_id   — provenance: the mmff_library.portfolio_template_layer_definitions
--                        row this type was minted from. NULL for tenant-built
--                        layers.
--   library_layer_tag  — denormalised library tag for fast "do we already
--                        have this layer?" checks during re-adoption.
--
-- Backfill convention (matches migration 015):
--   1. Prefer the real workspace row (joined via fdw_workspaces by
--      subscription_id).
--   2. Fall back to subscription_id when no workspace exists — this preserves
--      the orphan-subscription test fixture (Bulk Cross-Tenant Test, sub
--      4dbcef71-…) which has artefact_types but no workspaces row. The
--      placeholder UUID is consistent with the artefacts table that already
--      uses the same convention.
--
-- Two new partial indexes (per R047 §4.1):
--   idx_artefact_types_ws_scope_sort  — primary read path (list types in a
--      workspace, ordered).
--   uq_artefact_types_ws_scope_prefix — uniqueness invariant: within a
--      workspace + scope, every prefix is unique among live rows.
-- ============================================================

BEGIN;

-- 1. Add the three new columns (nullable initially so backfill can run).
ALTER TABLE artefact_types
    ADD COLUMN workspace_id      UUID,
    ADD COLUMN library_layer_id  UUID,
    ADD COLUMN library_layer_tag TEXT;

-- 2. Backfill workspace_id. fdw_workspaces is the postgres_fdw foreign table
--    onto mmff_vector.workspaces.
UPDATE artefact_types at
   SET workspace_id = COALESCE(
       (SELECT w.id
          FROM fdw_workspaces w
         WHERE w.subscription_id = at.subscription_id
         LIMIT 1),
       at.subscription_id  -- fallback: orphan-sub fixtures use sub_id as ws_id
   );

-- 3. Now make workspace_id NOT NULL (every row populated above).
ALTER TABLE artefact_types
    ALTER COLUMN workspace_id SET NOT NULL;

-- 4. Indexes per R047 §4.1.
CREATE INDEX idx_artefact_types_ws_scope_sort
    ON artefact_types (workspace_id, scope, sort_order)
    WHERE archived_at IS NULL;

CREATE UNIQUE INDEX uq_artefact_types_ws_scope_prefix
    ON artefact_types (workspace_id, scope, prefix)
    WHERE archived_at IS NULL;

-- 5. Comments — document the cross-DB references.
COMMENT ON COLUMN artefact_types.workspace_id IS
    'Cross-DB soft FK to mmff_vector.workspaces.id (app-enforced; canary '
    'test PLA-0026 T6 stands in for the FK). Orphan-subscription fixtures '
    'use subscription_id as a placeholder per migration 015 convention.';
COMMENT ON COLUMN artefact_types.library_layer_id IS
    'Cross-DB soft FK to mmff_library.portfolio_template_layer_definitions.id. '
    'NULL when the type was tenant-built rather than minted from a library '
    'layer; populated by the adoption saga (PLA-0026 B-series).';
COMMENT ON COLUMN artefact_types.library_layer_tag IS
    'Denormalised library tag from portfolio_template_layer_definitions.tag '
    'for fast "already adopted" lookups during re-adoption flows.';

COMMIT;
