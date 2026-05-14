-- MMFFDev - Vector: drop obj_execution_types_overrides
-- 2026-05-13 — mmff_vector → vector_artefacts consolidation, P0
--
-- Verification before drop:
--   • 0 rows in dev DB
--   • Zero inbound FKs (no table references this one)
--   • Zero backend Go references (grep clean)
--   • Zero frontend TS references (grep clean)
--   • Only appears in db/schema/123_rename_tables_to_obj_family.sql (rename history)
--   • Not in active ETL — etl_flows.sql references siblings obj_execution_types
--     and obj_execution_types_tenant but NOT _overrides
--
-- Outbound FKs (will disappear with the table):
--   → obj_execution_types(scope_key)   ON DELETE CASCADE
--   → subscriptions(id)                 ON DELETE CASCADE
--   → users(id)                         ON DELETE RESTRICT
--
-- Restoration path if needed: 770K backup at
-- "MMFFDev - Vector Assets/db-backups/mmff_vector_20260513_053809.dump"
-- (table is empty so only schema needs restore).

BEGIN;

DROP TABLE IF EXISTS obj_execution_types_overrides;

COMMIT;
