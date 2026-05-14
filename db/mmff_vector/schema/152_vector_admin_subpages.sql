-- ============================================================
-- MMFFDev - Vector: Register Vector Admin sub-page catalogue entries
-- Migration 152
--
-- The Vector Admin tab at /workspace-settings/vector-admin has four
-- tertiary sub-tabs. Each needs its own pages row so it can be
-- pinned as a nav item inside the "Vector Admin" group seeded in
-- migration 151.
--
-- Pages added (gadmin only):
--   va-tenant-details  → /workspace-settings/vector-admin/tenant-details
--   va-topology        → /workspace-settings/vector-admin/topology
--   va-topology-map    → /workspace-settings/vector-admin/topology-map
--   va-api-manager     → /workspace-settings/vector-admin/api-manager
--
-- After insertion, we:
--   1. Reassign the Vector Admin group to these 4 pages (remove the
--      incorrect vector-admin-nav + admin-roles assignments from 151).
--   2. Backfill user_nav_prefs for each gadmin's active profiles.
--
-- Role UUIDs (stable seeds):
--   gadmin  00000000-0000-0000-0000-00000000ad30
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Catalogue entries
-- ============================================================

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('va-tenant-details', 'Tenant Details', '/workspace-settings/vector-admin/tenant-details', 'building', 'admin_settings', 'static', TRUE, TRUE, 10),
    ('va-topology',       'Topology',       '/workspace-settings/vector-admin/topology',       'sitemap',  'admin_settings', 'static', TRUE, TRUE, 11),
    ('va-topology-map',   'Topology Map',   '/workspace-settings/vector-admin/topology-map',   'map',      'admin_settings', 'static', TRUE, TRUE, 12),
    ('va-api-manager',    'API Manager',    '/workspace-settings/vector-admin/api-manager',    'code',     'admin_settings', 'static', TRUE, TRUE, 13)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

-- ============================================================
-- 2. Role gates — gadmin only
-- ============================================================

INSERT INTO roles_pages (page_id, role_id, role)
SELECT p.id, '00000000-0000-0000-0000-00000000ad30'::uuid, 'gadmin'::user_role
FROM pages p
WHERE p.key_enum IN ('va-tenant-details', 'va-topology', 'va-topology-map', 'va-api-manager')
  AND p.subscription_id IS NULL AND p.created_by IS NULL
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Correct the Vector Admin group assignments
--    Remove the incorrect vector-admin-nav + admin-roles from 151,
--    then assign the 4 new sub-pages instead.
-- ============================================================

-- Unset group_id for the incorrectly assigned pages
UPDATE user_nav_prefs unp
SET group_id = NULL
FROM user_nav_groups g
WHERE g.id = unp.group_id
  AND LOWER(g.label) = 'vector admin'
  AND unp.item_key IN ('vector-admin-nav', 'admin-roles');

-- Assign the 4 correct pages to the Vector Admin group
-- (backfill will pin them first if not already present)
UPDATE user_nav_prefs unp
SET group_id = g.id
FROM user_nav_groups g
WHERE g.user_id = unp.user_id
  AND LOWER(g.label) = 'vector admin'
  AND unp.item_key IN ('va-tenant-details', 'va-topology', 'va-topology-map', 'va-api-manager')
  AND unp.group_id IS NULL;

-- ============================================================
-- 4. Backfill user_nav_prefs for gadmin users
--    Pin the 4 new pages into each gadmin's profiles,
--    then assign them to the Vector Admin group.
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
        WHERE key_enum IN ('va-tenant-details', 'va-topology', 'va-topology-map', 'va-api-manager')
          AND subscription_id IS NULL AND created_by IS NULL
    ) new_page
    WHERE u.role = 'gadmin'
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

-- Now assign freshly inserted (and any pre-existing) pref rows to the group
UPDATE user_nav_prefs unp
SET group_id = g.id
FROM user_nav_groups g
WHERE g.user_id = unp.user_id
  AND LOWER(g.label) = 'vector admin'
  AND unp.item_key IN ('va-tenant-details', 'va-topology', 'va-topology-map', 'va-api-manager')
  AND unp.group_id IS NULL;

COMMIT;
