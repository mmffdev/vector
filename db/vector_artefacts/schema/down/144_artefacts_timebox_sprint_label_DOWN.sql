-- ============================================================
-- 144_artefacts_timebox_sprint_label_DOWN.sql
-- Rollback for 144_artefacts_timebox_sprint_label.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
--
-- Lossless — the source data lives in timeboxes_sprints and can
-- be re-derived by the same JOIN that built the column.
-- ============================================================

BEGIN;

ALTER TABLE artefacts
  DROP COLUMN IF EXISTS artefacts_timebox_sprint_label;

COMMIT;
