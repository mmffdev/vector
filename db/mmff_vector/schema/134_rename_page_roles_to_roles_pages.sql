-- db/schema/134_rename_page_roles_to_roles_pages.sql
--
-- Rename page_roles -> roles_pages so role-related tables cluster
-- together when sorted by name (`\dt roles*`):
--   roles, role_permissions, roles_org_nodes, roles_pages,
--   roles_workspaces.
-- Sibling rename of role_permissions is intentionally deferred —
-- this migration handles page_roles only to keep blast radius
-- small (PLA-0026 follow-up to migrations 132 + 133).
--
-- Pure rename; no data movement, no FK target breakage. The
-- dependent FK constraint names (page_roles_page_id_fkey,
-- page_roles_role_id_fkey) stay literal — Postgres only retargets
-- the referenced table, not the constraint name. Indexes are
-- renamed so a fresh DB matches a renamed one.
--
-- No CHECK constraints, no triggers on this table — it's the
-- simplest of the family. The transitional dual-column state
-- (`role` user_role enum + `role_id` UUID FK from PLA-0007 G2)
-- is unaffected by the rename and remains for separate cleanup.

BEGIN;

-- 1. Table
ALTER TABLE page_roles RENAME TO roles_pages;

-- 2. PK index (table rename does not auto-rename the PK index)
ALTER INDEX page_roles_pkey
    RENAME TO roles_pages_pkey;

-- 3. Other indexes
ALTER INDEX idx_page_roles_role
    RENAME TO idx_roles_pages_role;
ALTER INDEX idx_page_roles_role_id
    RENAME TO idx_roles_pages_role_id;

-- 4. Comment refresh
COMMENT ON TABLE roles_pages IS
    'Page-level role grants. Renamed from page_roles in migration '
    '134 so role-related tables (roles, role_permissions, '
    'roles_org_nodes, roles_pages, roles_workspaces) cluster under '
    'a roles_* prefix. Carries dual columns role (user_role enum, '
    'legacy) and role_id (UUID FK, PLA-0007 G2) during the data-'
    'driven RBAC transition; PK is currently (page_id, role).';

COMMIT;
