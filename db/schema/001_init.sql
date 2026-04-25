-- ============================================================
-- MMFFDev - Vector: User Management & Auth Schema
-- ============================================================
-- Run via SSH tunnel:
-- psql -h localhost -p 5434 -U mmff_dev -d mmff_vector -f db/schema/001_init.sql
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM: user_role
-- ============================================================
CREATE TYPE user_role AS ENUM ('user', 'padmin', 'gadmin');

-- ============================================================
-- TABLE: tenants
-- Future-proof SaaS: every user belongs to exactly one tenant.
-- ============================================================
CREATE TABLE tenants (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    email           TEXT        NOT NULL,
    password_hash   TEXT        NOT NULL,          -- bcrypt cost 12
    role            user_role   NOT NULL DEFAULT 'user',
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_tenant_unique UNIQUE (email, tenant_id)
);

CREATE INDEX idx_users_email      ON users(email);
CREATE INDEX idx_users_tenant_id  ON users(tenant_id);

-- ============================================================
-- TABLE: sessions
-- One row per live refresh token. Access tokens are stateless JWTs;
-- only the refresh token is tracked server-side for revocation.
-- token_hash = SHA-256(refresh_token_raw) — never store raw tokens.
-- ============================================================
CREATE TABLE sessions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT        NOT NULL UNIQUE,   -- SHA-256 of raw refresh token
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address      INET,
    user_agent      TEXT,
    revoked         BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================
-- TABLE: audit_log
-- Append-only. Never update or delete rows.
-- ============================================================
CREATE TABLE audit_log (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
    tenant_id   UUID        REFERENCES tenants(id) ON DELETE SET NULL,
    action      TEXT        NOT NULL,   -- e.g. 'auth.login', 'auth.logout', 'auth.token_refresh', 'auth.login_failed'
    resource    TEXT,                   -- e.g. 'session', 'user'
    resource_id TEXT,                   -- UUID of affected row, if any
    metadata    JSONB,                  -- arbitrary extra context (browser, OS, etc.)
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user_id   ON audit_log(user_id);
CREATE INDEX idx_audit_log_tenant_id ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_action    ON audit_log(action);
CREATE INDEX idx_audit_log_created   ON audit_log(created_at);

-- ============================================================
-- TRIGGER: auto-update updated_at on users and tenants
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SEED: default tenant + dev accounts (gadmin, padmin, user)
-- Password 'myApples100@' hashed with bcrypt cost 12
-- Hash: $2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/liO
-- NOTE: hash above was generated for 'changeme'; replace with correct
--       bcrypt(myApples100@, 12) hash before deploying to any environment.
-- ============================================================
INSERT INTO tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'MMFFDev', 'mmffdev');

INSERT INTO users (tenant_id, email, password_hash, role, is_active)
VALUES
    (
        '00000000-0000-0000-0000-000000000001',
        'gadmin@mmffdev.com',
        '$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/liO',
        'gadmin',
        TRUE
    ),
    (
        '00000000-0000-0000-0000-000000000001',
        'padmin@mmffdev.com',
        '$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/liO',
        'padmin',
        TRUE
    ),
    (
        '00000000-0000-0000-0000-000000000001',
        'user@mmffdev.com',
        '$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/liO',
        'user',
        TRUE
    );
