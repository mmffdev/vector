-- db/schema/125_drop_remaining_legacy_artefact_tables.sql
--
-- Final cull of the legacy per-type artefact tables. Migration 124
-- dropped the 6 confirmed-empty siblings; these last two held a small
-- amount of demo seed data:
--   o_artefacts_execution_defects   (2 rows)
--   o_artefacts_execution_tasks     (4 rows)
--
-- Those rows are dummy payload from an earlier era. The canonical
-- demo seed (db/seed/002_work_items_poc.sql) already populates
-- obj_work_items with the equivalent fixture rows (key_nums 10-15,
-- item_type='task'/'defect'), so dropping these tables removes only
-- orphan duplicates with no live readers or writers.
--
-- The `artefacts` Go package was retired in commit 5d27279, the
-- searchworker `coreTableMap` is empty, and a tree-wide grep finds
-- no INSERT/SELECT against these tables outside historical
-- migrations.

DROP TABLE IF EXISTS o_artefacts_execution_defects CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_tasks   CASCADE;
