-- ============================================================
-- 156_timeboxes_sprints_rally_columns_DOWN.sql
--
-- Reverses 156 — drops the 3 CHECK constraints and the 4
-- timeboxes_sprints_* columns.
-- ============================================================

BEGIN;
ALTER TABLE timeboxes_sprints DROP CONSTRAINT IF EXISTS timeboxes_sprints_actuals_nonneg_chk;
ALTER TABLE timeboxes_sprints DROP CONSTRAINT IF EXISTS timeboxes_sprints_plan_estimate_nonneg_chk;
ALTER TABLE timeboxes_sprints DROP CONSTRAINT IF EXISTS timeboxes_sprints_planned_velocity_nonneg_chk;
ALTER TABLE timeboxes_sprints
    DROP COLUMN IF EXISTS timeboxes_sprints_actuals,
    DROP COLUMN IF EXISTS timeboxes_sprints_plan_estimate,
    DROP COLUMN IF EXISTS timeboxes_sprints_planned_velocity,
    DROP COLUMN IF EXISTS timeboxes_sprints_theme;
COMMIT;
