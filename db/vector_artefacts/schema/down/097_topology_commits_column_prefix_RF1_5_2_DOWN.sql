-- ============================================================
-- 097_topology_commits_column_prefix_RF1_5_2_DOWN.sql
--
-- Reverses 097_topology_commits_column_prefix_RF1_5_2.sql.
-- ============================================================

BEGIN;

-- ---- Column renames (reverse) ----

ALTER TABLE topology_commits RENAME COLUMN topology_commits_updated_at             TO updated_at;
ALTER TABLE topology_commits RENAME COLUMN topology_commits_created_at             TO created_at;
ALTER TABLE topology_commits RENAME COLUMN topology_commits_id_user_committed_by   TO committed_by;
ALTER TABLE topology_commits RENAME COLUMN topology_commits_committed_at           TO committed_at;
ALTER TABLE topology_commits RENAME COLUMN topology_commits_id_subscription        TO subscription_id;

COMMIT;
