-- DOWN for migration 233: restore the 'notifications' tag bucket,
-- move Notifications Manager back, revert the /navigation href, and
-- roll pages_addressables routes back. Cannot fully recover the
-- profile-group rows deleted in UP step 4 (those were edge-case
-- conflicts) — best effort.

BEGIN;

-- 1. Restore the 'notifications' tag bucket. is_admin_menu=TRUE matches
--    the original (kept it off rail-1) and min_auth_level=2 matches the
--    classification migration 221 applied to avatar_menu surfaces.
INSERT INTO pages_tags (
  pages_tags_tag_enum,
  pages_tags_display_name,
  pages_tags_default_order,
  pages_tags_is_admin_menu
) VALUES ('notifications', 'Notifications', 90, TRUE)
ON CONFLICT (pages_tags_tag_enum) DO NOTHING;

-- 2. Re-tag Notifications Manager back onto 'notifications'.
UPDATE pages
   SET tag_enum      = 'notifications',
       default_order = 1,
       updated_at    = NOW()
 WHERE key_enum = 'notifications-manager'
   AND tag_enum = 'avatar_menu';

-- 3. Revert the Navigation page href.
UPDATE pages
   SET href       = '/preferences/navigation',
       updated_at = NOW()
 WHERE key_enum = 'preferences-navigation'
   AND href     = '/navigation';

-- 4. Roll pages_addressables page_route back.
UPDATE pages_addressables
   SET pages_addressables_page_route = '/preferences/navigation'
 WHERE pages_addressables_page_route = '/navigation';

-- 5. profile-group rows are NOT restored — UP step 3 changed the tag
--    in place and step 4 deleted conflicts. Users who lose a pin can
--    re-pin from /navigation.

COMMIT;
