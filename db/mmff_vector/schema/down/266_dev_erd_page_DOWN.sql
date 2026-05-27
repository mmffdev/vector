-- Migration 266 DOWN — revert dev-erd page.
BEGIN;

DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
       SELECT id FROM pages WHERE key_enum = 'dev-erd'
 );

DELETE FROM pages WHERE key_enum = 'dev-erd';

COMMIT;
