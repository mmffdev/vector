-- ============================================================
-- 157_timeboxes_releases_rally_columns_DOWN.sql
--
-- Reverses 157 — drops the 4 CHECK constraints and the 5
-- timeboxes_releases_* columns.
-- ============================================================

BEGIN;
ALTER TABLE timeboxes_releases DROP CONSTRAINT IF EXISTS timeboxes_releases_actuals_nonneg_chk;
ALTER TABLE timeboxes_releases DROP CONSTRAINT IF EXISTS timeboxes_releases_plan_estimate_nonneg_chk;
ALTER TABLE timeboxes_releases DROP CONSTRAINT IF EXISTS timeboxes_releases_planned_velocity_nonneg_chk;
ALTER TABLE timeboxes_releases DROP CONSTRAINT IF EXISTS timeboxes_releases_gross_ratio_range_chk;
ALTER TABLE timeboxes_releases
    DROP COLUMN IF EXISTS timeboxes_releases_actuals,
    DROP COLUMN IF EXISTS timeboxes_releases_plan_estimate,
    DROP COLUMN IF EXISTS timeboxes_releases_planned_velocity,
    DROP COLUMN IF EXISTS timeboxes_releases_theme,
    DROP COLUMN IF EXISTS timeboxes_releases_gross_estimate_conversion_ratio;
COMMIT;
