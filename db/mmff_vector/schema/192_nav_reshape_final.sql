-- ============================================================
-- 192_nav_reshape_final.sql
--
-- Final reshape of the nav-rail architecture, per Rick's
-- 2026-05-14 spec. Bucket order + page contents locked:
--
--   rail-1 (top-down):
--     1.  Personal         [Dashboard, My Vista, Favourites]
--     2.  Bookmarks        (user-generated, empty by default)
--     3.  Planning         [Scope, Planning, Backlog, Portfolio,
--                           Portfolio Items, Work Items, Sprints,
--                           Releases]
--     4.  Strategy         [Risk]                (renamed from strategic)
--     5.  User Management  [User Management, Permissions, Roles]
--                          (renamed from user_admin)
--     6.  Vector Admin     [Tenant Details, Library Releases,
--                           Topology, Topology Map, API Manager]
--     7.  Workspace Admin  [Workspaces, Artefact Types,
--                           Transition Rules, Flow States,
--                           Flow States v2, Custom Fields,
--                           Portfolio Model, Organisation]
--     8.  Dev Tools        (kept, env-gating deferred per TD-NAV-001)
--
--   bottom (rail-2-style, is_admin_menu=TRUE):
--     9.  Notifications    [Notifications Manager]   (NEW bucket)
--     10. Avatar Menu      [Personal Settings, Navigation, Themes]
--                          (renamed from personal_settings)
--
-- Three redirect-stub page rows are dropped (Workspace Admin root,
-- Vector Admin root, Vector Settings root) — buckets are no longer
-- clickable pages; the rail logic routes a bucket-click to the first
-- child page in rail-2 instead.
--
-- One new page added: Notifications Manager at /notifications.
-- Source stub at app/(user)/notifications/page.tsx ships in the same
-- commit so the click renders something instead of 404.
--
-- Existing pages also moved/renamed:
--   - Theme           → moved from 'personal' to 'avatar_menu',
--                       relabelled 'Themes'
--   - Topology        → kept in 'vector_admin' (was already there
--                       post mig 191; Rick confirmed against earlier
--                       Workspace Admin spec)
--   - Topology Map    → same
--   - Navigation      → INSERT new page at /preferences/navigation,
--                       tag_enum='avatar_menu' (the page existed as
--                       a Next.js route but had no DB row).
-- ============================================================

BEGIN;

-- ───────────────────────────────────────────────────────────
-- 1. Drop the three redirect-stub page rows.
-- ───────────────────────────────────────────────────────────

DELETE FROM pages WHERE key_enum IN (
    'workspace-admin',
    'vector-admin-nav',
    'workspace-settings'
);

-- Also nuke any users_nav_prefs rows that pinned these dead key_enums
-- (CASCADE only fires when a profile is deleted; pref rows reference
-- key_enum as a string, not a FK to pages, so a page delete leaves
-- the prefs as orphan strings).
DELETE FROM users_nav_prefs WHERE users_nav_prefs_item_key IN ('workspace-admin','vector-admin-nav','workspace-settings');

DO $$
DECLARE n int;
BEGIN
    SELECT COUNT(*) INTO n FROM pages WHERE key_enum IN ('workspace-admin','vector-admin-nav','workspace-settings');
    IF n > 0 THEN RAISE EXCEPTION 'redirect stubs still present after delete: %', n; END IF;
END $$;

-- ───────────────────────────────────────────────────────────
-- 2. Rename buckets where the enum or display name changes.
--    pages_tags_tag_enum is the PK; we INSERT new row, UPDATE
--    referrers, DELETE old row.
-- ───────────────────────────────────────────────────────────

-- strategic → strategy
INSERT INTO pages_tags (pages_tags_tag_enum, pages_tags_display_name, pages_tags_default_order, pages_tags_is_admin_menu)
VALUES ('strategy', 'Strategy', 40, FALSE)
ON CONFLICT (pages_tags_tag_enum) DO NOTHING;

UPDATE pages SET tag_enum = 'strategy' WHERE tag_enum = 'strategic';
UPDATE users_nav_profile_groups SET users_nav_profile_groups_tag_enum = 'strategy' WHERE users_nav_profile_groups_tag_enum = 'strategic';

DELETE FROM pages_tags WHERE pages_tags_tag_enum = 'strategic';

-- user_admin → user_management
INSERT INTO pages_tags (pages_tags_tag_enum, pages_tags_display_name, pages_tags_default_order, pages_tags_is_admin_menu)
VALUES ('user_management', 'User Management', 50, FALSE)
ON CONFLICT (pages_tags_tag_enum) DO NOTHING;

UPDATE pages SET tag_enum = 'user_management' WHERE tag_enum = 'user_admin';
UPDATE users_nav_profile_groups SET users_nav_profile_groups_tag_enum = 'user_management' WHERE users_nav_profile_groups_tag_enum = 'user_admin';

DELETE FROM pages_tags WHERE pages_tags_tag_enum = 'user_admin';

