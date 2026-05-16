-- ============================================================
-- 091 — org_nodes.level_id + default level seed (PLA-0006 / 00313 + 00314)
--
-- Adds the FK from org_nodes.level_id → org_levels.id, seeds the
-- three default levels per subscription (Organisation / Department
-- / Division), then backfills every existing org_nodes row from
-- its computed tree depth.
--
-- Two-phase NOT NULL flip:
--   Phase 1 (this migration): add column nullable, seed levels,
--   backfill, then ALTER … SET NOT NULL once every row has a value.
--
-- The depth invariant — node.level.depth = tree-depth(node) — is
-- enforced from now on at the service layer
-- (backend/internal/orgdesign/service.go). This migration sets
-- the initial state correctly; service code keeps it correct.
--
-- Sole writer rule for org_levels is documented in migration 090.
-- This migration is the one documented exception (bootstrap seed),
-- mirroring the org_nodes bootstrap exception in migration 085.
-- ============================================================

BEGIN;

-- 1) Seed default levels per existing subscription. Idempotent
--    via the partial unique index in migration 090 + ON CONFLICT.
INSERT INTO org_levels (subscription_id, depth, name, position)
SELECT s.id, d.depth, d.name, d.depth
  FROM subscriptions s
 CROSS JOIN (VALUES
     (0, 'Organisation'),
     (1, 'Department'),
     (2, 'Division')
 ) AS d(depth, name)
 ON CONFLICT DO NOTHING;

-- 2) Add the column nullable.
ALTER TABLE org_nodes
    ADD COLUMN level_id UUID REFERENCES org_levels(id) ON DELETE RESTRICT;

-- 3) Backfill each row's level_id from the recursive tree depth.
WITH RECURSIVE depths AS (
    SELECT id, subscription_id, parent_id, 0 AS depth
      FROM org_nodes
     WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.subscription_id, c.parent_id, d.depth + 1
      FROM org_nodes c
      JOIN depths d ON c.parent_id = d.id
)
UPDATE org_nodes n
   SET level_id = l.id
  FROM depths d
  JOIN org_levels l
    ON l.subscription_id = d.subscription_id
   AND l.depth = d.depth
   AND l.archived_at IS NULL
 WHERE n.id = d.id;

-- 4) For any subscription whose tree is deeper than the seeded
--    three levels, auto-extend with generic "Level N" rows so
--    every node has a level_id before the NOT NULL flip.
WITH RECURSIVE depths AS (
    SELECT id, subscription_id, parent_id, 0 AS depth
      FROM org_nodes
     WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.subscription_id, c.parent_id, d.depth + 1
      FROM org_nodes c
      JOIN depths d ON c.parent_id = d.id
), needed AS (
    SELECT DISTINCT subscription_id, depth
      FROM depths
     WHERE depth > 2
), missing AS (
    SELECT n.subscription_id, n.depth
      FROM needed n
      LEFT JOIN org_levels l
        ON l.subscription_id = n.subscription_id
       AND l.depth = n.depth
       AND l.archived_at IS NULL
     WHERE l.id IS NULL
)
INSERT INTO org_levels (subscription_id, depth, name, position)
SELECT subscription_id, depth, 'Level ' || (depth + 1), depth
  FROM missing;

-- Re-run the level_id backfill to catch any rows whose level row
-- was just created in step 4.
WITH RECURSIVE depths AS (
    SELECT id, subscription_id, parent_id, 0 AS depth
      FROM org_nodes
     WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.subscription_id, c.parent_id, d.depth + 1
      FROM org_nodes c
      JOIN depths d ON c.parent_id = d.id
)
UPDATE org_nodes n
   SET level_id = l.id
  FROM depths d
  JOIN org_levels l
    ON l.subscription_id = d.subscription_id
   AND l.depth = d.depth
   AND l.archived_at IS NULL
 WHERE n.id = d.id
   AND n.level_id IS NULL;

-- 5) Flip to NOT NULL — every row now has a level.
ALTER TABLE org_nodes
    ALTER COLUMN level_id SET NOT NULL;

-- 6) Index for joins from canvas reads (nodes-by-level row queries).
CREATE INDEX idx_org_nodes_level_id
    ON org_nodes (level_id)
    WHERE archived_at IS NULL;

COMMENT ON COLUMN org_nodes.level_id IS
    'FK to org_levels (PLA-0006 / 00313). Depth invariant — level.depth = tree-depth(node) — is enforced by backend/internal/orgdesign/service.go, not by a DB trigger. Sole writer: orgdesign.Service.';

COMMIT;
