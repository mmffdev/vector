-- ============================================================
-- DOWN: 089_grant_padmin_insurance.sql
--
-- Soft-revoke (stamps revoked_at) rather than hard delete — preserves
-- the audit trail and mirrors the standard topology revoke path
-- (sqlRevokeGrant in backend/internal/topology/sql.go).
--
-- Idempotent: WHERE revoked_at IS NULL skips already-revoked rows.
-- ============================================================

BEGIN;

UPDATE users_roles_topology_nodes
   SET users_roles_topology_nodes_revoked_at = NOW(),
       users_roles_topology_nodes_id_user_revoker = '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid
 WHERE users_roles_topology_nodes_id_user = '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid
   AND users_roles_topology_nodes_id_topology_node = 'ae2d4ff5-4c8d-4839-af89-7769067476ae'::uuid
   AND users_roles_topology_nodes_revoked_at IS NULL;

COMMIT;
