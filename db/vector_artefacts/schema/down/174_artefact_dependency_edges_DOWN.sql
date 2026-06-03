-- ============================================================
-- 174_artefact_dependency_edges_DOWN.sql
-- Rollback for 174_artefact_dependency_edges.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_artefact_dependency_edges_to;
DROP INDEX IF EXISTS idx_artefact_dependency_edges_from;
DROP INDEX IF EXISTS idx_artefact_dependency_edges_map_kind_from;
DROP INDEX IF EXISTS idx_artefact_dependency_edges_map_kind_to;
DROP INDEX IF EXISTS uq_artefact_dependency_edges_cross_kind;
DROP INDEX IF EXISTS uq_artefact_dependency_edges_parallel;
DROP INDEX IF EXISTS uq_artefact_dependency_edges_directed;

DROP TABLE IF EXISTS artefact_dependency_edges;

COMMIT;
