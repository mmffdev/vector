-- DOWN for 239_dev_reporting_page.sql
BEGIN;

DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (SELECT id FROM pages WHERE key_enum = 'dev-reporting');

DELETE FROM pages WHERE key_enum = 'dev-reporting';

DELETE FROM schema_migrations WHERE filename = '239_dev_reporting_page.sql';

COMMIT;
