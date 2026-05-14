-- ============================================================
-- 083 — org_node_roles: node-scoped role grants (PLA-0006 / 00268)
--
-- Subscription roles (gadmin / padmin / user) remain for cross-
-- cutting concerns (billing, login). Inside Topology, roles are
-- node-scoped via this table — a user can hold different roles
-- on different nodes (admin on one Office, viewer on another).
--
-- The clamp predicate and the role predicate share the same
-- recursive-CTE machinery (see backend/internal/orgdesign).
--
-- MVP enforces at most one active admin grant per node.
-- Multi-admin per node is deferred to Phase X — the first
-- partial unique index is dropped to lift it then.
--
-- can_redelegate ships as a column from day one so we don't
-- migrate later, but the MVP UI does not expose it. Phase X
-- adds the padmin → lead re-delegation surface.
--
-- Sole writer: backend/internal/orgdesign/service.go (story 00271).
-- ============================================================

BEGIN;

CREATE TABLE org_node_roles (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    node_id         UUID            NOT NULL REFERENCES org_nodes(id) ON DELETE RESTRICT,
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    role            TEXT            NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    can_redelegate  BOOLEAN         NOT NULL DEFAULT FALSE,

    granted_by      UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    granted_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    revoked_by      UUID            REFERENCES users(id) ON DELETE RESTRICT,

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- A revoke must record who revoked it.
    CONSTRAINT org_node_roles_revoked_pair CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    )
);

-- One active grant per (node, user). A user can be re-granted after
-- revocation; previous (revoked) rows are kept for audit.
CREATE UNIQUE INDEX org_node_roles_active_unique
    ON org_node_roles (node_id, user_id)
    WHERE revoked_at IS NULL;

-- MVP-only constraint: at most one active admin per node. Drop this
-- index to enable multi-admin in Phase X.
CREATE UNIQUE INDEX org_node_roles_single_admin_mvp
    ON org_node_roles (node_id)
    WHERE revoked_at IS NULL AND role = 'admin';

-- Hot-path lookups: clamp predicate ("which nodes does user_id touch")
-- and node-detail panel ("who has access to this node").
CREATE INDEX idx_org_node_roles_user
    ON org_node_roles (subscription_id, user_id)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_org_node_roles_node
    ON org_node_roles (node_id)
    WHERE revoked_at IS NULL;

CREATE TRIGGER trg_org_node_roles_updated_at
    BEFORE UPDATE ON org_node_roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE org_node_roles IS
    'Node-scoped role grants for Topology (PLA-0006). Overlays the subscription role on a per-node basis. revoked_at IS NULL = active. MVP single-admin constraint enforced via partial unique index org_node_roles_single_admin_mvp — drop to enable multi-admin in Phase X. can_redelegate ships from day one but MVP UI does not expose it.';

COMMIT;
