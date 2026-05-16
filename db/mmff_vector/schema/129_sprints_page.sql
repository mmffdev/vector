-- ============================================================
-- MMFFDev - Vector: Register /planning/sprints nav entry  (PLA-0027)
-- Migration 129
--
-- "Sprints" is the timebox management surface for sprint planning.
-- Sits in the Planning nav group after Topology (order 6) at order 7.
-- Visible to 'user' and 'padmin' — same audience as Topology.
-- ============================================================

BEGIN;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('planning/sprints', 'Sprints', '/planning/sprints', 'timer', 'planning', 'static', TRUE, TRUE, 7)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

INSERT INTO page_roles (page_id, role_id, role)
SELECT p.id, r.role_id, r.role_enum::user_role
FROM pages p
CROSS JOIN (VALUES
    ('00000000-0000-0000-0000-00000000ad25'::uuid, 'padmin'),
    ('00000000-0000-0000-0000-00000000ad10'::uuid, 'user')
) AS r(role_id, role_enum)
WHERE p.key_enum = 'planning/sprints' AND p.subscription_id IS NULL AND p.created_by IS NULL
ON CONFLICT DO NOTHING;

-- Backfill: pin Sprints into every existing nav profile for every
-- eligible user (role = user or padmin). Mirrors migration 087.
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
WHERE u.role IN ('user', 'padmin')
  AND NOT EXISTS (
      SELECT 1 FROM user_nav_prefs unp
      WHERE unp.user_id = u.id
        AND unp.subscription_id = u.subscription_id
        AND unp.profile_id = pr.id
        AND unp.item_key = 'planning/sprints'
  );

COMMIT;
