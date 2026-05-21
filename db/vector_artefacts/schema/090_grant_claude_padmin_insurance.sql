-- ============================================================
-- 090_grant_claude_padmin_insurance.sql
--
-- Grants claude_2_test@mmffdev.com (8bcff3cb-…) an active admin grant
-- on the Insurance topology node in the dev fixture tenant. Mirror of
-- migration 089 (which did the same for padmin@mmffdev.com).
--
-- WHY:
--   claude_2_test@ is Claude's owned padmin test account (per the soft
--   rule that Claude logs in as claude_*_test@ accounts and stays off
--   the human gadmin/padmin/user accounts). Without a topology grant,
--   Claude lands on /work-items, /sprints, /scope etc. with an empty
--   scope picker and zero rows — same gap padmin@ had before mig 089.
--
--   One grant on Insurance transitively covers every descendant via the
--   ancestor-walk read gate (sqlAncestorsHasGrantOnTargetOrAncestor in
--   backend/internal/topology/sql.go). No per-child rows required.
--
-- ROLE CHOICE:
--   `editor`, not `admin`. The single-admin-per-node constraint
--   (users_roles_topology_nodes_single_admin_mvp partial unique index)
--   means Insurance can only hold ONE admin at a time, and padmin@
--   already holds it via mig 089. `editor` gives Claude the same
--   read visibility through the ancestor-walk plus write capability
--   for testing — exactly what's needed without displacing the human
--   padmin from their admin slot.
--
-- SCOPE:
--   Dev fixture tenant only (subscription_id = …001).
--
-- IDEMPOTENCY:
--   NOT EXISTS guard against an existing active grant for the same
--   (user, node) pair. Safe to re-run; safe on a freshly-seeded DB.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/090_grant_claude_padmin_insurance_DOWN.sql
-- ============================================================

BEGIN;

INSERT INTO users_roles_topology_nodes (
    users_roles_topology_nodes_id,
    users_roles_topology_nodes_id_workspace,
    users_roles_topology_nodes_id_subscription,
    users_roles_topology_nodes_id_topology_node,
    users_roles_topology_nodes_id_user,
    users_roles_topology_nodes_role_code,
    users_roles_topology_nodes_id_role,
    users_roles_topology_nodes_can_redelegate,
    users_roles_topology_nodes_id_user_granter
)
SELECT
    gen_random_uuid(),
    'a4df2e21-8d9a-452b-b4f9-eded455381c8'::uuid,   -- Insurance workspace
    '00000000-0000-0000-0000-000000000001'::uuid,   -- dev fixture sub
    'ae2d4ff5-4c8d-4839-af89-7769067476ae'::uuid,   -- Insurance topology node
    '8bcff3cb-e603-40a0-a04d-0dd6b2282a6a'::uuid,   -- claude_2_test@mmffdev.com
    'editor',                                        -- role_code (NOT admin — padmin@ holds the single admin slot on this node)
    NULL,                                            -- id_role (legacy column)
    FALSE,                                           -- can_redelegate (editor doesn't sub-grant)
    '8bcff3cb-e603-40a0-a04d-0dd6b2282a6a'::uuid    -- granter = self (seed)
WHERE NOT EXISTS (
    SELECT 1
      FROM users_roles_topology_nodes
     WHERE users_roles_topology_nodes_id_user = '8bcff3cb-e603-40a0-a04d-0dd6b2282a6a'::uuid
       AND users_roles_topology_nodes_id_topology_node = 'ae2d4ff5-4c8d-4839-af89-7769067476ae'::uuid
       AND users_roles_topology_nodes_revoked_at IS NULL
);

COMMIT;
