-- ============================================================
-- 084 — org_node_view_state: per-user collapse/expand (PLA-0006 / 00269)
--
-- The Topology canvas collapses by default to keep the rendered
-- node set under ~500 even at 3,000-node scale. Users expand
-- the subtrees they care about; that state is per-user, not
-- shared, so we don't pollute the layout the gadmin authored.
--
-- One row per (node, user). Updated frequently (every collapse
-- toggle); not audited — last_viewed_at is a UI hint, not a
-- security artefact.
--
-- Sole writer: backend/internal/orgdesign/service.go (story 00271).
-- ============================================================

BEGIN;

CREATE TABLE org_node_view_state (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    node_id         UUID            NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    collapsed       BOOLEAN         NOT NULL DEFAULT TRUE,
    last_viewed_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT org_node_view_state_unique UNIQUE (node_id, user_id)
);

-- Hot path: load every saved view-state row for a user when they
-- mount /topology, scoped by subscription so we ignore stale rows
-- left by a former tenant.
CREATE INDEX idx_org_node_view_state_user
    ON org_node_view_state (subscription_id, user_id);

CREATE TRIGGER trg_org_node_view_state_updated_at
    BEFORE UPDATE ON org_node_view_state
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE org_node_view_state IS
    'Per-user collapse/expand state for /topology canvas (PLA-0006). ON DELETE CASCADE on both FKs because the row has no value once either parent is gone. Not audited — last_viewed_at is a UI hint.';

COMMIT;
