-- ============================================================
-- Migration 137: drop obj_work_items and obj_work_items_field_values
--
-- Work items have been fully migrated to vector_artefacts.artefacts
-- (PLA-0023, cutover complete 2026-05-07). These tables are now dead
-- code. CASCADE drops all dependent FK constraints automatically.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS obj_work_items_field_values CASCADE;
DROP TABLE IF EXISTS obj_work_items CASCADE;

COMMIT;
