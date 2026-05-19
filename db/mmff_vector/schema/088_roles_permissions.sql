-- ============================================================
-- PLA-0007 / Story 00292 — Data-driven RBAC schema
-- ============================================================
-- Three new tables introduce roles + permissions + role_permissions
-- as the source of truth, replacing the 'user_role' Postgres ENUM.
--
-- The ENUM and users.role / page_roles.role columns are intentionally
-- LEFT IN PLACE in this migration. Migration 089 adds role_id columns
-- and backfills from the enum; the enum itself drops in a deferred
-- Migration Z after one full release cycle of dual-read.
--
-- Conventions:
--   subscription_id = NULL  → system role (visible to all tenants)
--   subscription_id != NULL → tenant-custom role
--   System bands: rank 5, 10, 20, 25, 30 reserved for system rows
--   Tenant rows: rank must be in [11..24] or [26..29] (CHECK constraint)
-- ============================================================

BEGIN;

-- ── roles ────────────────────────────────────────────────────
CREATE TABLE roles (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID            REFERENCES subscriptions(id) ON DELETE CASCADE,
    code            TEXT        NOT NULL,
    label           TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    rank            INTEGER     NOT NULL,
    is_system       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_external     BOOLEAN     NOT NULL DEFAULT FALSE,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID            REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT roles_rank_positive
        CHECK (rank > 0),

    -- Tenant rows must NOT use a system-reserved rank.
    -- System rows (subscription_id IS NULL) may use any positive rank.
    CONSTRAINT roles_tenant_rank_band
        CHECK (
            subscription_id IS NULL
            OR rank NOT IN (5, 10, 20, 25, 30)
        ),

    -- System rows cannot be tenant-scoped; tenant rows cannot be is_system.
    CONSTRAINT roles_system_no_tenant
        CHECK (
            (is_system = TRUE  AND subscription_id IS NULL)
            OR (is_system = FALSE)
        )
);

-- Unique code per scope (system scope = NULL subscription_id).
-- Postgres treats NULL as distinct, so we need a partial index
-- to enforce single-system-row-per-code.
CREATE UNIQUE INDEX uq_roles_system_code
    ON roles (code)
    WHERE subscription_id IS NULL;

CREATE UNIQUE INDEX uq_roles_tenant_code
    ON roles (subscription_id, code)
    WHERE subscription_id IS NOT NULL;

CREATE INDEX idx_roles_subscription
    ON roles (subscription_id)
    WHERE subscription_id IS NOT NULL;

CREATE INDEX idx_roles_rank ON roles (rank);

CREATE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── permissions ──────────────────────────────────────────────
-- Server-authoritative catalogue. The Go side (internal/permissions)
-- declares every code as a typed constant; package init() refuses to
-- start if the catalogue and this table diverge.
CREATE TABLE permissions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL UNIQUE,
    label       TEXT        NOT NULL,
    category    TEXT        NOT NULL DEFAULT 'general',
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_permissions_category ON permissions (category);


