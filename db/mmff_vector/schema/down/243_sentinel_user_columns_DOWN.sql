-- ============================================================
-- 243 DOWN — Drop Sentinel user columns
--            Reverses db/mmff_vector/schema/243_sentinel_user_columns.sql
--
-- Drops the three columns + the partial index. No data loss because
-- the columns are user-preference data, not load-bearing state —
-- defaults are reapplied at the application layer (scope_up=true,
-- scope_down=true, focus=tenant root) when no row value is present.
--
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < down/243_sentinel_user_columns_DOWN.sql
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS users_default_focus_node_id_idx;

ALTER TABLE users DROP COLUMN IF EXISTS sentinel_scope_down_default;
ALTER TABLE users DROP COLUMN IF EXISTS sentinel_scope_up_default;
ALTER TABLE users DROP COLUMN IF EXISTS default_focus_node_id;

DELETE FROM schema_migrations
 WHERE filename = '243_sentinel_user_columns.sql';

COMMIT;
