-- ============================================================
-- 101 — workspace_roles backfill: every gadmin → admin on every live workspace
--
-- Migration 099 seeded one Default workspace per existing subscription
-- and backfilled org_nodes.workspace_id, but did NOT seed
-- workspace_roles. The clamp middleware
-- (backend/internal/orgdesign/middleware.go, story 00378) refuses any
-- topology read for an actor without a workspace_roles row, so every
-- pre-migration tenant is locked out of /topology after 098/099 land.
--
-- This migration closes the gap by granting the admin role on every
-- live workspace to every gadmin in that tenant. Choice of `admin`
-- (vs editor/viewer) mirrors the org-tier rule that the gadmin holds
-- the top role: workspace_roles is the workspace-scoped equivalent.
--
-- Single-admin index: workspace_roles_single_admin (098) requires
-- exactly one active admin per workspace. We pick the EARLIEST
-- gadmin per (workspace, subscription) — same tie-breaker migration
-- 099 used when picking created_by — and only insert that row.
-- Subsequent gadmins (rare; usually exactly one per tenant) get no
-- row from this migration. Adding them post-MVP is a Service.Grant
-- call, not a migration concern.
--
-- Idempotency: ON CONFLICT DO NOTHING against
-- workspace_roles_active_user (workspace_id, user_id) WHERE revoked_at
-- IS NULL — re-running the migration on a half-applied DB is safe.
--
-- Bootstrap exception: the workspaces sole-writer rule
-- (db/schema/098_workspaces.sql) names migration SQL as the privileged
-- bootstrap path — same shape as the 099 backfill and the 088 RBAC
-- seed. Service.Create / Service.CreateDefault going forward seed
-- their own workspace_roles row inside the tx so this gap cannot
-- reappear (PLA-0006 / 00382 follow-up).
-- ============================================================

BEGIN;

-- One admin grant per (workspace, earliest-gadmin-in-tenant). The
-- DISTINCT ON narrows to a single user per workspace so the partial
-- unique index workspace_roles_single_admin cannot fire.
INSERT INTO workspace_roles (
    subscription_id,
    workspace_id,
    user_id,
    role,
    granted_by
)
SELECT DISTINCT ON (w.id)
    w.subscription_id,
    w.id,
    u.id,
    'admin',
    u.id            -- self-granted: bootstrap, no actor exists yet
FROM workspaces w
JOIN users u
  ON u.subscription_id = w.subscription_id
 AND u.role            = 'gadmin'
WHERE w.archived_at IS NULL
ORDER BY w.id, u.created_at ASC
ON CONFLICT DO NOTHING;

COMMIT;
