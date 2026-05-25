-- ============================================================
-- 092_grant_padmin_insurance_siblings.sql
--
-- Grants the human padmin (padmin@mmffdev.com) active admin
-- topology-node grants on the THREE siblings of the Insurance node
-- (Retail Banking, Commercial banking, Enterprise) in the dev fixture
-- tenant. Extends migration 089 (which granted Insurance only) so
-- padmin can move between sibling business lines without re-grant.
--
-- WHY:
--   Follow-up to migration 089. The scope-rail / Sprints picker
--   shows only the topology nodes the user holds grants on; with
--   only the Insurance grant, padmin cannot land on or pivot to
--   Retail Banking / Commercial banking / Enterprise to test
--   per-workspace scope behaviour. Three sibling grants gives
--   padmin the full set of business-line subtrees while preserving
--   the choice to grant per-business-line rather than at the parent
--   (which would be coarser and would supersede 089).
--
-- WHY NOT A PARENT GRANT:
--   Parent grant (86994198-…) via descend-inheritance would cover
--   all four siblings + Insurance with ONE row, but it would also
--   make the existing 089 grant redundant and would represent
--   "padmin can manage the parent itself", which we don't want.
--   Per-sibling grants keep authorisation surgical.
--
-- SCOPE:
--   Dev fixture tenant only (subscription_id = …001). Production
--   tenants manage their own grants via the topology grant UI.
--
-- IDEMPOTENCY:
--   NOT EXISTS guard against an existing active grant for the same
--   (user, node) pair, per row. Safe to re-run; safe on a freshly-
--   seeded DB. Wrapped in a single INSERT … SELECT … UNION ALL …
--   so all three rows land in one statement.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/092_grant_padmin_insurance_siblings_DOWN.sql
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
    'a4df2e21-8d9a-452b-b4f9-eded455381c8'::uuid,   -- shared workspace
    '00000000-0000-0000-0000-000000000001'::uuid,   -- dev fixture sub
    sib.node_id,
    '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid,   -- padmin@mmffdev.com
    'admin',                                         -- role_code
    NULL,                                            -- id_role (legacy column, NULL per sqlInsertGrant pattern)
    TRUE,                                            -- can_redelegate (padmin manages sub-grants)
    '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid    -- granter = self (seed)
FROM (
    VALUES
        ('cdaf77ab-a361-4186-be42-2ca26a445891'::uuid),  -- Retail Banking
        ('b0c2dd3c-feaa-4b8a-b65e-98efc8e34901'::uuid),  -- Commercial banking
        ('17ad39d0-b232-4f42-9098-acc8a0455b35'::uuid)   -- Enterprise
) AS sib(node_id)
WHERE NOT EXISTS (
    SELECT 1
      FROM users_roles_topology_nodes existing
     WHERE existing.users_roles_topology_nodes_id_user = '6cabe266-b2f4-43f9-879c-06020c789a0b'::uuid
       AND existing.users_roles_topology_nodes_id_topology_node = sib.node_id
       AND existing.users_roles_topology_nodes_revoked_at IS NULL
);

COMMIT;
