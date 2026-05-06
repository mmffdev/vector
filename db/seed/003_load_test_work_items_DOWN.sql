-- ============================================================
-- MMFFDev - Vector: Work Items LOAD-TEST cleanup (DOWN for seed 003)
-- Removes the rows produced by db/seed/003_load_test_work_items.sql.
-- Safe to run repeatedly; matches strictly on the "LoadTest " title
-- prefix so non-test work items are never touched.
--
-- Run:
--   PGPASSWORD=… psql -h localhost -p 5435 -U mmff_dev -d mmff_vector \
--     -v ON_ERROR_STOP=1 -f db/seed/003_load_test_work_items_DOWN.sql
-- ============================================================

BEGIN;

-- Delete leaves first to avoid the FK ON DELETE SET NULL doing extra work.
DELETE FROM o_artefacts_execution_work_items
WHERE subscription_id = '00000000-0000-0000-0000-000000000001'
  AND title LIKE 'LoadTest Task %';

DELETE FROM o_artefacts_execution_work_items
WHERE subscription_id = '00000000-0000-0000-0000-000000000001'
  AND title LIKE 'LoadTest Story %';

DELETE FROM o_artefacts_execution_work_items
WHERE subscription_id = '00000000-0000-0000-0000-000000000001'
  AND title LIKE 'LoadTest Epic %';

COMMIT;
