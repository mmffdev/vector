-- ============================================================
-- 259_master_record_workspaces_column_prefix_RF1_5_5_DOWN.sql
--
-- Reverses 259_master_record_workspaces_column_prefix_RF1_5_5.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT master_record_workspaces_id_subscription_fkey
                  TO workspaces_subscription_id_fkey;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT master_record_workspaces_id_user_created_by_fkey
                  TO workspaces_created_by_fkey;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT master_record_workspaces_id_user_archived_by_fkey
                  TO workspaces_archived_by_fkey;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT master_record_workspaces_slug_chk
                  TO workspaces_slug_check;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT master_record_workspaces_name_chk
                  TO workspaces_name_check;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT master_record_workspaces_archived_pair_chk
                  TO master_record_workspaces_archived_pair;

-- ---- Index renames (reverse) ----

ALTER INDEX master_record_workspaces_id_subscription_slug_live_unique
    RENAME TO master_record_workspaces_subscription_slug_live;

ALTER INDEX idx_master_record_workspaces_id_subscription
    RENAME TO master_record_workspaces_subscription_idx;

-- ---- Column renames (reverse) ----

ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_id_user_archived_by TO archived_by;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_archived_at         TO archived_at;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_updated_at          TO updated_at;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_created_at          TO created_at;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_id_user_created_by  TO created_by;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_description         TO description;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_slug                TO slug;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_name                TO name;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_id_subscription     TO subscription_id;
ALTER TABLE master_record_workspaces RENAME COLUMN master_record_workspaces_id                  TO id;

COMMIT;
