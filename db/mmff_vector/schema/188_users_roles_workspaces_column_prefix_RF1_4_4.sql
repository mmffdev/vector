-- ============================================================
-- 188_users_roles_workspaces_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (5 of N).
--
-- Applies the §2.3 column-prefix convention to users_roles_workspaces
-- (a §2.6 junction table — users × workspaces with a role payload).
--
-- §2.4 FK shapes used here:
--   • subscription_id → users_roles_workspaces_id_subscription
--   • workspace_id    → users_roles_workspaces_id_workspace
--   • user_id         → users_roles_workspaces_id_user (the grantee;
--                       no role suffix needed — it's the canonical
--                       FK to users on this junction)
--   • granted_by      → users_roles_workspaces_id_user_granted_by
--                       (multi-FK to users, role suffix per §2.4)
--   • revoked_by      → users_roles_workspaces_id_user_revoked_by
--                       (multi-FK to users, role suffix per §2.4)
--
-- Indexes + constraints + the generic trigger are normalised. After
-- this migration:
--   • `workspaces` package: 14 → 0 findings → OFF the ledger.
--   • cross-readers `topology` and `portfoliomodels` SQL rewritten
--     in the same commit (they read this table — column names must
--     match).
-- ============================================================

BEGIN;

-- ---- Column renames (12 columns) ----

ALTER TABLE users_roles_workspaces RENAME COLUMN id              TO users_roles_workspaces_id;
ALTER TABLE users_roles_workspaces RENAME COLUMN subscription_id TO users_roles_workspaces_id_subscription;
ALTER TABLE users_roles_workspaces RENAME COLUMN workspace_id    TO users_roles_workspaces_id_workspace;
ALTER TABLE users_roles_workspaces RENAME COLUMN user_id         TO users_roles_workspaces_id_user;
ALTER TABLE users_roles_workspaces RENAME COLUMN role            TO users_roles_workspaces_role;
ALTER TABLE users_roles_workspaces RENAME COLUMN can_redelegate  TO users_roles_workspaces_can_redelegate;
ALTER TABLE users_roles_workspaces RENAME COLUMN granted_by      TO users_roles_workspaces_id_user_granted_by;
ALTER TABLE users_roles_workspaces RENAME COLUMN granted_at      TO users_roles_workspaces_granted_at;
ALTER TABLE users_roles_workspaces RENAME COLUMN revoked_at      TO users_roles_workspaces_revoked_at;
ALTER TABLE users_roles_workspaces RENAME COLUMN revoked_by      TO users_roles_workspaces_id_user_revoked_by;
ALTER TABLE users_roles_workspaces RENAME COLUMN created_at      TO users_roles_workspaces_created_at;
ALTER TABLE users_roles_workspaces RENAME COLUMN updated_at      TO users_roles_workspaces_updated_at;

-- ---- Index renames ----

ALTER INDEX roles_workspaces_pkey         RENAME TO users_roles_workspaces_pkey;
ALTER INDEX roles_workspaces_active_user  RENAME TO users_roles_workspaces_active_user;
ALTER INDEX roles_workspaces_user_idx     RENAME TO idx_users_roles_workspaces_id_user;

-- ---- Check constraint renames ----

ALTER TABLE users_roles_workspaces
    RENAME CONSTRAINT roles_workspaces_revoked_pair  TO users_roles_workspaces_revoked_pair;
ALTER TABLE users_roles_workspaces
    RENAME CONSTRAINT workspace_roles_role_check     TO users_roles_workspaces_role_check;

-- ---- FK constraint renames ----

ALTER TABLE users_roles_workspaces
    RENAME CONSTRAINT workspace_roles_granted_by_fkey      TO users_roles_workspaces_id_user_granted_by_fkey;
ALTER TABLE users_roles_workspaces
    RENAME CONSTRAINT workspace_roles_revoked_by_fkey      TO users_roles_workspaces_id_user_revoked_by_fkey;
ALTER TABLE users_roles_workspaces
    RENAME CONSTRAINT workspace_roles_subscription_id_fkey TO users_roles_workspaces_id_subscription_fkey;
ALTER TABLE users_roles_workspaces
    RENAME CONSTRAINT workspace_roles_user_id_fkey         TO users_roles_workspaces_id_user_fkey;
ALTER TABLE users_roles_workspaces
    RENAME CONSTRAINT workspace_roles_workspace_id_fkey    TO users_roles_workspaces_id_workspace_fkey;

-- ---- Trigger rewrite ----
-- The generic set_updated_at() trigger function references NEW.updated_at,
-- which is now NEW.users_roles_workspaces_updated_at on this table.
-- Install a dedicated trigger function.

DROP TRIGGER IF EXISTS trg_roles_workspaces_updated_at ON users_roles_workspaces;

CREATE OR REPLACE FUNCTION fn_users_roles_workspaces_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.users_roles_workspaces_updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_roles_workspaces_touch_updated_at
BEFORE UPDATE ON users_roles_workspaces
FOR EACH ROW
EXECUTE FUNCTION fn_users_roles_workspaces_touch_updated_at();

COMMIT;
