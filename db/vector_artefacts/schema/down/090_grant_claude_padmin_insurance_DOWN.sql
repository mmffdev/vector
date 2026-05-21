-- ============================================================
-- DOWN: 090_grant_claude_padmin_insurance.sql
--
-- Soft-revoke (stamps revoked_at) rather than hard delete — preserves
-- the audit trail. Idempotent: WHERE revoked_at IS NULL skips already-
-- revoked rows.
-- ============================================================

BEGIN;

UPDATE users_roles_topology_nodes
   SET users_roles_topology_nodes_revoked_at = NOW(),
       users_roles_topology_nodes_id_user_revoker = '8bcff3cb-e603-40a0-a04d-0dd6b2282a6a'::uuid
 WHERE users_roles_topology_nodes_id_user = '8bcff3cb-e603-40a0-a04d-0dd6b2282a6a'::uuid
   AND users_roles_topology_nodes_id_topology_node = 'ae2d4ff5-4c8d-4839-af89-7769067476ae'::uuid
   AND users_roles_topology_nodes_revoked_at IS NULL;

COMMIT;