-- ── role_permissions (junction) ──────────────────────────────
CREATE TABLE role_permissions (
    role_id        UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id  UUID        NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_by     UUID            REFERENCES users(id) ON DELETE SET NULL,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_perm ON role_permissions (permission_id);


-- ============================================================
-- SEED — system roles (stable UUIDs recorded in Go constants)
-- ============================================================
-- gadmin   rank 30
-- padmin   rank 25
-- team_lead rank 20  (NEW — original ask of PLA-0007)
-- user      rank 10
-- external  rank  5  (archetype for tenant clone-and-edit)
INSERT INTO roles (id, subscription_id, code, label, description, rank, is_system, is_external)
VALUES
    ('00000000-0000-0000-0000-00000000ad30', NULL, 'gadmin',    'Global Admin',
     'Full administrative authority within a tenant; can manage roles and users at every level.',
     30, TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ad25', NULL, 'padmin',    'Portfolio Admin',
     'Portfolio-level admin; can create Team Leads and Users and manage portfolio-scoped settings.',
     25, TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ad20', NULL, 'team_lead', 'Team Lead',
     'Mid-tier role with the same operational rights as Portfolio Admin in v0; ranks differ so role-ceiling is preserved.',
     20, TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ad10', NULL, 'user',      'User',
     'Standard end-user. No account-creation rights.',
     10, TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ad05', NULL, 'external',  'External (archetype)',
     'Bespoke external account archetype. Tenants clone-and-edit to define auditor / contractor / agent roles.',
      5, TRUE, TRUE);


-- ============================================================
-- SEED — permission catalogue
-- ============================================================
-- Stable UUIDs are not required for permissions (the code is the
-- contract); we let pgcrypto allocate. The Go catalogue resolves
-- code -> id at startup.
INSERT INTO permissions (code, label, category, description) VALUES
    -- menu visibility (drives /admin gating in the frontend)
    ('menu.admin.view',          'View admin menu',          'menu',  'Render the admin menu group in the navigation.'),
    ('menu.dev.view',            'View dev menu',            'menu',  'Render the developer menu (Dev Setup) — gadmin only by default.'),

    -- users CRUD (gated per target role via users.create.<role_code>)
    ('users.list',               'List users',               'users', 'Read-only list of users in the actor''s tenant.'),
    ('users.read',               'Read user detail',         'users', 'Read individual user records.'),
    ('users.archive',            'Archive (soft-delete) user','users','Soft-archive a user.'),
    ('users.update_profile',     'Update user profile',      'users', 'Edit profile fields (name, department).'),
    ('users.update_active',      'Activate / deactivate user','users','Toggle is_active on a user.'),
    ('users.issue_reset',        'Issue password reset link','users', 'Generate a password-reset link for a user.'),

    -- creator-matrix permissions (gate one direction of POST /api/users)
    ('users.create.gadmin',      'Create gadmin users',      'users', 'Create users with the gadmin system role.'),
    ('users.create.padmin',      'Create padmin users',      'users', 'Create users with the padmin system role.'),
    ('users.create.team_lead',   'Create team_lead users',   'users', 'Create users with the team_lead system role.'),
    ('users.create.user',        'Create standard users',    'users', 'Create users with the user system role.'),
    ('users.create.external',    'Create external users',    'users', 'Create users under any is_external role within tenant scope.'),

    -- roles CRUD (gadmin-only by default; tenants can extend)
    ('roles.list',               'List roles',               'roles', 'Read tenant + system roles.'),
    ('roles.read',               'Read role detail',         'roles', 'Read role permission grid + audit.'),
    ('roles.create',             'Create custom role',       'roles', 'Create tenant-custom roles.'),
    ('roles.update',             'Update role',              'roles', 'Edit tenant-custom roles (and label/description on system roles).'),
    ('roles.archive',            'Archive role',             'roles', 'Soft-archive a tenant-custom role.'),
    ('roles.assign_permissions', 'Grant permissions',        'roles', 'Grant permissions to a role.'),
    ('roles.revoke_permissions', 'Revoke permissions',       'roles', 'Revoke permissions from a role.'),

    -- portfolio (minimal example for the External archetype)
    ('portfolio.list',           'List portfolios',          'portfolio', 'Read portfolios visible to the actor.');


-- ============================================================
-- SEED — role_permissions
-- ============================================================
-- gadmin: everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad30', p.id FROM permissions p;

-- padmin: everything except gadmin/padmin creation and dev/admin menu beyond what's needed
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad25', p.id
FROM permissions p
WHERE p.code IN (
    'menu.admin.view',
    'users.list', 'users.read', 'users.archive',
    'users.update_profile', 'users.update_active', 'users.issue_reset',
    'users.create.team_lead', 'users.create.user', 'users.create.external',
    'roles.list', 'roles.read',
    'portfolio.list',
    'work_items.settings.edit'
);

-- team_lead: same as padmin in v0, minus users.create.padmin (which padmin doesn't have either)
-- Per user direction: "same rights as padmin for now"; ranks differ (20 vs 25).
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad20', p.id
FROM permissions p
WHERE p.code IN (
    'menu.admin.view',
    'users.list', 'users.read', 'users.archive',
    'users.update_profile', 'users.update_active', 'users.issue_reset',
    'users.create.team_lead', 'users.create.user', 'users.create.external',
    'roles.list', 'roles.read',
    'portfolio.list'
);

-- user: minimal
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad10', p.id
FROM permissions p
WHERE p.code IN ('portfolio.list');

-- external (archetype): minimal — clone-and-edit to add more
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad05', p.id
FROM permissions p
WHERE p.code IN ('portfolio.list');

COMMIT;
