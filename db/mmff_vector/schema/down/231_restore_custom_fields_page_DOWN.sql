-- DOWN for migration 231: re-drop the restored ws-custom-fields page.
-- Mirrors migration 227's body verbatim.

BEGIN;

DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
   SELECT id FROM pages
    WHERE key_enum = 'ws-custom-fields'
      AND created_by IS NULL
      AND subscription_id IS NULL
 );

DELETE FROM pages
 WHERE key_enum = 'ws-custom-fields'
   AND created_by IS NULL
   AND subscription_id IS NULL;

COMMIT;
