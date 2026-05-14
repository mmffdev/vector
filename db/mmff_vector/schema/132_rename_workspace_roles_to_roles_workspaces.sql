-- db/schema/132_rename_workspace_roles_to_roles_workspaces.sql
--
-- Rename workspace_roles -> roles_workspaces so role-related tables
-- cluster together when sorted by name (`\dt roles*`):
--   roles, role_permissions, roles_workspaces.
-- Sibling rename of org_node_roles / page_roles is intentionally
-- deferred — this migration handles workspace_roles only to keep
-- blast radius small (PLA-0026 follow-up).
--
-- Pure rename; no data movement, no FK target breakage. The
-- dependent FK constraint names (e.g. workspace_roles_user_id_fkey)
-- stay literal — Postgres only retargets the referenced table, not
-- the constraint name. Indexes, check constraint, and trigger are
-- renamed so a fresh DB matches a renamed one.

BEGIN;

-- 1. Table
ALTER TABLE workspace_roles RENAME TO roles_workspaces;

-- 2. PK index (table rename does not auto-rename the PK index)
ALTER INDEX workspace_roles_pkey
    RENAME TO roles_workspaces_pkey;

-- 3. Other indexes
ALTER INDEX workspace_roles_active_user
    RENAME TO roles_workspaces_active_user;
ALTER INDEX workspace_roles_single_admin
    RENAME TO roles_workspaces_single_admin;
ALTER INDEX workspace_roles_user_idx
    RENAME TO roles_workspaces_user_idx;

-- 4. Check constraint
ALTER TABLE roles_workspaces
    RENAME CONSTRAINT workspace_roles_revoked_pair
    TO roles_workspaces_revoked_pair;

-- 5. Trigger
ALTER TRIGGER trg_workspace_roles_updated_at ON roles_workspaces
    RENAME TO trg_roles_workspaces_updated_at;

-- 6. Comment refresh
COMMENT ON TABLE roles_workspaces IS
    'Workspace-scoped role grants. Renamed from workspace_roles in '
    'migration 132 so role-related tables (roles, role_permissions, '
    'roles_workspaces) cluster under a roles_* prefix. Mirrors '
    'org_node_roles at the workspace tier. revoked_at IS NULL = '
    'active. MVP single-admin constraint enforced via partial unique '
    'index roles_workspaces_single_admin — drop to enable multi-admin '
    'in Phase X. can_redelegate ships from day one but MVP UI does '
    'not expose it.';

COMMIT;
