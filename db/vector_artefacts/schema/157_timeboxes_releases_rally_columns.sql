-- ============================================================
-- 157_timeboxes_releases_rally_columns.sql
--
-- Rally screenshots batch — new columns on timeboxes_releases.
-- _release_backlog_items_count SKIPPED per audit (computed
-- rollup — derive from COUNT in projection, not stored).
--
-- gross_estimate_conversion_ratio bound to 0..10 range (audit
-- suggested ceiling). Other numeric columns simply non-negative.
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.8
--
-- ROLLBACK: db/vector_artefacts/schema/down/157_timeboxes_releases_rally_columns_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE timeboxes_releases
    ADD COLUMN IF NOT EXISTS timeboxes_releases_actuals                          numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_plan_estimate                    numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_planned_velocity                 numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_theme                            text,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_gross_estimate_conversion_ratio  numeric;

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_actuals_nonneg_chk
        CHECK (timeboxes_releases_actuals >= 0);

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_plan_estimate_nonneg_chk
        CHECK (timeboxes_releases_plan_estimate IS NULL OR timeboxes_releases_plan_estimate >= 0);

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_planned_velocity_nonneg_chk
        CHECK (timeboxes_releases_planned_velocity IS NULL OR timeboxes_releases_planned_velocity >= 0);

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_gross_ratio_range_chk
        CHECK (timeboxes_releases_gross_estimate_conversion_ratio IS NULL
            OR (timeboxes_releases_gross_estimate_conversion_ratio >= 0
                AND timeboxes_releases_gross_estimate_conversion_ratio <= 10));

COMMIT;
