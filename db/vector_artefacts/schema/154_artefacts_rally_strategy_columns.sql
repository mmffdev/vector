-- ============================================================
-- 154_artefacts_rally_strategy_columns.sql
--
-- Rally screenshots batch — Strategy-tier-only columns on
-- artefacts. Gated by scope (artefacts_types_scope='strategy')
-- via mig 158's trigger function.
--
-- Per audit briefing: "Portfolio Item Type" is NOT a new column
-- — it's the artefact-type registry row itself
-- (artefacts_types.artefacts_types_name). Already covered. SKIP.
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.5
--
-- ROLLBACK: db/vector_artefacts/schema/down/154_artefacts_rally_strategy_columns_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_strategic_job_size                       integer,
    ADD COLUMN IF NOT EXISTS artefacts_strategic_preliminary_estimate_value     integer;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_strategic_job_size_nonneg_chk
        CHECK (artefacts_strategic_job_size IS NULL OR artefacts_strategic_job_size >= 0);

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_strategic_preliminary_estimate_value_nonneg_chk
        CHECK (artefacts_strategic_preliminary_estimate_value IS NULL
            OR artefacts_strategic_preliminary_estimate_value >= 0);

COMMIT;
