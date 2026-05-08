-- db/schema/133_rename_org_node_roles_to_roles_org_nodes.sql
--
-- Rename org_node_roles -> roles_org_nodes so role-related tables
-- cluster together when sorted by name (`\dt roles*`):
--   roles, role_permissions, roles_workspaces, roles_org_nodes.
-- Sibling rename of page_roles / role_permissions is intentionally
-- deferred — this migration handles org_node_roles only to keep
-- blast radius small (PLA-0026 follow-up to migration 132).
--
-- Pure rename; no data movement, no FK target breakage. The
-- dependent FK constraint names (e.g. org_node_roles_user_id_fkey)
-- stay literal — Postgres only retargets the referenced table, not
-- the constraint name. Indexes, check constraints, and trigger are
-- renamed so a fresh DB matches a renamed one.

BEGIN;

-- 1. Table
ALTER TABLE org_node_roles RENAME TO roles_org_nodes;

-- 2. PK index (table rename does not auto-rename the PK index)
ALTER INDEX org_node_roles_pkey
    RENAME TO roles_org_nodes_pkey;

-- 3. Other indexes
ALTER INDEX org_node_roles_active_unique
    RENAME TO roles_org_nodes_active_unique;
ALTER INDEX org_node_roles_single_admin_mvp
    RENAME TO roles_org_nodes_single_admin_mvp;
ALTER INDEX idx_org_node_roles_user
    RENAME TO idx_roles_org_nodes_user;
ALTER INDEX idx_org_node_roles_node
    RENAME TO idx_roles_org_nodes_node;

-- 4. Check constraints
ALTER TABLE roles_org_nodes
    RENAME CONSTRAINT org_node_roles_revoked_pair
    TO roles_org_nodes_revoked_pair;

ALTER TABLE roles_org_nodes
    RENAME CONSTRAINT org_node_roles_role_check
    TO roles_org_nodes_role_check;

-- 5. Trigger
ALTER TRIGGER trg_org_node_roles_updated_at ON roles_org_nodes
    RENAME TO trg_roles_org_nodes_updated_at;

-- 6. Comment refresh
COMMENT ON TABLE roles_org_nodes IS
    'Node-scoped role grants for Topology (PLA-0006). Renamed from '
    'org_node_roles in migration 133 so role-related tables (roles, '
    'role_permissions, roles_workspaces, roles_org_nodes) cluster '
    'under a roles_* prefix. Overlays the subscription role on a '
    'per-node basis. revoked_at IS NULL = active. MVP single-admin '
    'constraint enforced via partial unique index '
    'roles_org_nodes_single_admin_mvp — drop to enable multi-admin '
    'in Phase X. can_redelegate ships from day one but MVP UI does '
    'not expose it.';

COMMIT;
