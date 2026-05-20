-- ============================================================
-- 089_grant_padmin_insurance.sql
--
-- Grants the human padmin (padmin@mmffdev.com) an active topology-node
-- grant on the Insurance node in the dev fixture tenant. The read gate
-- (sqlAncestorsHasGrantOnTargetOrAncestor in
-- backend/internal/topology/sql.go) walks UP from any target node and
-- returns true if the user holds a grant on the target OR any ancestor.
-- Therefore ONE grant on Insurance covers Insurance itself plus every
-- descendant — no per-child rows required.
--
-- WHY:
--   Sprint/release scope-clamp (added 2026-05-20) shows only the
--   topology nodes the user holds grants on. padmin landed on the
--   Sprints page with an empty picker because they had zero
--   users_roles_topology_nodes rows. Granting Insurance gives the
--   workspace-admin role visibility into Insurance + its full subtree.
--
-- SCOPE:
--   Dev fixture tenant only (subscription_id = …001). Production
--   tenants manage their own grants via the topology grant UI.
--
-- IDEMPOTENCY:
--   NOT EXISTS guard against an existing active grant for the same
--   (user, node) pair. Safe to re-run; safe on a freshly-seeded DB.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/089_grant_padmin_insurance_DOWN.sql
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
    '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid,   -- padmin@mmffdev.com
    'admin',                                         -- role_code
    NULL,                                            -- id_role (legacy column, kept NULL per sqlInsertGrant pattern)
    TRUE,                                            -- can_redelegate (padmin manages sub-grants)
    '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid    -- granter = self (seed)
WHERE NOT EXISTS (
    SELECT 1
      FROM users_roles_topology_nodes
     WHERE users_roles_topology_nodes_id_user = '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid
       AND users_roles_topology_nodes_id_topology_node = 'ae2d4ff5-4c8d-4839-af89-7769067476ae'::uuid
       AND users_roles_topology_nodes_revoked_at IS NULL
);

COMMIT;
