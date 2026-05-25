-- ============================================================
-- DOWN: 092_grant_padmin_insurance_siblings.sql
--
-- Soft-revoke (stamps revoked_at) rather than hard delete — preserves
-- the audit trail and mirrors the standard topology revoke path
-- (sqlRevokeGrant in backend/internal/topology/sql.go).
--
-- Idempotent: WHERE revoked_at IS NULL skips already-revoked rows.
-- Revokes ALL THREE sibling grants in one statement.
-- ============================================================

BEGIN;

UPDATE users_roles_topology_nodes
   SET users_roles_topology_nodes_revoked_at = NOW(),
       users_roles_topology_nodes_id_user_revoker = '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid
 WHERE users_roles_topology_nodes_id_user = '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid
   AND users_roles_topology_nodes_id_topology_node IN (
       'cdaf77ab-a361-4186-be42-2ca26a445891'::uuid,  -- Retail Banking
       'b0c2dd3c-feaa-4b8a-b65e-98efc8e34901'::uuid,  -- Commercial banking
       '17ad39d0-b232-4f42-9098-acc8a0455b35'::uuid   -- Enterprise
   )
   AND users_roles_topology_nodes_revoked_at IS NULL;

COMMIT;
