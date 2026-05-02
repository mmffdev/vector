-- ============================================================
-- 082 — org_nodes: Topology canvas tree (PLA-0006 / 00267)
--
-- Self-referential tree per subscription. Source of truth for
-- the tenant's organisational model — every other clamp /
-- rollup / audit feature in Vector reads from this one tree.
--
-- See docs/c_c_topology.md for the MVP decisions, and
-- dev/plans/PLA-0006.json for the plan.
--
-- Sole writer: backend/internal/orgdesign/service.go (story
-- 00271). Direct INSERT/UPDATE/DELETE from anywhere else is
-- forbidden — the boundary is policed by ripgrep CI test in
-- backend/internal/orgdesign/boundary_test.go.
--
-- Layout metadata:
--   layout_mode = 'auto-horizontal' | 'auto-vertical'
--               | 'auto-radial' | 'manual'
--   manual_x / manual_y are only consulted when
--   layout_mode = 'manual' and are persisted as multiples of
--   gridSize (default 10) per the snap-to-grid contract.
--
-- Soft-archive via archived_at (NULL = live). Archive places
-- the node and its subtree in greyed-out limbo on the canvas;
-- role grants and FKs stay intact. Cascade semantics for the
-- deep-worm-hole case are deferred to Phase X.
-- ============================================================

BEGIN;

CREATE TABLE org_nodes (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    parent_id           UUID            REFERENCES org_nodes(id) ON DELETE RESTRICT,

    name                TEXT            NOT NULL CHECK (length(trim(name)) > 0),
    description         TEXT,

    -- gadmin-named level for this node, e.g. "Department",
    -- "Squad". NULL falls back to the MVP default "Office".
    label_override      TEXT,

    icon                TEXT,
    colour              TEXT            CHECK (colour IS NULL OR colour ~ '^#[0-9a-fA-F]{6}$'),
    avatar_url          TEXT,

    layout_mode         TEXT            NOT NULL DEFAULT 'auto-horizontal'
                                            CHECK (layout_mode IN (
                                                'auto-horizontal',
                                                'auto-vertical',
                                                'auto-radial',
                                                'manual'
                                            )),
    manual_x            INTEGER,
    manual_y            INTEGER,

    collapsed_default   BOOLEAN         NOT NULL DEFAULT TRUE,

    -- sort among siblings under the same parent (within subscription).
    position            INTEGER         NOT NULL DEFAULT 0,

    archived_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- manual_x/manual_y only carry meaning when layout_mode = 'manual';
    -- enforce that they are either both NULL or both set when manual.
    CONSTRAINT org_nodes_manual_xy_pair CHECK (
        (layout_mode = 'manual' AND manual_x IS NOT NULL AND manual_y IS NOT NULL)
        OR (layout_mode <> 'manual' AND manual_x IS NULL AND manual_y IS NULL)
    )
);

-- Sibling-uniqueness on live rows: within (subscription_id, parent_id)
-- the name must be unique among non-archived nodes. NULL parent_id
-- means root — Postgres treats NULLs as distinct in standard UNIQUE,
-- so we use two partial indexes (one for parent IS NOT NULL and one
-- for parent IS NULL) to get the same shape as page_addressables.
CREATE UNIQUE INDEX org_nodes_sibling_unique
    ON org_nodes (subscription_id, parent_id, name)
    WHERE archived_at IS NULL AND parent_id IS NOT NULL;

CREATE UNIQUE INDEX org_nodes_root_unique
    ON org_nodes (subscription_id, name)
    WHERE archived_at IS NULL AND parent_id IS NULL;

-- Recursive-CTE-friendly index for subtree walks and clamp predicate.
CREATE INDEX idx_org_nodes_subscription_parent
    ON org_nodes (subscription_id, parent_id)
    WHERE archived_at IS NULL;

-- Sibling order lookups (BulkPosition, Subtree).
CREATE INDEX idx_org_nodes_sibling_order
    ON org_nodes (subscription_id, parent_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_org_nodes_updated_at
    BEFORE UPDATE ON org_nodes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE org_nodes IS
    'Topology tree (PLA-0006). Self-referential per subscription. parent_id NULL = root. label_override NULL falls back to default noun "Office". Sole writer: backend/internal/orgdesign. archived_at = limbo (greyed on canvas, kept reachable, kept revertable). Cascade-on-archive deferred to Phase X.';

COMMIT;
