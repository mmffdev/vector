-- ============================================================
-- 085 — org_node_id FK on portfolio_items + user_stories (PLA-0006 / 00270)
--
-- Two-phase backfill:
--   Phase 1: add nullable org_node_id column with FK
--   Backfill: ensure one root org_node per subscription, set every
--             existing row to that root
--   Verify:  RAISE EXCEPTION if any row remains NULL
--   Phase 2: ALTER COLUMN SET NOT NULL
--   Indexes: hot-path index for clamp predicate ("rows the user
--            can see based on their lowest node grant")
--
-- The clamp predicate (backend/internal/orgdesign middleware) joins
-- portfolio_items / user_stories to org_nodes via org_node_id and
-- filters on the user's grant subtree. Without an index this becomes
-- a sequential scan at every list call.
--
-- Sole-writer note: org_nodes INSERTs from outside the orgdesign
-- service are forbidden at runtime. Migrations are the documented
-- exception — bootstrap rows are created here so that subsequent
-- writes from orgdesign.Service have somewhere to attach.
-- ============================================================

BEGIN;

-- ----- Phase 1: add nullable column + FK ---------------------

ALTER TABLE portfolio_items
    ADD COLUMN org_node_id UUID REFERENCES org_nodes(id) ON DELETE RESTRICT;

ALTER TABLE user_stories
    ADD COLUMN org_node_id UUID REFERENCES org_nodes(id) ON DELETE RESTRICT;

-- ----- Backfill: one root org_node per subscription ----------

-- Insert a root node per subscription using the subscription's name.
-- Idempotent via the org_nodes_root_unique partial index — re-running
-- the migration over an already-bootstrapped DB is a no-op for these
-- rows. layout_mode defaults to 'auto-horizontal'.
INSERT INTO org_nodes (subscription_id, parent_id, name, label_override)
SELECT s.id, NULL, s.name, 'Office'
FROM subscriptions s
WHERE NOT EXISTS (
    SELECT 1 FROM org_nodes n
    WHERE n.subscription_id = s.id
      AND n.parent_id IS NULL
      AND n.archived_at IS NULL
);

-- Backfill every existing portfolio_items row to its subscription's
-- root node. Archived rows included — they keep a valid FK so they
-- remain restorable.
UPDATE portfolio_items pi
SET org_node_id = (
    SELECT n.id FROM org_nodes n
    WHERE n.subscription_id = pi.subscription_id
      AND n.parent_id IS NULL
      AND n.archived_at IS NULL
    LIMIT 1
)
WHERE pi.org_node_id IS NULL;

UPDATE user_stories us
SET org_node_id = (
    SELECT n.id FROM org_nodes n
    WHERE n.subscription_id = us.subscription_id
      AND n.parent_id IS NULL
      AND n.archived_at IS NULL
    LIMIT 1
)
WHERE us.org_node_id IS NULL;

-- ----- Verification gate --------------------------------------

DO $$
DECLARE
    v_pi_nulls INTEGER;
    v_us_nulls INTEGER;
BEGIN
    SELECT count(*) INTO v_pi_nulls FROM portfolio_items WHERE org_node_id IS NULL;
    SELECT count(*) INTO v_us_nulls FROM user_stories   WHERE org_node_id IS NULL;

    IF v_pi_nulls > 0 OR v_us_nulls > 0 THEN
        RAISE EXCEPTION
            'PLA-0006 backfill incomplete: % portfolio_items rows and % user_stories rows still have NULL org_node_id. Investigate orphaned subscriptions before re-running.',
            v_pi_nulls, v_us_nulls;
    END IF;
END $$;

-- ----- Phase 2: flip to NOT NULL ------------------------------

ALTER TABLE portfolio_items
    ALTER COLUMN org_node_id SET NOT NULL;

ALTER TABLE user_stories
    ALTER COLUMN org_node_id SET NOT NULL;

-- ----- Indexes for clamp-predicate hot path -------------------

CREATE INDEX idx_portfolio_items_org_node
    ON portfolio_items (org_node_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_user_stories_org_node
    ON user_stories (org_node_id)
    WHERE archived_at IS NULL;

COMMENT ON COLUMN portfolio_items.org_node_id IS
    'PLA-0006: org node this item is scoped to. Backfilled to subscription root in migration 085, then NOT NULL. Read by clamp predicate middleware on every list endpoint.';

COMMENT ON COLUMN user_stories.org_node_id IS
    'PLA-0006: org node this story is scoped to. Backfilled to subscription root in migration 085, then NOT NULL. Read by clamp predicate middleware on every list endpoint.';

COMMIT;
