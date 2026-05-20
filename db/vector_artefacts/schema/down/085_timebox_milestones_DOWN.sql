-- ============================================================
-- 085_timebox_milestones_DOWN.sql
-- Rollback for 085_timebox_milestones.sql
-- NOT auto-applied.
-- ============================================================

BEGIN;

ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_timebox_milestone_id_fkey;

DROP TRIGGER IF EXISTS timebox_milestones_set_updated_at ON timebox_milestones;
DROP FUNCTION IF EXISTS timebox_milestones_set_updated_at();

DROP TABLE IF EXISTS timebox_milestones;

COMMIT;
