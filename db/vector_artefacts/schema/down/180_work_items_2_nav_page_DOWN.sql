-- Migration 180 DOWN: remove /work-items-2 from the Planning nav rail.

BEGIN;

DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
       SELECT pages_id
         FROM pages
        WHERE pages_key_enum = 'work-items-2'
 );

-- Clean any user pinned/bookmark rows keyed to this page (string item_key).
-- New page → normally none exist, but kept for a clean, idempotent rollback.
DELETE FROM users_nav_pinned
 WHERE users_nav_pinned_item_key = 'work-items-2';

DELETE FROM users_nav_bookmarks
 WHERE users_nav_bookmarks_item_key = 'work-items-2';

DELETE FROM pages
 WHERE pages_key_enum = 'work-items-2'
   AND pages_id_user_creator IS NULL
   AND pages_id_subscription IS NULL;

COMMIT;
