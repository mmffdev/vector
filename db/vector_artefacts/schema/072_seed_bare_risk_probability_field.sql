-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 2
-- Migration 072 — promote pi_risk_probability to bare risk_probability
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 072_seed_bare_risk_probability_field.sql
--
-- DESIGN CHANGE 2026-05-16 (during application): the original "clone a NEW
-- bare row" approach is blocked by the live unique index
-- artefact_field_library_label_type_unique_live_tenant on
-- (subscription_id, label, field_type) WHERE archived_at IS NULL AND scope='tenant'.
-- Two select-typed fields with label='Risk Probability' cannot coexist.
--
-- Revised approach: rename the existing pi_risk_probability row to the bare
-- field_name 'risk_probability'. The UPDATE doesn't fire the unique check on
-- the same row. The single existing binding (Portfolio Item via
-- artefacts_types_fields) continues to point at the same row (FK by UUID,
-- not by field_name) so PI keeps working without further change.
--
-- The bare row is then bound to Risk in mig 075 alongside risk_score and
-- risk_impact (which are already bare-named — this restores symmetry).
--
-- Idempotent: WHERE field_name='pi_risk_probability' filters out the
-- already-renamed state on re-run.
--
-- Sole writer: this migration. Field-library rows are seeded, not user-edited.
-- ============================================================

BEGIN;

-- Rename the field_name. Label, field_type, options remain. UUID stable so
-- the Portfolio Item binding (artefacts_types_fields) follows the row.
UPDATE artefacts_fields_library
   SET field_name = 'risk_probability',
       description = 'Likelihood that a Risk will materialise. Combines with Risk Impact to drive severity scoring. Shared by Portfolio Item (legacy pi_risk_probability binding) and Risk (PLA-0052).',
       options_json = COALESCE(options_json, '["low", "medium", "high"]'::jsonb),
       updated_at = NOW()
 WHERE field_name = 'pi_risk_probability'
   AND subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
   AND archived_at IS NULL;

-- Sanity check: bare row exists, pi_ row does NOT.
DO $$
DECLARE
    v_bare_count INTEGER;
    v_pi_count   INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_bare_count
      FROM artefacts_fields_library
     WHERE field_name = 'risk_probability'
       AND subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
       AND archived_at IS NULL;

    SELECT COUNT(*) INTO v_pi_count
      FROM artefacts_fields_library
     WHERE field_name = 'pi_risk_probability'
       AND subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
       AND archived_at IS NULL;

    IF v_bare_count <> 1 THEN
        RAISE EXCEPTION 'Migration 072 sanity check failed: expected 1 bare risk_probability row, found %', v_bare_count;
    END IF;

    IF v_pi_count <> 0 THEN
        RAISE EXCEPTION 'Migration 072 sanity check failed: expected 0 pi_risk_probability rows, found %', v_pi_count;
    END IF;
END
$$;

COMMIT;
