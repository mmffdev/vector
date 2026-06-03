-- ============================================================
-- 175_artefact_dependency_edge_events_DOWN.sql
-- Rollback for 175_artefact_dependency_edge_events.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_artefact_dependency_edge_events_actor_time;
DROP INDEX IF EXISTS idx_artefact_dependency_edge_events_edge_time;

DROP TABLE IF EXISTS artefact_dependency_edge_events;

COMMIT;
