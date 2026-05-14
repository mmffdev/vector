-- Grant padmin full access to workspace-settings and related admin operations
-- This allows padmin to access all workspace-settings tabs that gadmin can access

INSERT INTO roles_permissions (role_id, permission_id)
SELECT
  '00000000-0000-0000-0000-00000000ad25' AS role_id,
  p.id AS permission_id
FROM permissions p
WHERE p.code IN (
  'workspace.archive',
  'workspace.create',
  'workspace.rename',
  'workspace.restore',
  'workspace.view_archived',
  'flows.manage'
)
AND NOT EXISTS (
  SELECT 1
  FROM roles_permissions rp
  WHERE rp.role_id = '00000000-0000-0000-0000-00000000ad25'
  AND rp.permission_id = p.id
);
