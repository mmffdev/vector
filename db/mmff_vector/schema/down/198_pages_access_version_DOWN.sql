-- ============================================================
-- DOWN for 198_pages_access_version.sql
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS users_roles_pages_bump_access_version ON users_roles_pages;
DROP TRIGGER IF EXISTS users_roles_bump_access_version       ON users_roles;
DROP FUNCTION IF EXISTS pages_access_version_bump();
DROP TABLE    IF EXISTS pages_access_version;

COMMIT;
