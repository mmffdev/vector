-- DOWN for db/schema/132_rename_workspace_roles_to_roles_workspaces.sql
-- Reverses everything in inverse order.

BEGIN;

ALTER TRIGGER trg_roles_workspaces_updated_at ON roles_workspaces
    RENAME TO trg_workspace_roles_updated_at;

ALTER TABLE roles_workspaces
    RENAME CONSTRAINT roles_workspaces_revoked_pair
    TO workspace_roles_revoked_pair;

ALTER INDEX roles_workspaces_user_idx
    RENAME TO workspace_roles_user_idx;
ALTER INDEX roles_workspaces_single_admin
    RENAME TO workspace_roles_single_admin;
ALTER INDEX roles_workspaces_active_user
    RENAME TO workspace_roles_active_user;
ALTER INDEX roles_workspaces_pkey
    RENAME TO workspace_roles_pkey;

ALTER TABLE roles_workspaces RENAME TO workspace_roles;

COMMIT;
