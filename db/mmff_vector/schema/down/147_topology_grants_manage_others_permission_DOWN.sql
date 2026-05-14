-- ============================================================
-- DOWN: 147_topology_grants_manage_others_permission.sql
-- Removes the topology.grants.manage_others permission and its
-- role grants.
-- ============================================================

BEGIN;

DELETE FROM roles_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'topology.grants.manage_others');

DELETE FROM permissions WHERE code = 'topology.grants.manage_others';

COMMIT;
