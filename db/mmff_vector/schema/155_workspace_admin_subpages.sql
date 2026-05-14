-- ============================================================
-- MMFFDev - Vector: Register Workspace Admin sub-page catalogue entries
-- Migration 155
--
-- The Workspace Admin tab at /workspace-settings/workspace-settings
-- has eight tertiary sub-tabs. Each needs its own pages row so it
-- can be pinned as a nav item inside the "Workspace Admin" group
-- seeded in migration 151.
--
-- Pages added (padmin + gadmin):
--   ws-organisation    → /workspace-settings/workspace-settings/organisation
--   ws-workspaces      → /workspace-settings/workspace-settings/workspaces
--   ws-portfolio-model → /workspace-settings/workspace-settings/portfolio-model
--   ws-artefact-types  → /workspace-settings/workspace-settings/artefact-types
--   ws-flow-states     → /workspace-settings/workspace-settings/flow-states
--   ws-transition-rules→ /workspace-settings/workspace-settings/transition-rules
--   ws-custom-fields   → /workspace-settings/workspace-settings/custom-fields
--   ws-flow-states-v2  → /workspace-settings/workspace-settings/flow-states-v2
--
-- After insertion:
--   1. Remove the old top-level workspace-admin page from the
--      Workspace Admin group (it was the placeholder; the sub-pages
--      replace it).
--   2. Backfill user_nav_prefs for each padmin + gadmin's active profiles.
--   3. Assign all 8 sub-pages to the Workspace Admin group.
--
-- Role UUIDs (stable seeds):
--   gadmin  00000000-0000-0000-0000-00000000ad30
--   padmin  00000000-0000-0000-0000-00000000ad25
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Catalogue entries
-- ============================================================

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('ws-organisation',     'Organisation',     '/workspace-settings/workspace-settings/organisation',     'building',  'admin_settings', 'static', TRUE, TRUE, 14),
    ('ws-workspaces',       'Workspaces',       '/workspace-settings/workspace-settings/workspaces',       'layers',    'admin_settings', 'static', TRUE, TRUE, 15),
    ('ws-portfolio-model',  'Portfolio Model',  '/workspace-settings/workspace-settings/portfolio-model',  'sitemap',   'admin_settings', 'static', TRUE, TRUE, 16),
    ('ws-artefact-types',   'Artefact Types',   '/workspace-settings/workspace-settings/artefact-types',   'package',   'admin_settings', 'static', TRUE, TRUE, 17),
    ('ws-flow-states',      'Flow States',      '/workspace-settings/workspace-settings/flow-states',      'list',      'admin_settings', 'static', TRUE, TRUE, 18),
    ('ws-transition-rules', 'Transition Rules', '/workspace-settings/workspace-settings/transition-rules', 'clipboard', 'admin_settings', 'static', TRUE, TRUE, 19),
    ('ws-custom-fields',    'Custom Fields',    '/workspace-settings/workspace-settings/custom-fields',    'pencil',    'admin_settings', 'static', TRUE, TRUE, 20),
    ('ws-flow-states-v2',   'Flow States v2',   '/workspace-settings/workspace-settings/flow-states-v2',   'list',      'admin_settings', 'static', TRUE, TRUE, 21)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

-- ============================================================
-- 2. Role gates — padmin + gadmin
-- ============================================================

INSERT INTO roles_pages (page_id, role_id, role)
SELECT p.id, r.role_id, r.role_enum::user_role
FROM pages p
CROSS JOIN (VALUES
    ('00000000-0000-0000-0000-00000000ad30'::uuid, 'gadmin'),
    ('00000000-0000-0000-0000-00000000ad25'::uuid, 'padmin')
) AS r(role_id, role_enum)
WHERE p.key_enum IN (
    'ws-organisation', 'ws-workspaces', 'ws-portfolio-model', 'ws-artefact-types',
    'ws-flow-states', 'ws-transition-rules', 'ws-custom-fields', 'ws-flow-states-v2'
)
  AND p.subscription_id IS NULL AND p.created_by IS NULL
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Remove old placeholder assignments from Workspace Admin group
--    The top-level workspace-admin, workspace-settings,
--    portfolio-settings, portfolio-model, library-releases rows
--    were assigned in migration 151 as placeholders. Unset them
--    so the 8 sub-pages replace them.
-- ============================================================

UPDATE user_nav_prefs unp
SET group_id = NULL
FROM user_nav_groups g
WHERE g.id = unp.group_id
  AND LOWER(g.label) = 'workspace admin'
  AND unp.item_key IN (
      'workspace-admin', 'workspace-settings',
      'portfolio-settings', 'portfolio-model', 'library-releases'
  );

-- ============================================================
-- 4. Backfill user_nav_prefs for padmin + gadmin users
-- ============================================================

WITH base AS (
    SELECT
        u.id          AS user_id,
        u.subscription_id,
        pr.id         AS profile_id,
        new_page.key_enum,
        COALESCE(
            (SELECT MAX(unp.position)
             FROM user_nav_prefs unp
             WHERE unp.user_id = u.id
               AND unp.subscription_id = u.subscription_id
               AND unp.profile_id = pr.id),
            -1
        ) AS max_pos,
        ROW_NUMBER() OVER (
            PARTITION BY u.id, u.subscription_id, pr.id
            ORDER BY new_page.key_enum
        ) - 1 AS rn
    FROM users u
    JOIN user_nav_profiles pr ON pr.user_id = u.id AND pr.subscription_id = u.subscription_id
    CROSS JOIN (
        SELECT key_enum FROM pages
        WHERE key_enum IN (
            'ws-organisation', 'ws-workspaces', 'ws-portfolio-model', 'ws-artefact-types',
            'ws-flow-states', 'ws-transition-rules', 'ws-custom-fields', 'ws-flow-states-v2'
        )
          AND subscription_id IS NULL AND created_by IS NULL
    ) new_page
    WHERE u.role IN ('padmin', 'gadmin')
      AND NOT EXISTS (
          SELECT 1 FROM user_nav_prefs unp
          WHERE unp.user_id = u.id
            AND unp.subscription_id = u.subscription_id
            AND unp.profile_id = pr.id
            AND unp.item_key = new_page.key_enum
      )
)
INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT user_id, subscription_id, profile_id, key_enum, max_pos + 1 + rn, FALSE
FROM base;

-- ============================================================
-- 5. Assign all 8 sub-pages to the Workspace Admin group
-- ============================================================

UPDATE user_nav_prefs unp
SET group_id = g.id
FROM user_nav_groups g
WHERE g.user_id = unp.user_id
  AND LOWER(g.label) = 'workspace admin'
  AND unp.item_key IN (
      'ws-organisation', 'ws-workspaces', 'ws-portfolio-model', 'ws-artefact-types',
      'ws-flow-states', 'ws-transition-rules', 'ws-custom-fields', 'ws-flow-states-v2'
  )
  AND unp.group_id IS NULL;

COMMIT;
