-- B20.4.3 (2026-05-19) — cost_centres structured entity + stub-to-FK
-- promotion + management permission.
--
-- Defence/finance buyers expect finance reconciliation reports to
-- group consistently by cost-centre — that breaks if each user types
-- a free-text value. Structured table with subscription-scoped
-- uniqueness and a parent_id hierarchy (cost-centre 1.2.3 is a
-- subset of 1.2). Forward-only.

BEGIN;

-- 1. Cost centres table.
--    - subscription_id NOT NULL — every cost centre is tenant-owned.
--    - parent_id self-FK ON DELETE RESTRICT — never silently orphan
--      child cost centres. Hierarchy depth managed by callers.
--    - code is the operator-facing label (e.g. "FIN-001"); name is
--      the human label. Partial UNIQUE on (subscription_id, code)
--      WHERE archived_at IS NULL — soft-archived rows free up their
--      code for reuse, matching the workspace/topology pattern.
--    - Standard archived_at / created_at / updated_at with auto-touch
--      trigger via the existing set_updated_at function.
CREATE TABLE cost_centres (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  parent_id       uuid REFERENCES cost_centres(id) ON DELETE RESTRICT,
  code            text NOT NULL,
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT TRUE,
  archived_at     timestamp with time zone,
  created_at      timestamp with time zone NOT NULL DEFAULT NOW(),
  updated_at      timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_centres_code_chk CHECK (length(trim(code)) > 0),
  CONSTRAINT cost_centres_name_chk CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX cost_centres_unique_code_active
  ON cost_centres (subscription_id, code)
  WHERE archived_at IS NULL;

CREATE INDEX cost_centres_parent_idx
  ON cost_centres (parent_id)
  WHERE archived_at IS NULL;

CREATE INDEX cost_centres_subscription_idx
  ON cost_centres (subscription_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER trg_cost_centres_updated_at
  BEFORE UPDATE ON cost_centres
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Promote the existing users.cost_centre_id stub (B20.4.2) to a
--    real FK. Backfill: any non-NULL value that doesn't exist in
--    cost_centres gets nulled first — the stub column was UUID-typed
--    but had no constraint, so out-of-band writes are theoretically
--    possible (none expected in dev today). Safe-default to NULL
--    rather than refuse the migration.
UPDATE users
   SET cost_centre_id = NULL
 WHERE cost_centre_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM cost_centres c WHERE c.id = users.cost_centre_id);

ALTER TABLE users
  ADD CONSTRAINT users_cost_centre_id_fkey
  FOREIGN KEY (cost_centre_id) REFERENCES cost_centres(id) ON DELETE RESTRICT;

-- 3. Permission catalogue entry.
INSERT INTO users_permissions (users_permissions_code, users_permissions_label, users_permissions_category, users_permissions_description)
VALUES (
  'cost_centres.manage',
  'Manage cost centres',
  'workspace_admin',
  'Create, edit, archive cost centres in the workspace. Required to use the cost-centres admin page and the per-user cost-centre picker.'
)
ON CONFLICT (users_permissions_code) DO NOTHING;

-- 4. Grant the new permission to gadmin (grp_global). Matches the
--    pattern used for topology.grants.manage_others — administrative
--    write access stays gadmin-only until a workspace-scoped delegation
--    model lands. Idempotent via NOT EXISTS.
INSERT INTO users_roles_permissions (users_roles_permissions_id_role, users_roles_permissions_id_permission)
SELECT r.users_roles_id, p.users_permissions_id
  FROM users_roles r, users_permissions p
 WHERE r.users_roles_code = 'grp_global'
   AND p.users_permissions_code = 'cost_centres.manage'
   AND NOT EXISTS (
     SELECT 1 FROM users_roles_permissions urp
      WHERE urp.users_roles_permissions_id_role = r.users_roles_id
        AND urp.users_roles_permissions_id_permission = p.users_permissions_id
   );

COMMIT;
