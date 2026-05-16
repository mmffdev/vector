-- MMFFDev - Vector: drop MVP single-admin workspace constraint
--
-- roles_workspaces_single_admin was a Phase-MVP guard that limited each
-- workspace to one active admin grant. The product design has no such
-- restriction — any number of users can hold the admin role on a workspace.
-- The comment in 083_org_node_roles.sql and 132_rename_workspace_roles
-- already flagged this as "drop to enable multi-admin in Phase X".
--
-- Also upgrades padmin's existing editor grant to admin to match the
-- intended full-access posture (migration 142 granted padmin all
-- workspace permissions at the permission-code level; this aligns the
-- workspace-role grant to match).

BEGIN;

DROP INDEX IF EXISTS roles_workspaces_single_admin;

-- Upgrade padmin's editor grant to admin (idempotent if already admin).
UPDATE roles_workspaces
   SET role = 'admin', updated_at = now()
 WHERE user_id = (SELECT id FROM users WHERE email = 'padmin@mmffdev.com')
   AND revoked_at IS NULL
   AND role <> 'admin';

COMMIT;
