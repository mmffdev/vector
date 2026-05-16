-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 5
-- Migration 075 — bind 12 fields to the Risk artefact type
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 075_seed_risk_type_field_bindings.sql
--
-- Binds the Risk type (from mig 071) to its field set via
-- artefacts_types_fields. Required fields drive the risk severity scoring;
-- optional fields lift the Defect work-item set.
--
-- Required (positions 10/20/30):
--   risk_score        (decimal)
--   risk_impact       (select)
--   risk_probability  (select)  ← bare row from mig 072
--
-- Optional (positions 40-120):
--   acceptance_criteria (richtext)  — used as Mitigation Plan
--   notes               (richtext)
--   blocked             (boolean)
--   blocked_reason      (textbox)
--   expedite            (boolean)
--   ready               (boolean)
--   environment         (textbox)
--   lidentifier_colour  (textbox)
--   lidentifier_type    (textbox)
--
-- Depends on: mig 071 (Risk type) + mig 072 (bare risk_probability).
-- Idempotent via the unique constraint on (artefact_type_id, field_library_id).
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_risk_type_id UUID;
    v_field_id     UUID;
    v_binding RECORD;
BEGIN
    SELECT artefacts_types_id INTO v_risk_type_id
      FROM artefacts_types
     WHERE artefacts_types_prefix = 'RSK'
       AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
       AND artefacts_types_archived_at IS NULL;

    IF v_risk_type_id IS NULL THEN
        RAISE EXCEPTION 'Migration 075: Risk type not found. Apply mig 071 first.';
    END IF;

    FOR v_binding IN
        SELECT * FROM (VALUES
            ('risk_score',          10,  TRUE),
            ('risk_impact',         20,  TRUE),
            ('risk_probability',    30,  TRUE),
            ('acceptance_criteria', 40,  FALSE),
            ('notes',               50,  FALSE),
            ('blocked',             60,  FALSE),
            ('blocked_reason',      70,  FALSE),
            ('expedite',            80,  FALSE),
            ('ready',               90,  FALSE),
            ('environment',         100, FALSE),
            ('lidentifier_colour',  110, FALSE),
            ('lidentifier_type',    120, FALSE)
        ) AS t(field_name, position, required)
    LOOP
        SELECT id INTO v_field_id
          FROM artefacts_fields_library
         WHERE field_name = v_binding.field_name
           AND subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
           AND archived_at IS NULL;

        IF v_field_id IS NULL THEN
            RAISE EXCEPTION 'Migration 075: field % not found in library', v_binding.field_name;
        END IF;

        INSERT INTO artefacts_types_fields (
            artefact_type_id,
            field_library_id,
            position,
            required
        ) VALUES (
            v_risk_type_id,
            v_field_id,
            v_binding.position,
            v_binding.required
        )
        ON CONFLICT (artefact_type_id, field_library_id) DO NOTHING;
    END LOOP;
END
$$;

-- Sanity check: Risk has exactly 12 field bindings, of which 3 are required.
DO $$
DECLARE
    v_total INTEGER;
    v_required INTEGER;
    v_risk_type_id UUID;
BEGIN
    SELECT artefacts_types_id INTO v_risk_type_id
      FROM artefacts_types
     WHERE artefacts_types_prefix = 'RSK'
       AND artefacts_types_archived_at IS NULL;

    SELECT COUNT(*) INTO v_total FROM artefacts_types_fields WHERE artefact_type_id = v_risk_type_id;
    SELECT COUNT(*) INTO v_required FROM artefacts_types_fields WHERE artefact_type_id = v_risk_type_id AND required = TRUE;

    IF v_total <> 12 THEN
        RAISE EXCEPTION 'Migration 075 sanity: expected 12 Risk field bindings, found %', v_total;
    END IF;
    IF v_required <> 3 THEN
        RAISE EXCEPTION 'Migration 075 sanity: expected 3 required Risk fields, found %', v_required;
    END IF;
END
$$;

COMMIT;
