-- ============================================================
-- PLA-0023 / 00472 — DOWN: remove FDW objects and audit table
--
-- IMPORTANT: This does NOT remove backfilled artefact rows — that would be
-- irreversible data loss. To undo the data, restore from a pre-migration
-- backup. The schema_migrations record is also NOT removed here; remove it
-- manually if you need to re-run the forward migration:
--   DELETE FROM schema_migrations WHERE filename = '015_backfill_work_items.sql';
-- ============================================================

-- Foreign server DROP cascades to user mappings and foreign tables automatically.
DROP SERVER IF EXISTS fdw_mmff_vector CASCADE;

-- DROP FOREIGN TABLE is redundant after CASCADE but listed for clarity.
DROP FOREIGN TABLE IF EXISTS fdw_obj_work_items;
DROP FOREIGN TABLE IF EXISTS fdw_obj_flow_tenant;
DROP FOREIGN TABLE IF EXISTS fdw_workspaces;

DROP TABLE IF EXISTS etl_backfill_audit;

-- Leave the extension in place — other scripts may depend on it.
-- DROP EXTENSION IF EXISTS postgres_fdw CASCADE;
