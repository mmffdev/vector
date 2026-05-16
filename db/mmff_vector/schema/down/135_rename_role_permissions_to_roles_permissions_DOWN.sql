-- DOWN for db/schema/135_rename_role_permissions_to_roles_permissions.sql
-- Reverses everything in inverse order.

BEGIN;

ALTER INDEX idx_roles_permissions_perm
    RENAME TO idx_role_permissions_perm;
ALTER INDEX roles_permissions_pkey
    RENAME TO role_permissions_pkey;

ALTER TABLE roles_permissions RENAME TO role_permissions;

COMMIT;
