-- ============================================================
-- MMFFDev - Vector: Drop legacy user_workspace_permissions
-- Migration 136 — applied on top of 135_rename_role_permissions_to_roles_permissions.sql
-- Run: psql -h localhost -p 5435 -U mmff_dev -d mmff_vector -f 136_drop_user_workspace_permissions.sql
--
-- The boolean ACL table user_workspace_permissions (created in 002,
-- renamed in 007) is superseded by roles_workspaces (named-role grants
-- with soft-delete + tenant scoping). All Go callers were migrated to
-- roles_workspaces and the wsperms package + /api/permissions HTTP
-- surface were removed. Frontend never consumed the endpoint.
--
-- Closes TD-DB-005.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS user_workspace_permissions;

COMMIT;
