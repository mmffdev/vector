-- ============================================================
-- MMFFDev - Vector: Auth extensions + permission grid
-- Migration 002 — applied on top of 001_init.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 002_auth_permissions.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Extend users table
-- ============================================================
ALTER TABLE users
    ADD COLUMN auth_method           TEXT        NOT NULL DEFAULT 'local'
        CHECK (auth_method IN ('local','ldap')),
    ADD COLUMN ldap_dn               TEXT,
    ADD COLUMN force_password_change BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN password_changed_at   TIMESTAMPTZ,
    ADD COLUMN failed_login_count    INT         NOT NULL DEFAULT 0,
    ADD COLUMN locked_until          TIMESTAMPTZ;

UPDATE users
    SET force_password_change = TRUE
    WHERE email = 'admin@mmffdev.com';

-- ============================================================
-- 2. password_resets — single-use, time-boxed tokens
-- ============================================================
CREATE TABLE password_resets (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT        NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    requested_ip INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_resets_user_id    ON password_resets(user_id);
CREATE INDEX idx_password_resets_expires_at ON password_resets(expires_at);

-- ============================================================
-- 3. user_project_permissions — granular ACL
-- One row per (user, project). Supports lookups in both directions.
-- project_id FK will be added when the projects table lands.
-- ============================================================
CREATE TABLE user_project_permissions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  UUID        NOT NULL,
    can_view    BOOLEAN     NOT NULL DEFAULT FALSE,
    can_edit    BOOLEAN     NOT NULL DEFAULT FALSE,
    can_admin   BOOLEAN     NOT NULL DEFAULT FALSE,
    granted_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, project_id)
);

CREATE INDEX idx_upp_user_id    ON user_project_permissions(user_id);
CREATE INDEX idx_upp_project_id ON user_project_permissions(project_id);

CREATE TRIGGER trg_upp_updated_at
    BEFORE UPDATE ON user_project_permissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
