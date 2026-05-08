-- DOWN for db/schema/131_rename_workspaces_to_master_record_workspaces.sql
-- Reverses the rename in the same order, bottom-up.

BEGIN;

ALTER TRIGGER trg_master_record_workspaces_updated_at ON master_record_workspaces
    RENAME TO trg_workspaces_updated_at;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT master_record_workspaces_archived_pair
    TO workspaces_archived_pair;

ALTER INDEX master_record_workspaces_subscription_idx
    RENAME TO workspaces_subscription_idx;
ALTER INDEX master_record_workspaces_subscription_slug_live
    RENAME TO workspaces_subscription_slug_live;
ALTER INDEX master_record_workspaces_pkey
    RENAME TO workspaces_pkey;

ALTER TABLE master_record_workspaces RENAME TO workspaces;

COMMIT;
