-- DOWN for db/schema/134_rename_page_roles_to_roles_pages.sql
-- Reverses everything in inverse order.

BEGIN;

ALTER INDEX idx_roles_pages_role_id
    RENAME TO idx_page_roles_role_id;
ALTER INDEX idx_roles_pages_role
    RENAME TO idx_page_roles_role;
ALTER INDEX roles_pages_pkey
    RENAME TO page_roles_pkey;

ALTER TABLE roles_pages RENAME TO page_roles;

COMMIT;
