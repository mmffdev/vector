-- ============================================================
-- MMFFDev - vector_artefacts: topology_nodes
-- Migration 031 — Topology canvas tree (PLA-0006 / M6.2.4)
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 031_topology_nodes.sql
--
-- Self-referential tree per workspace. This is the canonical new
-- home for org_nodes (currently in mmff_vector). The table retains
-- the same column set as org_nodes so ETL can copy rows verbatim,
-- including original UUIDs — critical for parent_id tree integrity.
--
-- Key differences from org_nodes in mmff_vector:
--   - workspace_id replaces subscription_id as the primary tenancy
--     column (workspace_id IS the scoping unit in vector_artefacts).
--   - subscription_id is kept as a soft reference (no FK — cross-DB)
--     to support membership checks and ETL backfill.
--   - Spatial fields x, y, width, height replace the manual_x /
--     manual_y pair and open the door for full layout-box rendering.
--   - level_id is NOT carried forward — org_levels is in mmff_vector
--     and is presentation state, not structural. The new topology
--     service derives display depth on the fly from parent_id chains.
--   - layout_mode, collapsed_default, icon, colour, avatar_url,
--     label_override, description all carry forward unchanged.
--
-- Sole writer once migrated:
--   backend/internal/orgdesign (will be rewritten to target this DB,
--   see M6.2.7 in Vector_Scope.md).
--
-- ETL: dev/scripts/etl_topology_nodes.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS topology_nodes (
    -- Identity
    id                  UUID            PRIMARY KEY,          -- retain from org_nodes (ETL)

    -- Tenancy — workspace_id is the primary scope; subscription_id is a
    -- soft cross-DB reference for membership lookup (no FK constraint).
    workspace_id        UUID            NOT NULL,
    subscription_id     UUID            NOT NULL,

    -- Tree structure
    parent_id           UUID            REFERENCES topology_nodes(id) ON DELETE RESTRICT,

    -- Display
    name                TEXT            NOT NULL CHECK (length(trim(name)) > 0),
    description         TEXT            NOT NULL DEFAULT '',
    label_override      TEXT,           -- e.g. "Department", "Squad"; NULL → default "Office"
    icon                TEXT,
    colour              TEXT            CHECK (colour IS NULL OR colour ~ '^#[0-9a-fA-F]{6}$'),
    avatar_url          TEXT,

    -- Layout — layout_mode drives auto-positioning.
    -- manual mode uses x/y; other modes leave x/y NULL.
    layout_mode         TEXT            NOT NULL DEFAULT 'auto-horizontal'
                                            CHECK (layout_mode IN (
                                                'auto-horizontal',
                                                'auto-vertical',
                                                'auto-radial',
                                                'manual'
                                            )),

    -- Spatial fields (canvas coordinates, multiples of 10px snap grid).
    -- x, y: top-left of the node box. NULL unless layout_mode = 'manual'.
    -- width, height: optional box sizing override (NULL = auto from renderer).
    x                   INTEGER,
    y                   INTEGER,
    width               INTEGER,
    height              INTEGER,

    -- Presentation
    collapsed_default   BOOLEAN         NOT NULL DEFAULT TRUE,

    -- Sort order among siblings under the same parent within a workspace.
    sort_order          INTEGER         NOT NULL DEFAULT 0,

    -- Soft-archive: NULL = live; timestamp = limbo (greyed on canvas).
    archived_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- manual x/y are only valid when layout_mode = 'manual'.
    -- width/height are always optional regardless of layout_mode.
    CONSTRAINT topology_nodes_manual_xy_pair CHECK (
        (layout_mode = 'manual' AND x IS NOT NULL AND y IS NOT NULL)
        OR (layout_mode <> 'manual' AND x IS NULL AND y IS NULL)
    )
);

-- ── Indexes ────────────────────────────────────────────────────────────────

-- Primary workspace-scoped lookup (clamp predicate, canvas fetch).
CREATE INDEX IF NOT EXISTS idx_topology_nodes_workspace
    ON topology_nodes (workspace_id)
    WHERE archived_at IS NULL;

-- Recursive-CTE subtree walk — same shape as mmff_vector's
-- idx_org_nodes_subscription_parent.
CREATE INDEX IF NOT EXISTS idx_topology_nodes_workspace_parent
    ON topology_nodes (workspace_id, parent_id)
    WHERE archived_at IS NULL;

-- Sibling sort (BulkPosition, canvas render order).
CREATE INDEX IF NOT EXISTS idx_topology_nodes_sibling_order
    ON topology_nodes (workspace_id, parent_id, sort_order)
    WHERE archived_at IS NULL;

-- ── Updated-at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION topology_nodes_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_topology_nodes_updated_at
    BEFORE UPDATE ON topology_nodes
    FOR EACH ROW EXECUTE FUNCTION topology_nodes_set_updated_at();

-- ── Table comment ───────────────────────────────────────────────────────────

COMMENT ON TABLE topology_nodes IS
    'Topology canvas tree (PLA-0006 / M6.2.4). Self-referential per workspace. '
    'parent_id NULL = root. id values are retained from org_nodes (mmff_vector) '
    'to preserve parent_id link integrity across the ETL cutover. '
    'workspace_id is the primary tenancy scope; subscription_id is a soft '
    'cross-DB reference (no FK — different database). '
    'label_override NULL → default noun "Office". '
    'archived_at = limbo (greyed on canvas, kept reachable, kept revertable). '
    'Sole writer: backend/internal/orgdesign (post-M6.2.7 rewrite). '
    'ETL: dev/scripts/etl_topology_nodes.sql';

COMMIT;
