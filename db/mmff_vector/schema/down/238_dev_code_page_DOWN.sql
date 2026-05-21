-- DOWN for migration 238: Remove dev-code page.

BEGIN;

DELETE FROM users_roles_pages
WHERE users_roles_pages_id_page IN (SELECT id FROM pages WHERE key_enum = 'dev-code');

DELETE FROM pages WHERE key_enum = 'dev-code';

COMMIT;
