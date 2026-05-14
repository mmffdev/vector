-- ============================================================
-- MMFFDev - Vector: Extend planning/sprints to gadmin  (PLA-0027)
-- Migration 130
--
-- Migration 129 granted planning/sprints to 'user' and 'padmin'.
-- This migration extends that to 'gadmin' so the page is visible
-- to all roles.
-- ============================================================

BEGIN;

INSERT INTO page_roles (page_id, role_id, role)
SELECT p.id, '00000000-0000-0000-0000-00000000ad30'::uuid, 'gadmin'::user_role
FROM pages p
WHERE p.key_enum = 'planning/sprints' AND p.subscription_id IS NULL AND p.created_by IS NULL
ON CONFLICT DO NOTHING;

-- Backfill: pin Sprints into nav profiles for gadmin users who
-- didn't get it in migration 129.
INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT
    u.id,
    u.subscription_id,
    pr.id,
    'planning/sprints',
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
        AND unp.item_key = 'planning/sprints'
  );

COMMIT;
