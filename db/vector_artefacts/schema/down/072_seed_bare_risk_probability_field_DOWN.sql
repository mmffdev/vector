-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 2 — DOWN
-- Migration 072 DOWN — restore pi_risk_probability name
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f down/072_seed_bare_risk_probability_field_DOWN.sql
--
-- Reverses the rename. If mig 075 already bound the bare row to Risk, that
-- binding will continue to function (FK is by UUID) but the field_name
-- reverts. Run 075_DOWN before 072_DOWN to be safe.
-- ============================================================

BEGIN;

UPDATE artefacts_fields_library
   SET field_name = 'pi_risk_probability',
       updated_at = NOW()
 WHERE field_name = 'risk_probability'
   AND subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
   AND archived_at IS NULL;

COMMIT;
