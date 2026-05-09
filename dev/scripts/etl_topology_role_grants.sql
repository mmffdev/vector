-- ============================================================
-- ETL: roles_org_nodes (mmff_vector) → topology_role_grants (vector_artefacts)
-- PLA-0006 / M6.3.3
--
-- Run against vector_artefacts with mmff_vector accessible
-- (separate DB — use CSV export/import pattern).
--
-- Prerequisites: etl_topology_nodes.sql must have been run first
-- (topology_nodes must exist so the node_id FK resolves).
--
-- Column mapping:
--   roles_org_nodes.id              → topology_role_grants.id            (verbatim)
--   roles_org_nodes.subscription_id → topology_role_grants.subscription_id
--   roles_org_nodes.node_id         → topology_role_grants.node_id       (FK to topology_nodes)
--   roles_org_nodes.user_id         → topology_role_grants.user_id       (soft ref)
--   roles_org_nodes.role            → topology_role_grants.role_code     (rename)
--   [no source]                     → topology_role_grants.role_id       NULL (soft FK to roles)
--   roles_org_nodes.can_redelegate  → topology_role_grants.can_redelegate
--   roles_org_nodes.granted_by      → topology_role_grants.granted_by    (soft ref)
--   roles_org_nodes.granted_at      → topology_role_grants.granted_at
--   roles_org_nodes.revoked_at      → topology_role_grants.revoked_at
--   roles_org_nodes.revoked_by      → topology_role_grants.revoked_by    (soft ref)
--   roles_org_nodes.created_at      → topology_role_grants.created_at
--   roles_org_nodes.updated_at      → topology_role_grants.updated_at
--
--   workspace_id is not in roles_org_nodes — it is derived by joining
--   org_nodes.workspace_id on node_id during the Step 1 export.
--
-- role_id: roles_org_nodes does not store a role_id (it predates the
--   data-driven RBAC roles table). The column is populated NULL on import
--   and can be backfilled post-cutover via a separate reconciliation query
--   against mmff_vector.roles if needed.
--
-- Idempotent: ON CONFLICT (id) DO NOTHING.
-- ============================================================

-- ============================================================
-- STEP 1: Export from mmff_vector (run against mmff_vector DB)
-- ============================================================
-- \COPY (
--     SELECT
--         r.id,
--         n.workspace_id,
--         r.subscription_id,
--         r.node_id,
--         r.user_id,
--         r.role                       AS role_code,
--         r.can_redelegate,
--         r.granted_by,
--         r.granted_at,
--         r.revoked_at,
--         r.revoked_by,
--         r.created_at,
--         r.updated_at
--     FROM roles_org_nodes r
--     JOIN org_nodes n ON n.id = r.node_id
--     ORDER BY r.created_at ASC, r.id ASC
-- ) TO '/tmp/topology_role_grants_export.csv' CSV HEADER;

-- ============================================================
-- STEP 2: Import into vector_artefacts (run against vector_artefacts DB)
-- ============================================================

BEGIN;

-- Staging table.
CREATE TEMP TABLE topology_role_grants_import (
    id                  UUID,
    workspace_id        UUID,
    subscription_id     UUID,
    node_id             UUID,
    user_id             UUID,
    role_code           TEXT,
    can_redelegate      BOOLEAN,
    granted_by          UUID,
    granted_at          TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
);

-- Load the CSV (adjust path if needed).
-- \COPY topology_role_grants_import FROM '/tmp/topology_role_grants_export.csv' CSV HEADER;

-- Insert rows. role_id is NULL — not available from roles_org_nodes source.
-- ON CONFLICT (id) DO NOTHING makes re-runs safe.
--
-- Only insert grants where the node_id exists in topology_nodes (i.e.
-- the node ETL ran first). A grant whose node is missing would violate
-- the FK; the INNER JOIN filters those out (should be 0 in practice).
INSERT INTO topology_role_grants (
    id,
    workspace_id,
    subscription_id,
    node_id,
    user_id,
    role_code,
    role_id,
    can_redelegate,
    granted_by,
    granted_at,
    revoked_at,
    revoked_by,
    created_at,
    updated_at
)
SELECT
    imp.id,
    imp.workspace_id,
    imp.subscription_id,
    imp.node_id,
    imp.user_id,
    imp.role_code,
    NULL                AS role_id,     -- soft FK placeholder; backfill post-cutover if needed
    imp.can_redelegate,
    imp.granted_by,
    imp.granted_at,
    imp.revoked_at,
    imp.revoked_by,
    imp.created_at,
    imp.updated_at
FROM topology_role_grants_import imp
-- Guard: only import grants whose node was successfully migrated.
INNER JOIN topology_nodes tn ON tn.id = imp.node_id
ON CONFLICT (id) DO NOTHING;

-- Verification counts.
SELECT
    'grants in import file'         AS label,
    COUNT(*)                        AS count
FROM topology_role_grants_import
UNION ALL
SELECT
    'grants inserted',
    COUNT(*)
FROM topology_role_grants
UNION ALL
SELECT
    'active grants (revoked_at IS NULL)',
    COUNT(*)
FROM topology_role_grants
WHERE revoked_at IS NULL
UNION ALL
SELECT
    'grants skipped (node_id not in topology_nodes)',
    COUNT(*)
FROM topology_role_grants_import imp
WHERE NOT EXISTS (
    SELECT 1 FROM topology_nodes tn WHERE tn.id = imp.node_id
);

COMMIT;
