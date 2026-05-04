-- ============================================================
-- 099 — org_nodes.workspace_id + Default workspace backfill (PLA-0006 / 00374)
--
-- Adds the FK from org_nodes.workspace_id → workspaces.id, seeds
-- one "Default" workspace per existing subscription, backfills
-- every existing org_nodes row to its tenant's Default workspace,
-- then flips the column NOT NULL.
--
-- Two-phase NOT NULL flip:
--   Phase 1 (this migration): add column nullable, seed Default
--   workspaces, backfill, then ALTER … SET NOT NULL once every
--   row has a value.
--
-- Idempotency: the workspaces seed uses ON CONFLICT DO NOTHING
-- against the partial unique index workspaces_subscription_slug_live
-- (defined in migration 098), so re-running on a half-applied DB
-- does NOT create duplicate Default workspaces. Subsequent steps
-- guard with IS NULL / IF NOT EXISTS where it matters.
--
-- Soft-archive semantics: the workspace and its org_nodes subtree
-- archive together (limbo, mirrors org_nodes archive rule). FK is
-- ON DELETE RESTRICT so a workspace cannot be hard-deleted while
-- nodes still reference it — archive, do not delete.
--
-- Sole writer rule for workspaces is documented in migration 098.
-- This migration is the one documented bootstrap exception, mirroring
-- the org_levels seed in migration 091 and the org_nodes seed in 085.
-- ============================================================

BEGIN;

-- 1) Seed exactly one "Default" workspace per existing subscription.
--    created_by is the earliest gadmin in the subscription; if none
--    exists, fall back to the earliest user (defensive — every live
--    subscription has at least one gadmin, but this keeps the FK
--    honest on weird fixture data). ON CONFLICT relies on the partial
--    unique index workspaces_subscription_slug_live (subscription_id,
--    slug) WHERE archived_at IS NULL — so re-running is safe.
INSERT INTO workspaces (subscription_id, name, slug, description, created_by)
SELECT
    s.id,
    'Default',
    'default',
    'Default workspace seeded by migration 099 for backfill of org_nodes.workspace_id.',
    COALESCE(
        (SELECT u.id
           FROM users u
          WHERE u.subscription_id = s.id
            AND u.role = 'gadmin'
          ORDER BY u.created_at ASC
          LIMIT 1),
        (SELECT u.id
           FROM users u
          WHERE u.subscription_id = s.id
          ORDER BY u.created_at ASC
          LIMIT 1)
    )
  FROM subscriptions s
 WHERE EXISTS (
        SELECT 1 FROM users u WHERE u.subscription_id = s.id
       )
 ON CONFLICT DO NOTHING;

-- 2) Add the column nullable for the backfill phase. Re-runnable via
--    IF NOT EXISTS so a half-applied state can be re-applied cleanly.
ALTER TABLE org_nodes
    ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- 3) Backfill org_nodes.workspace_id from the Default workspace of
--    each tenant. Match by subscription_id + slug='default' + live
--    (archived_at IS NULL) — the same shape as the partial unique
--    index, so we hit at most one row per tenant.
UPDATE org_nodes n
   SET workspace_id = w.id
  FROM workspaces w
 WHERE w.subscription_id = n.subscription_id
   AND w.slug = 'default'
   AND w.archived_at IS NULL
   AND n.workspace_id IS NULL;

-- 4) Flip to NOT NULL — every org_nodes row now has a workspace_id.
ALTER TABLE org_nodes
    ALTER COLUMN workspace_id SET NOT NULL;

-- 5) Add the FK constraint with ON DELETE RESTRICT (archive, don't
--    delete — limbo semantics, mirrors org_nodes archive rule).
--    Guarded with a DO block so re-running on a half-applied DB does
--    not error on duplicate constraint name.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'org_nodes_workspace_id_fkey'
    ) THEN
        ALTER TABLE org_nodes
            ADD CONSTRAINT org_nodes_workspace_id_fkey
            FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id)
            ON DELETE RESTRICT;
    END IF;
END$$;

-- 6) Hot-path index for "list nodes in workspace" reads (clamp /
--    canvas / subtree fetch). Only live nodes — archived rows fall
--    out of default queries anyway.
CREATE INDEX IF NOT EXISTS idx_org_nodes_workspace_id
    ON org_nodes (workspace_id)
    WHERE archived_at IS NULL;

COMMENT ON COLUMN org_nodes.workspace_id IS
    'FK to workspaces (PLA-0006 / 00374). Every org_nodes row belongs to exactly one workspace; archive of the workspace places the entire subtree in limbo. Sole writer for the column itself: backend/internal/orgdesign/service.go (cross-workspace moves go through orgdesign + workspaces.Service together).';

COMMIT;
