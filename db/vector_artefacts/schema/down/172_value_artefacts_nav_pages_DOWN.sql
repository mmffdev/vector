-- Migration 172 DOWN: remove Artefacts pages from the Value nav rail.

BEGIN;

DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
       SELECT pages_id
         FROM pages
        WHERE pages_key_enum IN ('value-artefacts', 'value-dependencies')
 );

DELETE FROM users_nav_prefs
 WHERE users_nav_prefs_item_key IN ('value-artefacts', 'value-dependencies');

DELETE FROM pages
 WHERE pages_key_enum IN ('value-artefacts', 'value-dependencies')
   AND pages_id_user_creator IS NULL
   AND pages_id_subscription IS NULL;

COMMIT;
