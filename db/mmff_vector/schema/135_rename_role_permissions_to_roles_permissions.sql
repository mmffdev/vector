-- db/schema/135_rename_role_permissions_to_roles_permissions.sql
--
-- Rename role_permissions -> roles_permissions, completing the
-- roles_* prefix family started in 132/133/134. After this
-- migration `\dt roles*` returns the full role catalogue:
--   roles, roles_org_nodes, roles_pages, roles_permissions,
--   roles_workspaces.
--
-- This is the simplest of the four renames structurally — pkey
-- + 1 secondary index, no triggers, no check constraints. Hot
-- path nature means the smoke-test surface is large (every
-- authenticated request resolves perms via this table) but the
-- migration mechanics are unchanged from 132/133/134.
--
-- Pure rename; no data movement, no FK target breakage. The
-- dependent FK constraint names stay literal — Postgres only
-- retargets the referenced table, not the constraint name.

BEGIN;

-- 1. Table
ALTER TABLE role_permissions RENAME TO roles_permissions;

-- 2. PK index (table rename does not auto-rename the PK index)
ALTER INDEX role_permissions_pkey
    RENAME TO roles_permissions_pkey;

-- 3. Other index
ALTER INDEX idx_role_permissions_perm
    RENAME TO idx_roles_permissions_perm;

-- 4. Comment refresh
COMMENT ON TABLE roles_permissions IS
    'Role-to-permission grants. Renamed from role_permissions in '
    'migration 135 so role-related tables (roles, roles_org_nodes, '
    'roles_pages, roles_permissions, roles_workspaces) cluster '
    'under a roles_* prefix. Hot path: permissions/resolver.go '
    'reads this on every authenticated request to compute the '
    'caller''s effective permission set.';

COMMIT;
