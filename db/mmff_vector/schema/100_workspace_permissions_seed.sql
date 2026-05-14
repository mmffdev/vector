-- ============================================================
-- 100 — Seed workspace.* permission codes (PLA-0006 / 00375)
--
-- Adds five new permission codes to the RBAC catalogue covering
-- the workspace surface introduced in migrations 098 (workspaces
-- + workspace_roles) and 099 (org_nodes.workspace_id):
--
--   workspace.create         — Create new workspaces in this tenant
--   workspace.rename         — Rename a workspace
--   workspace.archive        — Archive a workspace (soft-delete)
--   workspace.restore        — Restore an archived workspace
--   workspace.view_archived  — View archived workspaces section
--
-- Grant matrix (per acceptance criteria PLA-0006 / story 00375 #98):
--
--   gadmin (rank 30)  → all five
--   padmin (rank 25)  → workspace.create + workspace.rename only
--   team_lead / user / external → none (deferred to Phase X if ever)
--
-- Conventions follow migration 088 (the original RBAC seed):
--   - permissions.id is gen_random_uuid (code is the contract)
--   - role grants resolved by SELECT … WHERE p.code IN (…)
--   - ON CONFLICT DO NOTHING so the migration is re-runnable
--
-- Sole writer: backend/internal/roles.Service. Migration SQL is
-- the privileged bootstrap path and is exempt from
-- lint:writer-boundary.
-- ============================================================

BEGIN;

-- ── catalogue: insert five workspace.* codes ─────────────────
INSERT INTO permissions (code, label, category, description) VALUES
    ('workspace.create',         'Create workspace',
     'workspace', 'Create new workspaces in this tenant.'),
    ('workspace.rename',         'Rename workspace',
     'workspace', 'Rename a workspace.'),
    ('workspace.archive',        'Archive workspace',
     'workspace', 'Archive a workspace (soft-delete); preserves grants and tree for restore.'),
    ('workspace.restore',        'Restore workspace',
     'workspace', 'Restore an archived workspace.'),
    ('workspace.view_archived',  'View archived workspaces',
     'workspace', 'View the archived workspaces section in the workspace switcher / manage UI.')
ON CONFLICT (code) DO NOTHING;


-- ── grants: gadmin → all five workspace.* perms ──────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad30', p.id
FROM permissions p
WHERE p.code IN (
    'workspace.create',
    'workspace.rename',
    'workspace.archive',
    'workspace.restore',
    'workspace.view_archived'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ── grants: padmin → workspace.create + workspace.rename only ─
-- Per AC #98: "padmin role has workspace.create + workspace.rename only".
-- Archive / restore / view_archived stay gadmin-only at the org-admin tier.
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad25', p.id
FROM permissions p
WHERE p.code IN (
    'workspace.create',
    'workspace.rename'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
