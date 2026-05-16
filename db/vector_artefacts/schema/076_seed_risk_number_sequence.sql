-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 6
-- Migration 076 — seed RSK-NNNN number sequence for Risk type
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 076_seed_risk_number_sequence.sql
--
-- Initialises the per-subscription counter row that drives RSK-0001,
-- RSK-0002, … on artefact insert. next_num starts at 1.
--
-- Idempotent via composite PK (subscription_id, artefact_type_id).
-- Depends on: mig 071 (Risk type).
-- ============================================================

BEGIN;

INSERT INTO artefacts_number_sequences (subscription_id, artefact_type_id, next_num)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, artefacts_types_id, 1
  FROM artefacts_types
 WHERE artefacts_types_prefix = 'RSK'
   AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
   AND artefacts_types_archived_at IS NULL
ON CONFLICT (subscription_id, artefact_type_id) DO NOTHING;

-- Sanity check
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
      FROM artefacts_number_sequences ans
      JOIN artefacts_types at ON at.artefacts_types_id = ans.artefact_type_id
     WHERE at.artefacts_types_prefix = 'RSK';

    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Migration 076 sanity: expected 1 Risk sequence row, found %', v_count;
    END IF;
END
$$;

COMMIT;
