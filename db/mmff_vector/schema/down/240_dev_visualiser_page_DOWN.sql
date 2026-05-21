-- DOWN for migration 240: Remove dev-visualiser page.

BEGIN;

DELETE FROM users_roles_pages
WHERE users_roles_pages_id_page IN (SELECT id FROM pages WHERE key_enum = 'dev-visualiser');

DELETE FROM pages WHERE key_enum = 'dev-visualiser';

COMMIT;
