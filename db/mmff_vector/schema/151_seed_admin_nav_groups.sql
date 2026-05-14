-- ============================================================
-- MMFFDev - Vector: Seed three admin nav groups per eligible user
-- Migration 151
--
-- Creates three user_nav_groups rows for every gadmin and padmin
-- who doesn't already have them, then moves the relevant catalogue
-- pages into those groups via user_nav_prefs.group_id.
--
-- Groups seeded:
--   Vector Admin    (gadmin only)  — icon: shield
--   Workspace Admin (padmin+gadmin)— icon: cog
--   User Management (padmin+gadmin)— icon: users
--
-- Pages assigned:
--   Vector Admin    → vector-admin-nav, admin-roles
--   Workspace Admin → workspace-admin, workspace-settings,
--                     portfolio-settings, portfolio-model, library-releases
--   User Management → user-management
--
-- Position: appended after each user's current highest group position.
-- Idempotent: ON CONFLICT / NOT EXISTS guards prevent duplicate rows.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Seed user_nav_groups rows
--    Use a CTE to compute each user's current max position so
--    the three new groups land at (max+1), (max+2), (max+3).
-- ============================================================

-- Workspace Admin + User Management → padmin and gadmin
WITH user_max AS (
    SELECT u.id AS user_id, COALESCE(MAX(g.position), -1) AS max_pos
    FROM users u
    LEFT JOIN user_nav_groups g ON g.user_id = u.id
    WHERE u.role IN ('padmin', 'gadmin')
    GROUP BY u.id
),
new_groups AS (
    SELECT
        user_id,
        max_pos,
        gen_random_uuid() AS grp_workspace_id,
        gen_random_uuid() AS grp_users_id
    FROM user_max
)
INSERT INTO user_nav_groups (id, user_id, label, position, icon)
SELECT grp_workspace_id, user_id, 'Workspace Admin', max_pos + 1, 'cog' FROM new_groups
WHERE NOT EXISTS (
    SELECT 1 FROM user_nav_groups g2
    WHERE g2.user_id = new_groups.user_id AND LOWER(g2.label) = 'workspace admin'
)
UNION ALL
SELECT grp_users_id, user_id, 'User Management', max_pos + 2, 'users' FROM new_groups
WHERE NOT EXISTS (
    SELECT 1 FROM user_nav_groups g2
    WHERE g2.user_id = new_groups.user_id AND LOWER(g2.label) = 'user management'
);

-- Vector Admin → gadmin only (appended after current max, which may now include above inserts)
INSERT INTO user_nav_groups (id, user_id, label, position, icon)
SELECT
    gen_random_uuid(),
    u.id,
    'Vector Admin',
    COALESCE((SELECT MAX(g.position) FROM user_nav_groups g WHERE g.user_id = u.id), -1) + 1,
    'shield'
FROM users u
WHERE u.role = 'gadmin'
  AND NOT EXISTS (
      SELECT 1 FROM user_nav_groups g2
      WHERE g2.user_id = u.id AND LOWER(g2.label) = 'vector admin'
  );

-- ============================================================
-- 2. Assign pages to groups via user_nav_prefs.group_id
--    For each user, find the group by label and update the
--    matching pref rows. Only touches rows where group_id is
--    currently NULL (don't clobber user's own customisations).
-- ============================================================

-- Workspace Admin group: workspace-admin, workspace-settings,
--   portfolio-settings, portfolio-model, library-releases
UPDATE user_nav_prefs unp
SET group_id = g.id
FROM user_nav_groups g
WHERE g.user_id = unp.user_id
  AND LOWER(g.label) = 'workspace admin'
  AND unp.item_key IN (
      'workspace-admin', 'workspace-settings',
      'portfolio-settings', 'portfolio-model', 'library-releases'
  )
  AND unp.group_id IS NULL;

-- User Management group: user-management
UPDATE user_nav_prefs unp
SET group_id = g.id
FROM user_nav_groups g
WHERE g.user_id = unp.user_id
  AND LOWER(g.label) = 'user management'
  AND unp.item_key IN ('user-management')
  AND unp.group_id IS NULL;

-- Vector Admin group: vector-admin-nav, admin-roles
UPDATE user_nav_prefs unp
SET group_id = g.id
FROM user_nav_groups g
WHERE g.user_id = unp.user_id
  AND LOWER(g.label) = 'vector admin'
  AND unp.item_key IN ('vector-admin-nav', 'admin-roles')
  AND unp.group_id IS NULL;

COMMIT;
