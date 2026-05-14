-- ============================================================
-- MMFFDev - vector_artefacts: topology_role_grants
-- Migration 032 — Node-scoped role grants (PLA-0006 / M6.2.5)
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 032_topology_role_grants.sql
--
-- Mirrors roles_org_nodes (mmff_vector), mapping node-level role grants
-- to the new topology_nodes table. ETL copies rows verbatim from
-- roles_org_nodes; original UUIDs are retained.
--
-- Role resolution:
--   The `roles` table lives in mmff_vector, not in vector_artefacts
--   (cross-database FK is impossible in Postgres). The column
--   role_code carries the string code ('admin', 'editor', 'viewer')
--   as a closed vocabulary so the grant row is self-describing
--   without needing a cross-DB join. role_id is kept as a soft UUID
--   reference for future reconciliation once roles are mirrored into
--   vector_artefacts (or removed when the RBAC model settles in Phase X).
--
-- Audit trail:
--   granted_by and revoked_by are soft UUID references (users in
--   mmff_vector). revoked_at IS NULL = active grant.
--   can_redelegate ships from day one but MVP UI does not expose it.
--
-- Sole writer once migrated: backend/internal/orgdesign (post-M6.2.7).
-- ETL: dev/scripts/etl_topology_role_grants.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS topology_role_grants (
    -- Identity
    id                  UUID            PRIMARY KEY,          -- retain from roles_org_nodes

    -- Tenancy (soft cross-DB references — no FK constraints)
    workspace_id        UUID            NOT NULL,
    subscription_id     UUID            NOT NULL,

    -- Node FK (within this DB)
    node_id             UUID            NOT NULL REFERENCES topology_nodes(id) ON DELETE RESTRICT,

    -- User (soft reference to mmff_vector.users — cross-DB, no FK)
    user_id             UUID            NOT NULL,

    -- Role — closed vocabulary matching the legacy roles_org_nodes.role CHECK.
    -- role_id is a soft reference to mmff_vector.roles; kept for reconciliation.
    role_code           TEXT            NOT NULL CHECK (role_code IN ('admin', 'editor', 'viewer')),
    role_id             UUID,           -- soft FK → mmff_vector.roles (NULL = unmapped)

    can_redelegate      BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Grant audit
    granted_by          UUID            NOT NULL,             -- soft FK → mmff_vector.users
    granted_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Revocation audit — both columns must be set together.
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID,           -- soft FK → mmff_vector.users

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- A revoke must record who revoked it.
    CONSTRAINT topology_role_grants_revoked_pair CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    )
);

-- ── Indexes ────────────────────────────────────────────────────────────────

-- One active grant per (node, user). Previous (revoked) rows kept for audit.
CREATE UNIQUE INDEX IF NOT EXISTS topology_role_grants_active_unique
    ON topology_role_grants (node_id, user_id)
    WHERE revoked_at IS NULL;

-- MVP single-admin constraint: at most one active admin per node.
-- Drop this index to enable multi-admin in Phase X.
CREATE UNIQUE INDEX IF NOT EXISTS topology_role_grants_single_admin_mvp
    ON topology_role_grants (node_id)
    WHERE revoked_at IS NULL AND role_code = 'admin';

-- Clamp predicate — "which nodes does user_id touch" (hot path).
CREATE INDEX IF NOT EXISTS idx_topology_role_grants_user
    ON topology_role_grants (workspace_id, user_id)
    WHERE revoked_at IS NULL;

-- Node detail panel — "who has access to this node".
CREATE INDEX IF NOT EXISTS idx_topology_role_grants_node
    ON topology_role_grants (node_id)
    WHERE revoked_at IS NULL;

-- ── Updated-at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION topology_role_grants_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_topology_role_grants_updated_at
    BEFORE UPDATE ON topology_role_grants
    FOR EACH ROW EXECUTE FUNCTION topology_role_grants_set_updated_at();

-- ── Table comment ───────────────────────────────────────────────────────────

COMMENT ON TABLE topology_role_grants IS
    'Node-scoped role grants for Topology (PLA-0006 / M6.2.5). '
    'Migrated from roles_org_nodes (mmff_vector) — original UUIDs retained. '
    'role_code is a self-describing closed vocabulary (admin/editor/viewer); '
    'role_id is a soft UUID reference to mmff_vector.roles (no FK — cross-DB). '
    'revoked_at IS NULL = active grant. '
    'MVP single-admin constraint enforced via partial unique index '
    'topology_role_grants_single_admin_mvp — drop to enable multi-admin in Phase X. '
    'can_redelegate ships from day one but MVP UI does not expose it. '
    'ETL: dev/scripts/etl_topology_role_grants.sql';

COMMIT;
