-- ============================================================
-- 090 — org_levels: First-class hierarchy levels (PLA-0006 / 00313)
--
-- Levels are the horizontal rows of the Topology canvas. Each
-- subscription has its own ordered list of levels (default seed
-- in migration 091: Organisation / Department / Division). Nodes
-- reference their level by FK rather than by computed depth — so
-- the visual "level row" the user sees is a stable identity that
-- can be renamed without mass-updating subordinate rows.
--
-- Depth is the canonical sort key. The (subscription_id, depth)
-- uniqueness keeps levels strictly ordered top-to-bottom.
--
-- Sole writer: backend/internal/orgdesign/service.go. Direct
-- INSERT/UPDATE/DELETE from anywhere else is forbidden — policed
-- by ripgrep CI in backend/internal/orgdesign/boundary_test.go.
--
-- Depth invariant — node.level.depth must equal the node's tree
-- depth (root = 0, child of root = 1, etc.) — is enforced at the
-- service layer, not by a DB trigger. Service.CreateNode and
-- Service.MoveNode resolve the correct level_id from the parent's
-- depth, auto-creating a new level row when no level yet exists
-- for that depth.
-- ============================================================

BEGIN;

CREATE TABLE org_levels (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,

    -- Distance from the root row. 0 = the root level (the level
    -- that contains the root node). Strict per-subscription via
    -- the partial unique index below.
    depth               INTEGER         NOT NULL CHECK (depth >= 0),

    -- Display name shown on the left-edge level-label box.
    -- Tenants can rename freely (story 00318); default seed is
    -- "Organisation" / "Department" / "Division" (story 00314).
    name                TEXT            NOT NULL CHECK (length(trim(name)) > 0),

    -- Position is reserved for future re-ordering UI (Phase X).
    -- MVP keeps depth and position aligned 1:1.
    position            INTEGER         NOT NULL DEFAULT 0,

    archived_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- One live level per (subscription, depth). Archived levels are
-- excluded so a tenant can replace a level without violating the
-- invariant during a re-name + re-seed flow.
CREATE UNIQUE INDEX org_levels_subscription_depth_unique
    ON org_levels (subscription_id, depth)
    WHERE archived_at IS NULL;

-- Lookup index for ListLevels and resolveLevelForDepth in service.go.
CREATE INDEX idx_org_levels_subscription_position
    ON org_levels (subscription_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_org_levels_updated_at
    BEFORE UPDATE ON org_levels
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE org_levels IS
    'Topology hierarchy levels (PLA-0006 / 00313). One row per (subscription, depth). Sole writer: backend/internal/orgdesign. Depth invariant against org_nodes.level_id is enforced at the service layer.';

COMMIT;
