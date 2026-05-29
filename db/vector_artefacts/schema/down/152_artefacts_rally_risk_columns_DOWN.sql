-- ============================================================
-- 152_artefacts_rally_risk_columns_DOWN.sql
--
-- Reverses 152 — drops the 7 CHECK constraints, the generated
-- column, and the 7 risk-* input columns.
--
-- DESTRUCTIVE: dropping the columns loses any risk data written.
-- ============================================================

BEGIN;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_resolution_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_impact_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_probability_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_response_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_impact_score_range_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_probability_score_range_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_exposure_nonneg_chk;
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_risk_calculated,
    DROP COLUMN IF EXISTS artefacts_risk_resolution,
    DROP COLUMN IF EXISTS artefacts_risk_impact,
    DROP COLUMN IF EXISTS artefacts_risk_impact_score,
    DROP COLUMN IF EXISTS artefacts_risk_probability,
    DROP COLUMN IF EXISTS artefacts_risk_probability_score,
    DROP COLUMN IF EXISTS artefacts_risk_response,
    DROP COLUMN IF EXISTS artefacts_risk_exposure;
COMMIT;
