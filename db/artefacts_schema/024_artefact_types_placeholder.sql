-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0026 / Story 00497 (B8)
-- Add is_placeholder marker on artefact_types.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 024_artefact_types_placeholder.sql
--
-- Re-adoption flow (R047 §8) needs a way to mark a synthetic strategy
-- artefact_type that is inserted as the "Pending re-classification" bin
-- so existing work artefacts can be re-parented to it BEFORE the old
-- strategy chain is archived. This preserves the application invariant
-- that work artefacts always have a non-NULL parent_artefact_id pointing
-- at a live strategy artefact.
--
-- The artefact_types.source CHECK only allows ('system','tenant'); we did
-- not want to widen that union (source semantics encode origin, not
-- lifecycle role). A dedicated boolean column is explicit, queryable, and
-- one row per workspace at most — cheap to maintain.
--
--   is_placeholder — TRUE only on the synthetic re-adoption bin row.
--                    Default FALSE for every existing row and every
--                    future tenant or library mint. Lookup is via the
--                    partial index below.
-- ============================================================

BEGIN;

ALTER TABLE artefact_types
    ADD COLUMN is_placeholder BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN artefact_types.is_placeholder IS
    'PLA-0026 §8: TRUE on the synthetic strategy artefact_type used as the '
    're-adoption "Pending re-classification" bin. Exactly one such row per '
    'workspace while a re-adoption is mid-flight; cleared as the workspace '
    'owner moves work items into the new model.';

-- At most one placeholder per workspace (re-adoption is single-shot).
-- Live (non-archived) constraint only — historical placeholders may
-- exist as archived rows after a clean-up pass.
CREATE UNIQUE INDEX artefact_types_one_placeholder_per_workspace
    ON artefact_types (workspace_id)
    WHERE is_placeholder = TRUE
      AND archived_at IS NULL;

COMMIT;
