-- Migration 233: Consolidate the avatar menu into a single first-class
-- section sourced from tag_enum = 'avatar_menu'.
--
-- Two product changes drive this:
--   1. /preferences/navigation moves to /navigation. The page is reachable
--      from the avatar flyout (no other /preferences/* siblings exist),
--      so the parent folder was dead weight. The page key_enum stays as
--      'preferences-navigation' to avoid churning users_roles_pages grants
--      (migration 199_seed_role_page_grants_locked.sql binds by key_enum).
--
--   2. Notifications Manager moves from its own tag bucket onto avatar_menu.
--      The bell icon in rail-1 stays as its own popover trigger; the
--      Notifications page is for routing/preferences and belongs with the
--      other personal-config pages (Account Settings, Themes, Navigation).
--      The 'notifications' tag is dropped after the migration since it
--      held no other pages.
--
-- ShellContext.tsx already treats tag_enum='avatar_menu' specially (the
-- avatar flyout pulls pages where catalogue.tagEnum === 'avatar_menu').
-- This migration keeps pages_tags_is_admin_menu = TRUE for avatar_menu so
-- the tag stays OUT of the standard rail-1 section list — the avatar
-- flyout renders it as a "synthetic" section keyed off ACCOUNT_SECTION_ID.
--
-- Idempotent: every statement is gated by a WHERE filter or NOT EXISTS so
-- re-running is safe.

BEGIN;

-- 1. Update the Navigation page's href to /navigation (flat).
UPDATE pages
   SET href       = '/navigation',
       updated_at = NOW()
 WHERE key_enum = 'preferences-navigation'
   AND href     = '/preferences/navigation';

-- 2. Re-tag Notifications Manager onto avatar_menu and slot it last.
--    default_order=10 puts it after Account Settings (1), Navigation (2),
--    Themes (3). The exact value can drift as the bucket grows; the
--    rail sorts by default_order ascending.
UPDATE pages
   SET tag_enum       = 'avatar_menu',
       default_order  = 10,
       updated_at     = NOW()
 WHERE key_enum = 'notifications-manager'
   AND tag_enum = 'notifications';

-- 3. Profile-group placements for the dropped 'notifications' tag need
--    to flip to 'avatar_menu' so users who'd reordered the bucket don't
--    lose their pin. Skip rows that already have a placement for
--    avatar_menu in the same profile (the partial unique index
--    uq_user_nav_profile_groups_tag enforces (profile_id, tag_enum)).
--
--    User prefs (users_nav_prefs) reference pages by item_key (key_enum),
--    so the page-href flip from step 1 is transparent to them.
UPDATE users_nav_profile_groups
   SET users_nav_profile_groups_tag_enum = 'avatar_menu'
 WHERE users_nav_profile_groups_tag_enum = 'notifications'
   AND NOT EXISTS (
     SELECT 1 FROM users_nav_profile_groups other
      WHERE other.users_nav_profile_groups_id_profile = users_nav_profile_groups.users_nav_profile_groups_id_profile
        AND other.users_nav_profile_groups_tag_enum   = 'avatar_menu'
   );

-- 4. Delete any leftover 'notifications' profile-group rows that
--    conflicted with an existing avatar_menu placement (step 3 skipped
--    them). The bucket is gone after step 5 so these rows are orphans.
DELETE FROM users_nav_profile_groups
 WHERE users_nav_profile_groups_tag_enum = 'notifications';

-- 5. Drop the now-empty 'notifications' tag bucket. Guarded by a count
--    check so re-running after a manual page re-add bails safely.
DELETE FROM pages_tags
 WHERE pages_tags_tag_enum = 'notifications'
   AND NOT EXISTS (
     SELECT 1 FROM pages WHERE tag_enum = 'notifications'
   );

-- 6. Update pages_addressables rows that hard-code the old route. The
--    addressable substrate stores page_route as a string column (used
--    for grouping in the Page Help admin); rows are re-emitted at
--    runtime when the page hydrates, but old entries persist until
--    refreshed.
UPDATE pages_addressables
   SET pages_addressables_page_route = '/navigation'
 WHERE pages_addressables_page_route = '/preferences/navigation';

COMMIT;
