-- ============================================================
-- 152_artefacts_rally_risk_columns.sql
--
-- Rally screenshots batch — Risk-only new columns on artefacts.
-- Paired (bucket-name TEXT + bucket-value INTEGER) per Decision G,
-- plus generated column artefacts_risk_calculated = impact_score *
-- probability_score (always-correct, no drift).
--
-- Per-column CHECK on enum buckets + score ranges + non-negative
-- exposure. Slot gate to wrk_risk enforced by mig 158's trigger.
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.3
--
-- ROLLBACK: db/vector_artefacts/schema/down/152_artefacts_rally_risk_columns_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_risk_resolution             text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_impact                 text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_impact_score           integer,
    ADD COLUMN IF NOT EXISTS artefacts_risk_probability            text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_probability_score      integer,
    ADD COLUMN IF NOT EXISTS artefacts_risk_response               text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_exposure               numeric;

-- Calculated risk = impact × probability scores. Postgres-enforced; no drift possible.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_risk_calculated integer
        GENERATED ALWAYS AS (
            artefacts_risk_impact_score * artefacts_risk_probability_score
        ) STORED;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_resolution_chk
        CHECK (artefacts_risk_resolution IS NULL
            OR artefacts_risk_resolution = ANY (ARRAY[
                'accepted','mitigated','transferred','avoided','closed_no_action'
            ]));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_impact_chk
        CHECK (artefacts_risk_impact IS NULL
            OR artefacts_risk_impact = ANY (ARRAY['low','medium','high','critical']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_probability_chk
        CHECK (artefacts_risk_probability IS NULL
            OR artefacts_risk_probability = ANY (ARRAY['low','medium','high']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_response_chk
        CHECK (artefacts_risk_response IS NULL
            OR artefacts_risk_response = ANY (ARRAY['accept','mitigate','transfer','avoid']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_impact_score_range_chk
        CHECK (artefacts_risk_impact_score IS NULL
            OR (artefacts_risk_impact_score >= 1 AND artefacts_risk_impact_score <= 4));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_probability_score_range_chk
        CHECK (artefacts_risk_probability_score IS NULL
            OR (artefacts_risk_probability_score >= 1 AND artefacts_risk_probability_score <= 3));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_exposure_nonneg_chk
        CHECK (artefacts_risk_exposure IS NULL OR artefacts_risk_exposure >= 0);

COMMIT;
