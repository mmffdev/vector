-- ============================================================
-- 156_timeboxes_sprints_rally_columns.sql
--
-- Rally screenshots batch — new columns on timeboxes_sprints.
-- No scope gate (own-table semantics). Per Decision I: keep
-- existing 3-state vocab; don't broaden CHECK.
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.7
--
-- ROLLBACK: db/vector_artefacts/schema/down/156_timeboxes_sprints_rally_columns_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE timeboxes_sprints
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_actuals          numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_plan_estimate    numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_planned_velocity numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_theme            text;

ALTER TABLE timeboxes_sprints
    ADD CONSTRAINT timeboxes_sprints_actuals_nonneg_chk
        CHECK (timeboxes_sprints_actuals >= 0);

ALTER TABLE timeboxes_sprints
    ADD CONSTRAINT timeboxes_sprints_plan_estimate_nonneg_chk
        CHECK (timeboxes_sprints_plan_estimate IS NULL OR timeboxes_sprints_plan_estimate >= 0);

ALTER TABLE timeboxes_sprints
    ADD CONSTRAINT timeboxes_sprints_planned_velocity_nonneg_chk
        CHECK (timeboxes_sprints_planned_velocity IS NULL OR timeboxes_sprints_planned_velocity >= 0);

COMMIT;
