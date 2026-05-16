-- ============================================================
-- 189_users_roles_rbac_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (6 of N).
--
-- Applies the §2.3 column-prefix convention to the RBAC triangle:
-- users_roles + users_permissions + users_roles_permissions.
--
-- §2.4 FK shapes used here:
--   users_roles:
--     • subscription_id → users_roles_id_subscription
--     • created_by      → users_roles_id_user_created_by
--                         (FK to users.id, role suffix)
--   users_roles_permissions (composite PK):
--     • role_id         → users_roles_permissions_id_role
--     • permission_id   → users_roles_permissions_id_permission
--     • granted_by      → users_roles_permissions_id_user_granted_by
--                         (FK to users.id, role suffix)
--
-- Indexes + check constraints + FK constraints + the generic
-- set_updated_at trigger on users_roles all normalised. After this
-- migration `roles` package: 17 → 0 findings → OFF the ledger.
--
-- The FK `users_roles_pages.page_roles_role_id_fkey` referencing
-- users_roles(id) keeps the legacy constraint name; that's hygiene
-- for the `nav` pay-down (PostgreSQL FK constraints reference by
-- internal OID, not column name, so the rename here is transparent
-- to the constraint).
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- users_roles (12 columns)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users_roles RENAME COLUMN id              TO users_roles_id;
ALTER TABLE users_roles RENAME COLUMN subscription_id TO users_roles_id_subscription;
ALTER TABLE users_roles RENAME COLUMN code            TO users_roles_code;
ALTER TABLE users_roles RENAME COLUMN label           TO users_roles_label;
ALTER TABLE users_roles RENAME COLUMN description     TO users_roles_description;
ALTER TABLE users_roles RENAME COLUMN rank            TO users_roles_rank;
ALTER TABLE users_roles RENAME COLUMN is_system       TO users_roles_is_system;
ALTER TABLE users_roles RENAME COLUMN is_external     TO users_roles_is_external;
ALTER TABLE users_roles RENAME COLUMN archived_at     TO users_roles_archived_at;
ALTER TABLE users_roles RENAME COLUMN created_at      TO users_roles_created_at;
ALTER TABLE users_roles RENAME COLUMN updated_at      TO users_roles_updated_at;
ALTER TABLE users_roles RENAME COLUMN created_by      TO users_roles_id_user_created_by;

ALTER INDEX roles_pkey            RENAME TO users_roles_pkey;
ALTER INDEX idx_roles_rank        RENAME TO idx_users_roles_rank;
ALTER INDEX idx_roles_subscription RENAME TO idx_users_roles_id_subscription;
ALTER INDEX uq_roles_system_code  RENAME TO uq_users_roles_system_code;
ALTER INDEX uq_roles_tenant_code  RENAME TO uq_users_roles_tenant_code;

ALTER TABLE users_roles
    RENAME CONSTRAINT roles_rank_positive       TO users_roles_rank_positive;
ALTER TABLE users_roles
    RENAME CONSTRAINT roles_system_no_tenant    TO users_roles_system_no_tenant;
ALTER TABLE users_roles
    RENAME CONSTRAINT roles_tenant_rank_band    TO users_roles_tenant_rank_band;
ALTER TABLE users_roles
    RENAME CONSTRAINT roles_created_by_fkey      TO users_roles_id_user_created_by_fkey;
ALTER TABLE users_roles
    RENAME CONSTRAINT roles_subscription_id_fkey TO users_roles_id_subscription_fkey;

-- ─────────────────────────────────────────────────────────────
-- users_permissions (6 columns — no out-FKs)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users_permissions RENAME COLUMN id          TO users_permissions_id;
ALTER TABLE users_permissions RENAME COLUMN code        TO users_permissions_code;
ALTER TABLE users_permissions RENAME COLUMN label       TO users_permissions_label;
ALTER TABLE users_permissions RENAME COLUMN category    TO users_permissions_category;
ALTER TABLE users_permissions RENAME COLUMN description TO users_permissions_description;
ALTER TABLE users_permissions RENAME COLUMN created_at  TO users_permissions_created_at;

ALTER INDEX permissions_pkey         RENAME TO users_permissions_pkey;
ALTER INDEX permissions_code_key     RENAME TO users_permissions_code_key;
ALTER INDEX idx_permissions_category RENAME TO idx_users_permissions_category;

-- ─────────────────────────────────────────────────────────────
-- users_roles_permissions (4 columns — composite PK)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users_roles_permissions RENAME COLUMN role_id       TO users_roles_permissions_id_role;
ALTER TABLE users_roles_permissions RENAME COLUMN permission_id TO users_roles_permissions_id_permission;
ALTER TABLE users_roles_permissions RENAME COLUMN granted_by    TO users_roles_permissions_id_user_granted_by;
ALTER TABLE users_roles_permissions RENAME COLUMN granted_at    TO users_roles_permissions_granted_at;

ALTER INDEX roles_permissions_pkey       RENAME TO users_roles_permissions_pkey;
ALTER INDEX idx_roles_permissions_perm   RENAME TO idx_users_roles_permissions_id_permission;

ALTER TABLE users_roles_permissions
    RENAME CONSTRAINT role_permissions_granted_by_fkey
                   TO users_roles_permissions_id_user_granted_by_fkey;
ALTER TABLE users_roles_permissions
    RENAME CONSTRAINT role_permissions_permission_id_fkey
                   TO users_roles_permissions_id_permission_fkey;
ALTER TABLE users_roles_permissions
    RENAME CONSTRAINT role_permissions_role_id_fkey
                   TO users_roles_permissions_id_role_fkey;

-- ─────────────────────────────────────────────────────────────
-- Trigger rewrite — users_roles uses set_updated_at() which now
-- can't find NEW.updated_at. Dedicated trigger function.
-- ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_users_roles_updated_at ON users_roles;
DROP TRIGGER IF EXISTS trg_roles_updated_at ON users_roles;
DROP TRIGGER IF EXISTS users_roles_updated_at ON users_roles;
DROP TRIGGER IF EXISTS roles_updated_at ON users_roles;

CREATE OR REPLACE FUNCTION fn_users_roles_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.users_roles_updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_roles_touch_updated_at
BEFORE UPDATE ON users_roles
FOR EACH ROW
EXECUTE FUNCTION fn_users_roles_touch_updated_at();

COMMIT;
