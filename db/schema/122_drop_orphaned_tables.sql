-- db/schema/122_drop_orphaned_tables.sql
--
-- Phase 1 schema cull (per polymorphic-swimming-journal plan).
--
-- Drops 11 tables that are:
--   (a) empty in dev (verified 2026-05-07)
--   (b) referenced by zero live Go/TS handlers
--
-- Grouped here so a DBA opening \d sees one less generation of legacy
-- shape. CASCADE is used to drop residual FK constraints that point
-- INTO these tables from siblings being dropped together (e.g.
-- o_artefacts_execution_epics_field_values -> o_artefacts_execution_epics).
--
-- NOT touched in this migration:
--   * canonical_states                 -- still FK target of o_flow_*  (277 live rows)
--   * o_artefact_visibility_levels     -- still FK target of work_items + per-type artefact tables
--   * o_artefacts_execution_{defects,tasks,test_cases,strategic} et al
--                                      -- empty, but still referenced by backend/internal/artefacts
--                                         and backend/internal/searchworker; their drop is bundled
--                                         with the artefacts-package removal in a follow-up.

DROP TABLE IF EXISTS o_artefact_note_reads               CASCADE;
DROP TABLE IF EXISTS o_artefact_notes                    CASCADE;
DROP TABLE IF EXISTS o_artefact_versions                 CASCADE;

DROP TABLE IF EXISTS o_artefacts_execution_epics_field_values CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_epics              CASCADE;

DROP TABLE IF EXISTS item_field_options                  CASCADE;
DROP TABLE IF EXISTS item_field_values                   CASCADE;
DROP TABLE IF EXISTS item_field_definitions              CASCADE;
DROP TABLE IF EXISTS item_labels                         CASCADE;
DROP TABLE IF EXISTS item_tags                           CASCADE;

DROP TABLE IF EXISTS pending_library_cleanup_jobs        CASCADE;