-- personal_settings → avatar_menu
INSERT INTO pages_tags (pages_tags_tag_enum, pages_tags_display_name, pages_tags_default_order, pages_tags_is_admin_menu)
VALUES ('avatar_menu', 'Avatar Menu', 100, TRUE)
ON CONFLICT (pages_tags_tag_enum) DO NOTHING;

UPDATE pages SET tag_enum = 'avatar_menu' WHERE tag_enum = 'personal_settings';
UPDATE users_nav_profile_groups SET users_nav_profile_groups_tag_enum = 'avatar_menu' WHERE users_nav_profile_groups_tag_enum = 'personal_settings';

DELETE FROM pages_tags WHERE pages_tags_tag_enum = 'personal_settings';

-- ───────────────────────────────────────────────────────────
-- 3. Add the new Notifications bucket.
--    Sits just before avatar_menu (rail-2 area but not the avatar
--    drop-down). is_admin_menu=TRUE to keep it out of the standard
--    rail-1 placement; rail logic will render it in the bottom area
--    alongside Avatar Menu.
-- ───────────────────────────────────────────────────────────

INSERT INTO pages_tags (pages_tags_tag_enum, pages_tags_display_name, pages_tags_default_order, pages_tags_is_admin_menu)
VALUES ('notifications', 'Notifications', 95, TRUE)
ON CONFLICT (pages_tags_tag_enum) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- 4. Rebase all bucket display orders to match the locked spec.
-- ───────────────────────────────────────────────────────────

UPDATE pages_tags SET pages_tags_default_order = 10  WHERE pages_tags_tag_enum = 'personal';
UPDATE pages_tags SET pages_tags_default_order = 20  WHERE pages_tags_tag_enum = 'bookmarks';
UPDATE pages_tags SET pages_tags_default_order = 30  WHERE pages_tags_tag_enum = 'planning';
UPDATE pages_tags SET pages_tags_default_order = 40  WHERE pages_tags_tag_enum = 'strategy';
UPDATE pages_tags SET pages_tags_default_order = 50  WHERE pages_tags_tag_enum = 'user_management';
UPDATE pages_tags SET pages_tags_default_order = 60  WHERE pages_tags_tag_enum = 'vector_admin';
UPDATE pages_tags SET pages_tags_default_order = 70  WHERE pages_tags_tag_enum = 'workspace_admin';
UPDATE pages_tags SET pages_tags_default_order = 80  WHERE pages_tags_tag_enum = 'dev_tools';
UPDATE pages_tags SET pages_tags_default_order = 95  WHERE pages_tags_tag_enum = 'notifications';
UPDATE pages_tags SET pages_tags_default_order = 100 WHERE pages_tags_tag_enum = 'avatar_menu';

-- ───────────────────────────────────────────────────────────
-- 5. Move Theme → avatar_menu and rename to Themes.
-- ───────────────────────────────────────────────────────────

UPDATE pages
   SET tag_enum = 'avatar_menu',
       label    = 'Themes'
 WHERE key_enum = 'theme';

-- ───────────────────────────────────────────────────────────
-- 6. INSERT new Notifications Manager page.
--    Role grants follow the everyone-can-see baseline (gadmin,
--    padmin, user) — matches the other personal pages.
-- ───────────────────────────────────────────────────────────

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES (
    'notifications-manager',
    'Notifications Manager',
    '/notifications',
    'bell',
    'notifications',
    'static',
    TRUE,
    TRUE,
    1
)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role, users_roles_pages_role)
SELECT p.id, r.users_roles_id, r.users_roles_code::user_role
  FROM pages p
  CROSS JOIN users_roles r
 WHERE p.key_enum = 'notifications-manager'
   AND r.users_roles_is_system = TRUE
   AND r.users_roles_code IN ('gadmin', 'padmin', 'user')
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_role) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- 7. INSERT Navigation page row at /preferences/navigation.
--    The Next.js route exists at app/(user)/preferences/navigation/page.tsx
--    but had no row in pages, so it was invisible to the nav system.
--    Tag onto avatar_menu (sits with Themes + Personal Settings).
--    The Next.js route exists at app/(user)/preferences/navigation/page.tsx
--    but had no row in pages, so it was invisible to the nav system.
--    Tag onto avatar_menu (sits with Themes + Personal Settings).
-- ───────────────────────────────────────────────────────────

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES (
    'preferences-navigation',
    'Navigation',
    '/preferences/navigation',
    'route',
    'avatar_menu',
    'static',
    TRUE,
    TRUE,
    2
)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role, users_roles_pages_role)
SELECT p.id, r.users_roles_id, r.users_roles_code::user_role
  FROM pages p
  CROSS JOIN users_roles r
 WHERE p.key_enum = 'preferences-navigation'
   AND r.users_roles_is_system = TRUE
   AND r.users_roles_code IN ('gadmin', 'padmin', 'user')
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_role) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- 8. Set page default_order per the locked spec.
--    Per-bucket positions start from 1 within each bucket.
-- ───────────────────────────────────────────────────────────

