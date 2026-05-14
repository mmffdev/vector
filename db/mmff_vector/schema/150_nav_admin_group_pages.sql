-- ============================================================
-- MMFFDev - Vector: Nav catalogue entries for the three admin
-- deep-link pages (PLA-0043 / 001_redesign).
-- Migration 150
--
-- The existing 'workspace-settings' entry points at /workspace-settings
-- (root redirect). We add three targeted entries that land directly
-- on the correct tab:
--
--   workspace-admin  → /workspace-settings/workspace-settings  (padmin + gadmin)
--   user-management  → /workspace-settings/users               (padmin + gadmin)
--   vector-admin-nav → /workspace-settings/vector-admin        (gadmin only)
--
-- All three go into the admin_settings tag bucket so they appear
-- under the existing "Admin Settings" rail section. They are
-- pinnable and default-pinned for the matching roles.
--
-- Role UUIDs (seeded, stable):
--   gadmin  00000000-0000-0000-0000-00000000ad30
--   padmin  00000000-0000-0000-0000-00000000ad25
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Catalogue entries
-- ============================================================

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('workspace-admin',  'Workspace Admin',  '/workspace-settings/workspace-settings', 'cog',    'admin_settings', 'static', TRUE, TRUE, 6),
    ('user-management',  'User Management',  '/workspace-settings/users',              'users',  'admin_settings', 'static', TRUE, TRUE, 7),
    ('vector-admin-nav', 'Vector Admin',     '/workspace-settings/vector-admin',       'shield', 'admin_settings', 'static', TRUE, TRUE, 8)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

-- ============================================================
-- 2. Role gates
-- ============================================================

-- workspace-admin: padmin + gadmin
INSERT INTO roles_pages (page_id, role_id, role)
SELECT p.id, r.role_id, r.role_enum::user_role
FROM pages p
CROSS JOIN (VALUES
    ('00000000-0000-0000-0000-00000000ad30'::uuid, 'gadmin'),
    ('00000000-0000-0000-0000-00000000ad25'::uuid, 'padmin')
) AS r(role_id, role_enum)
WHERE p.key_enum = 'workspace-admin'
  AND p.subscription_id IS NULL AND p.created_by IS NULL
ON CONFLICT DO NOTHING;

-- user-management: padmin + gadmin
INSERT INTO roles_pages (page_id, role_id, role)
SELECT p.id, r.role_id, r.role_enum::user_role
FROM pages p
CROSS JOIN (VALUES
    ('00000000-0000-0000-0000-00000000ad30'::uuid, 'gadmin'),
    ('00000000-0000-0000-0000-00000000ad25'::uuid, 'padmin')
) AS r(role_id, role_enum)
WHERE p.key_enum = 'user-management'
  AND p.subscription_id IS NULL AND p.created_by IS NULL
ON CONFLICT DO NOTHING;

-- vector-admin-nav: gadmin only
INSERT INTO roles_pages (page_id, role_id, role)
SELECT p.id, '00000000-0000-0000-0000-00000000ad30'::uuid, 'gadmin'::user_role
FROM pages p
WHERE p.key_enum = 'vector-admin-nav'
  AND p.subscription_id IS NULL AND p.created_by IS NULL
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Backfill user_nav_prefs for existing users
--    Mirrors pattern from migration 138 (releases_page).
--    Appends to each user's active profile(s); idempotent.
-- ============================================================

-- workspace-admin → padmin + gadmin
INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT
    u.id,
    u.subscription_id,
    pr.id,
    'workspace-admin',
    COALESCE(
        (SELECT MAX(unp.position) + 1
         FROM user_nav_prefs unp
         WHERE unp.user_id = u.id
           AND unp.subscription_id = u.subscription_id
           AND unp.profile_id = pr.id),
        0
    ),
    FALSE
FROM users u
JOIN user_nav_profiles pr ON pr.user_id = u.id AND pr.subscription_id = u.subscription_id
WHERE u.role IN ('padmin', 'gadmin')
  AND NOT EXISTS (
      SELECT 1 FROM user_nav_prefs unp
      WHERE unp.user_id = u.id
        AND unp.subscription_id = u.subscription_id
        AND unp.profile_id = pr.id
        AND unp.item_key = 'workspace-admin'
  );

-- user-management → padmin + gadmin
INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT
    u.id,
    u.subscription_id,
    pr.id,
    'user-management',
    COALESCE(
        (SELECT MAX(unp.position) + 1
         FROM user_nav_prefs unp
         WHERE unp.user_id = u.id
           AND unp.subscription_id = u.subscription_id
           AND unp.profile_id = pr.id),
        0
    ),
    FALSE
FROM users u
JOIN user_nav_profiles pr ON pr.user_id = u.id AND pr.subscription_id = u.subscription_id
WHERE u.role IN ('padmin', 'gadmin')
  AND NOT EXISTS (
      SELECT 1 FROM user_nav_prefs unp
      WHERE unp.user_id = u.id
        AND unp.subscription_id = u.subscription_id
        AND unp.profile_id = pr.id
        AND unp.item_key = 'user-management'
  );

-- vector-admin-nav → gadmin only
INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT
    u.id,
    u.subscription_id,
    pr.id,
    'vector-admin-nav',
    COALESCE(
        (SELECT MAX(unp.position) + 1
         FROM user_nav_prefs unp
         WHERE unp.user_id = u.id
           AND unp.subscription_id = u.subscription_id
           AND unp.profile_id = pr.id),
        0
    ),
    FALSE
FROM users u
JOIN user_nav_profiles pr ON pr.user_id = u.id AND pr.subscription_id = u.subscription_id
WHERE u.role = 'gadmin'
  AND NOT EXISTS (
      SELECT 1 FROM user_nav_prefs unp
      WHERE unp.user_id = u.id
        AND unp.subscription_id = u.subscription_id
        AND unp.profile_id = pr.id
        AND unp.item_key = 'vector-admin-nav'
  );

COMMIT;
