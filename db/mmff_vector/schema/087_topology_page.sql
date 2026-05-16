-- ============================================================
-- MMFFDev - Vector: Register /topology nav entry  (PLA-0006)
-- Migration 087
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 087_topology_page.sql
--
-- "Topology" sits in the Planning nav group alongside Backlog /
-- Scope / Planning / Portfolio / Work Items / Portfolio Items.
-- Visible to 'user' and 'padmin' only — NOT 'gadmin' (gadmin
-- operates above the tenant boundary). Slots after Portfolio Items
-- at default_order 6.
-- ============================================================

BEGIN;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('topology', 'Topology', '/topology', 'sitemap', 'planning', 'static', TRUE, TRUE, 6)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

INSERT INTO page_roles (page_id, role)
SELECT id, r::user_role
FROM pages, UNNEST(ARRAY['user', 'padmin']) AS r
WHERE key_enum = 'topology' AND subscription_id IS NULL AND created_by IS NULL
ON CONFLICT DO NOTHING;

-- Backfill: pin Topology into every existing nav profile for every
-- eligible user (role = user or padmin). Mirrors migration 072.
INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT
    u.id,
    u.subscription_id,
    pr.id,
    'topology',
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
        AND unp.item_key = 'topology'
  );

COMMIT;
