-- ============================================================
-- 173_artefact_dependency_maps_DOWN.sql
-- Rollback for 173_artefact_dependency_maps.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_artefact_dependency_maps_root_artefact;
DROP INDEX IF EXISTS idx_artefact_dependency_maps_subscription;
DROP INDEX IF EXISTS idx_artefact_dependency_maps_workspace_node;

DROP TABLE IF EXISTS artefact_dependency_maps;

COMMIT;
