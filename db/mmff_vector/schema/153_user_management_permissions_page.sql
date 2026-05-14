-- ============================================================
-- MMFFDev - Vector: Add Permissions page to User Management group
-- Migration 153
--
-- The User Management nav group (seeded in migration 151) currently
-- only contains the 'user-management' entry (→ /workspace-settings/users).
-- Permissions is a sibling top-level tab at /workspace-settings/permissions
-- and should also appear in the User Management group.
--
-- Steps:
--   1. Catalogue entry: um-permissions → /workspace-settings/permissions
--   2. Role gate: padmin + gadmin
--   3. Backfill user_nav_prefs for existing padmin + gadmin users
--   4. Assign to User Management group
--
-- Role UUIDs (stable seeds):
--   gadmin  00000000-0000-0000-0000-00000000ad30
--   padmin  00000000-0000-0000-0000-00000000ad25
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Catalogue entry
-- ============================================================

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('um-permissions', 'Permissions', '/workspace-settings/permissions', 'lock', 'admin_settings', 'static', TRUE, TRUE, 9)
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
WHERE p.key_enum = 'um-permissions'
  AND p.subscription_id IS NULL AND p.created_by IS NULL
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Backfill user_nav_prefs for existing padmin + gadmin users
-- ============================================================

WITH base AS (
    SELECT
        u.id          AS user_id,
        u.subscription_id,
        pr.id         AS profile_id,
        COALESCE(
            (SELECT MAX(unp.position)
             FROM user_nav_prefs unp
             WHERE unp.user_id = u.id
               AND unp.subscription_id = u.subscription_id
               AND unp.profile_id = pr.id),
            -1
        ) + 1 AS next_pos
    FROM users u
    JOIN user_nav_profiles pr ON pr.user_id = u.id AND pr.subscription_id = u.subscription_id
    WHERE u.role IN ('padmin', 'gadmin')
      AND NOT EXISTS (
          SELECT 1 FROM user_nav_prefs unp
          WHERE unp.user_id = u.id
            AND unp.subscription_id = u.subscription_id
            AND unp.profile_id = pr.id
            AND unp.item_key = 'um-permissions'
      )
)
INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT user_id, subscription_id, profile_id, 'um-permissions', next_pos, FALSE
FROM base;

-- ============================================================
-- 4. Assign to User Management group
-- ============================================================

UPDATE user_nav_prefs unp
SET group_id = g.id
FROM user_nav_groups g
WHERE g.user_id = unp.user_id
  AND LOWER(g.label) = 'user management'
  AND unp.item_key = 'um-permissions'
  AND unp.group_id IS NULL;

COMMIT;
