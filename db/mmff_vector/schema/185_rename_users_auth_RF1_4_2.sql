-- RF1.4.2.users (Wave B — auth core).
-- High-blast-radius rename: roles, permissions, sessions, password_resets,
-- roles_workspaces, roles_pages, roles_permissions all gain the `users_*`
-- root prefix per §2.6.
-- Column-prefix on these tables is deferred — auth queries depend on
-- bare column names (role_id, user_id, etc.) across many packages and
-- a full re-prefix would touch hundreds of sites. Filed as TD.
BEGIN;

ALTER TABLE roles              RENAME TO users_roles;
ALTER TABLE permissions        RENAME TO users_permissions;
ALTER TABLE sessions           RENAME TO users_sessions;
ALTER TABLE password_resets    RENAME TO users_password_resets;
ALTER TABLE roles_workspaces   RENAME TO users_roles_workspaces;
ALTER TABLE roles_pages        RENAME TO users_roles_pages;
ALTER TABLE roles_permissions  RENAME TO users_roles_permissions;

COMMIT;
