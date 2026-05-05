-- ============================================================
-- DOWN: 112_flows_manage_permission.sql
-- Removes the flows.manage permission and its role grants.
-- ============================================================

BEGIN;

DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'flows.manage');

DELETE FROM permissions WHERE code = 'flows.manage';

COMMIT;
