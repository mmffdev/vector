-- db/schema/124_drop_empty_legacy_artefact_tables.sql
--
-- Phase 1.5 schema cull — drops the 6 confirmed-empty legacy per-type
-- artefact tables now that the `artefacts` Go package has been retired
-- (commit 5d27279) and the searchworker `coreTableMap` is empty.
--
-- Verified empty in dev 2026-05-07 (subscription 0001):
--   o_artefacts_execution_test_cases               (0 rows)
--   o_artefacts_execution_test_cases_field_values  (0 rows)
--   o_artefacts_execution_defects_field_values     (0 rows)
--   o_artefacts_execution_tasks_field_values       (0 rows)
--   o_artefacts_strategic                          (0 rows)
--   o_artefacts_strategic_field_values             (0 rows)
--
-- DEFERRED (still hold demo seed data; revisit when the seed is rewired
-- against obj_work_items):
--   o_artefacts_execution_defects   (2 rows — demo defects)
--   o_artefacts_execution_tasks     (4 rows — demo tasks)
--
-- NOT in this migration list because they don't exist in dev (never
-- deployed or already dropped):
--   *_template_forms, *_template_form_fields, *_schema,
--   o_artefacts_execution_user_stories*  (entire family)
--
-- CASCADE is used to drop residual FKs from the field-values children
-- pointing at the parents being dropped together (test_cases, strategic).

DROP TABLE IF EXISTS o_artefacts_execution_test_cases_field_values CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_test_cases              CASCADE;

DROP TABLE IF EXISTS o_artefacts_execution_defects_field_values    CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_tasks_field_values      CASCADE;

DROP TABLE IF EXISTS o_artefacts_strategic_field_values            CASCADE;
DROP TABLE IF EXISTS o_artefacts_strategic                         CASCADE;