-- Personal
UPDATE pages SET default_order = 1 WHERE key_enum = 'dashboard';
UPDATE pages SET default_order = 2 WHERE key_enum = 'my-vista';
UPDATE pages SET default_order = 3 WHERE key_enum = 'favourites';

-- Planning  [Scope, Planning, Backlog, Portfolio, Portfolio Items, Work Items, Sprints, Releases]
UPDATE pages SET default_order = 1 WHERE key_enum = 'scope';
UPDATE pages SET default_order = 2 WHERE key_enum = 'planning';
UPDATE pages SET default_order = 3 WHERE key_enum = 'backlog';
UPDATE pages SET default_order = 4 WHERE key_enum = 'portfolio';
UPDATE pages SET default_order = 5 WHERE key_enum = 'portfolio-items';
UPDATE pages SET default_order = 6 WHERE key_enum = 'work-items';
UPDATE pages SET default_order = 7 WHERE key_enum = 'sprints';
UPDATE pages SET default_order = 8 WHERE key_enum = 'releases';
-- 'topology' page that's tagged 'planning' is the planning-side topology
-- view; keep it pinned but ordered after the spec items.
UPDATE pages SET default_order = 9 WHERE key_enum = 'topology' AND tag_enum = 'planning';

-- Strategy
UPDATE pages SET default_order = 1 WHERE key_enum = 'risk';

-- User Management  [User Management, Permissions, Roles]
UPDATE pages SET default_order = 1 WHERE key_enum = 'user-management';
UPDATE pages SET default_order = 2 WHERE key_enum = 'um-permissions';
UPDATE pages SET default_order = 3 WHERE key_enum = 'admin-roles';

-- Vector Admin  [Tenant Details, Library Releases, Topology, Topology Map, API Manager]
UPDATE pages SET default_order = 1 WHERE key_enum = 'va-tenant-details';
UPDATE pages SET default_order = 2 WHERE key_enum = 'library-releases';
UPDATE pages SET default_order = 3 WHERE key_enum = 'va-topology';
UPDATE pages SET default_order = 4 WHERE key_enum = 'va-topology-map';
UPDATE pages SET default_order = 5 WHERE key_enum = 'va-api-manager';

-- Workspace Admin  [Workspaces, Artefact Types, Transition Rules, Flow States,
--                   Flow States v2, Custom Fields, Portfolio Model, Organisation]
UPDATE pages SET default_order = 1 WHERE key_enum = 'ws-workspaces';
UPDATE pages SET default_order = 2 WHERE key_enum = 'ws-artefact-types';
UPDATE pages SET default_order = 3 WHERE key_enum = 'ws-transition-rules';
UPDATE pages SET default_order = 4 WHERE key_enum = 'ws-flow-states';
UPDATE pages SET default_order = 5 WHERE key_enum = 'ws-flow-states-v2';
UPDATE pages SET default_order = 6 WHERE key_enum = 'ws-custom-fields';
UPDATE pages SET default_order = 7 WHERE key_enum = 'ws-portfolio-model';
UPDATE pages SET default_order = 8 WHERE key_enum = 'ws-organisation';

-- Portfolio Settings stays in workspace_admin for now (will be sorted /
-- archived later); slot it after the spec items.
UPDATE pages SET default_order = 9  WHERE key_enum = 'portfolio-settings' AND tag_enum = 'workspace_admin';

-- Avatar Menu  [Personal Settings, Navigation, Themes]
UPDATE pages SET default_order = 1 WHERE key_enum = 'account-settings';
UPDATE pages SET default_order = 2 WHERE key_enum = 'preferences-navigation';
UPDATE pages SET default_order = 3 WHERE key_enum = 'theme';

-- Notifications  [Notifications Manager]
UPDATE pages SET default_order = 1 WHERE key_enum = 'notifications-manager';

-- ───────────────────────────────────────────────────────────
-- 9. Wipe lazy-seeded profile state so the seed re-runs fresh
--    against the new schema on next nav request.
--    CASCADE handles users_nav_prefs + users_nav_profile_groups.
--    users.active_nav_profile_id gets nulled by ON DELETE SET NULL.
-- ───────────────────────────────────────────────────────────

DELETE FROM users_nav_profiles;

-- ───────────────────────────────────────────────────────────
-- 10. Sanity checks.
-- ───────────────────────────────────────────────────────────

DO $$
DECLARE
    n_buckets int;
    n_pages int;
BEGIN
    SELECT COUNT(*) INTO n_buckets FROM pages_tags;
    -- Expected: personal, bookmarks, planning, strategy, user_management,
    -- vector_admin, workspace_admin, dev_tools, notifications, avatar_menu = 10
    IF n_buckets <> 10 THEN
        RAISE EXCEPTION 'expected 10 buckets, found %', n_buckets;
    END IF;

    SELECT COUNT(*) INTO n_pages FROM pages WHERE tag_enum = 'admin_settings' OR tag_enum = 'strategic' OR tag_enum = 'user_admin' OR tag_enum = 'personal_settings';
    IF n_pages > 0 THEN
        RAISE EXCEPTION 'stale tag_enum references remain: %', n_pages;
    END IF;
END $$;

COMMIT;
