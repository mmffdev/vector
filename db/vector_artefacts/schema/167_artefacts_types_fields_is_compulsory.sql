-- ============================================================
-- 167_artefacts_types_fields_is_compulsory.sql
--
-- Add a per-(type, custom-field) compulsory marker to the custom-field
-- binding table, so the unified field registry can answer "is this custom
-- field compulsory for this artefact type?" with one column read.
--
-- WHY:
--   Unified Field Model — Option A (registry, not physical one-table fold).
--   See docs/superpowers/specs/2026-05-30-unified-field-model-design.md and
--   handovers/handover_unified_field_registry.md. Core-field compulsory-ness
--   already lives in Go (artefactitems.CompulsoryFieldsForType); custom
--   fields had NO compulsory concept — only artefacts_types_fields_required
--   (a per-binding "required to fill in" flag, a different concern from
--   "must be PLACED on the form layout"). This column gives custom fields the
--   same compulsory-on-layout marker the core set has, so the FLB save-gate
--   and the registry read surface treat core + custom uniformly.
--
--   "Required" vs "Compulsory" are deliberately distinct:
--     artefacts_types_fields_required      → data-entry: a value must be supplied
--     artefacts_types_fields_is_compulsory → layout: the field must be PLACED on
--                                            every saved form layout for this type
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS. Re-running is a no-op. NOT NULL DEFAULT FALSE
--   backfills existing bindings to "not compulsory" (the safe default — no
--   existing layout is retroactively invalidated).
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/167_artefacts_types_fields_is_compulsory_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts_types_fields
  ADD COLUMN IF NOT EXISTS artefacts_types_fields_is_compulsory BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN artefacts_types_fields.artefacts_types_fields_is_compulsory IS
  'Per-(type, custom-field) compulsory-on-layout marker. When TRUE, the FLB '
  'save-gate requires this custom field be PLACED somewhere on the saved form '
  'layout for this artefact type (mirrors the core-field compulsory set in '
  'artefactitems.CompulsoryFieldsForType). Distinct from '
  'artefacts_types_fields_required, which governs whether a VALUE must be '
  'supplied at data-entry time.';

COMMIT;
