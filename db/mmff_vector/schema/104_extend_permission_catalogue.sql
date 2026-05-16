-- ============================================================
-- 104 — Extend permission catalogue (PLA-0007 / 00413)
--
-- Adds the permission codes the frontend role-equality migration
-- (00301) needs but the original 088 seed did not cover. Without
-- these codes, the 24 role-equality call sites flagged for 00301
-- have no `useHasPermission` target to migrate to.
--
--   library.releases.view      — gadmin badge + Library Releases pane
--   portfolio.model.edit       — padmin-only Portfolio Model wizard
--   portfolio_settings.view    — padmin / team_lead Portfolio Settings
--   portfolio_items.view       — plain-user inverse-predicate routes
--   work_items.settings.edit   — padmin Work Items configuration
--
-- Grant matrix:
--
--   gadmin (rank 30)     → library.releases.view
--   padmin (rank 25)     → portfolio.model.edit
--                          portfolio_settings.view
--                          work_items.settings.edit
--   team_lead (rank 20)  → portfolio_settings.view
--   user (rank 10)       → portfolio_items.view
--   external (rank 5)    → none
--
-- Conventions match 088 + 100:
--   - permissions.id is gen_random_uuid (code is the contract)
--   - role grants resolved by SELECT … WHERE p.code IN (…)
--   - ON CONFLICT DO NOTHING so the migration is re-runnable
--
-- Sole writer: backend/internal/roles.Service. Migration SQL is
-- the privileged bootstrap path and is exempt from
-- lint:writer-boundary.
-- ============================================================

BEGIN;

-- ── catalogue: insert five new codes ─────────────────────────
INSERT INTO permissions (code, label, category, description) VALUES
    ('library.releases.view',     'View library releases',
     'library', 'View the gadmin Library Releases pane and acknowledge release notes.'),
    ('portfolio.model.edit',      'Edit portfolio model',
     'portfolio', 'Open and apply changes to the Portfolio Model wizard (padmin tier).'),
    ('portfolio_settings.view',   'View portfolio settings',
     'portfolio', 'Read access to the Portfolio Settings surface.'),
    ('portfolio_items.view',      'View portfolio items',
     'portfolio', 'Read access to portfolio items lists at user tier (inverse-predicate routes).'),
    ('work_items.settings.edit',  'Edit work_items settings',
     'work_items', 'Open and apply changes to the Work Items configuration surface.')
ON CONFLICT (code) DO NOTHING;


-- ── grants: gadmin → library.releases.view ───────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad30', p.id
FROM permissions p
WHERE p.code IN (
    'library.releases.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ── grants: padmin → portfolio.model.edit + portfolio_settings.view + work_items.settings.edit ─
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad25', p.id
FROM permissions p
WHERE p.code IN (
    'portfolio.model.edit',
    'portfolio_settings.view',
    'work_items.settings.edit'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ── grants: team_lead → portfolio_settings.view ──────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad20', p.id
FROM permissions p
WHERE p.code IN (
    'portfolio_settings.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ── grants: user → portfolio_items.view ──────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad10', p.id
FROM permissions p
WHERE p.code IN (
    'portfolio_items.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
