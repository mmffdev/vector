-- ============================================================
-- 191_split_admin_settings_into_three_buckets.sql
--
-- Collapses the two-mechanism nav-group architecture into one.
--
-- Before: pages_tags carried a single 'admin_settings' tag (admin_menu=t,
-- excluded from rail-1) holding all 20 admin pages. Three "custom" groups
-- (Workspace Admin / User Admin / Vector Admin) were lazy-seeded into
-- users_nav_groups per-user by a hard-coded SQL CTE in nav/sql.go that
-- partitioned pages by URL prefix. That meant:
--   (a) every user got their own duplicated copies of the same system
--       groups
--   (b) page→group mapping lived in Go SQL, not data
--   (c) adding a new admin page required a Go code edit
--
-- After: three new top-level tag enums in pages_tags (workspace_admin,
-- user_admin, vector_admin) with admin_menu=FALSE so they render in
-- rail-1 like Personal / Planning / Dev Tools. The 20 admin pages are
-- retagged onto whichever new bucket fits. The 'admin_settings' tag is
-- dropped.
--
-- The hard-coded sqlLazySeedAdminNavGroups query in nav/sql.go and the
-- URL-prefix partitioning in app/redesign/components/AccountFlyout.tsx
-- are deleted in the same commit.
--
-- Standalone-page bucket assignments (no obvious URL prefix):
--   Vector Settings   /workspace-settings  → workspace_admin
--   Portfolio Settings /portfolio-settings → workspace_admin
--   Library Releases  /library-releases    → vector_admin
--   Roles             /admin/roles         → user_admin
-- ============================================================

BEGIN;

-- ---- 1. Add three new tag enums ----
-- Order them after the existing user-facing buckets but before dev_tools
-- so admin groups sit in a sensible default sort position.

INSERT INTO pages_tags (pages_tags_tag_enum, pages_tags_display_name, pages_tags_default_order, pages_tags_is_admin_menu) VALUES
    ('workspace_admin', 'Workspace Admin', 50, FALSE),
    ('user_admin',      'User Admin',      51, FALSE),
    ('vector_admin',    'Vector Admin',    52, FALSE)
ON CONFLICT (pages_tags_tag_enum) DO NOTHING;

-- ---- 2. Retag the 20 admin pages onto the new buckets ----

-- workspace_admin: /workspace-admin/* plus Vector Settings + Portfolio Settings standalones
UPDATE pages SET tag_enum = 'workspace_admin'
 WHERE tag_enum = 'admin_settings'
   AND (href LIKE '/workspace-admin%' OR href IN ('/workspace-settings', '/portfolio-settings'));

-- user_admin: /user-management/* plus Roles standalone
UPDATE pages SET tag_enum = 'user_admin'
 WHERE tag_enum = 'admin_settings'
   AND (href LIKE '/user-management%' OR href = '/admin/roles');

-- vector_admin: /vector-admin/* plus Library Releases standalone
UPDATE pages SET tag_enum = 'vector_admin'
 WHERE tag_enum = 'admin_settings'
   AND (href LIKE '/vector-admin%' OR href = '/library-releases');

-- ---- 3. Drop the now-orphaned admin_settings row ----
-- After the three UPDATEs above, no page should still carry it.

DELETE FROM pages_tags
 WHERE pages_tags_tag_enum = 'admin_settings'
   AND NOT EXISTS (SELECT 1 FROM pages WHERE tag_enum = 'admin_settings');

-- ---- 4. Wipe the lazy-seeded admin groups + their profile placements ----
-- The hard-coded sqlLazySeedAdminNavGroups is being deleted in the same
-- commit. The three per-user "Workspace Admin / User Admin / Vector Admin"
-- rows in users_nav_groups become dead state — drop them here so the
-- working tree matches the new architecture.
-- ON DELETE CASCADE on users_nav_profile_groups + ON DELETE SET NULL on
-- users_nav_prefs.users_nav_prefs_id_group handle the dependent rows
-- automatically.

DELETE FROM users_nav_groups
 WHERE users_nav_groups_label IN ('Workspace Admin', 'User Admin', 'Vector Admin');

-- ---- 5. Sanity: every admin page should now have a non-admin_settings tag ----

DO $$
DECLARE n int;
BEGIN
    SELECT COUNT(*) INTO n FROM pages WHERE tag_enum = 'admin_settings';
    IF n > 0 THEN
        RAISE EXCEPTION 'admin_settings tag still has % page(s) attached — retag mapping incomplete', n;
    END IF;
END $$;

COMMIT;
