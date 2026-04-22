-- ============================================================
-- MMFFDev - Vector: Page registry + tag groups
-- Migration 009 — applied on top of 008_user_nav_prefs.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 009_page_registry.sql
--
-- Replaces the hand-mirrored catalogue (backend/internal/nav/catalog.go +
-- app/lib/navCatalog.ts) with a DB-backed registry. Introduces tag groups
-- so the sidebar can cluster pinned items with always-on section headings.
--
-- New tables:
--   page_tags   — enum-keyed groups with display names
--   pages       — master registry (system, tenant-scoped, and future user-custom)
--   page_roles  — role gate per page (many-to-one)
--
-- Seeds all current static catalogue rows + three new admin pages
-- (workspace-settings, portfolio-settings, account-settings) and rewrites
-- existing user_nav_prefs rows that pointed at the retired "admin" key.
-- ============================================================

BEGIN;

-- ============================================================
-- TABLE: page_tags
-- Group enum → display name lookup. is_admin_menu flags groups
-- that auto-populate the header avatar dropdown.
-- ============================================================
CREATE TABLE page_tags (
    tag_enum        TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    default_order   INT  NOT NULL,
    is_admin_menu   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: pages
-- Master registry. Covers system pages (created_by + tenant_id both NULL),
-- tenant-scoped pages (tenant_id set), and future user-custom pages
-- (created_by set). Validation for user_nav_prefs.item_key runs against
-- the key_enum column on this table.
-- ============================================================
CREATE TABLE pages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_enum        TEXT NOT NULL,
    label           TEXT NOT NULL,
    href            TEXT NOT NULL,
    icon            TEXT NOT NULL,
    tag_enum        TEXT NOT NULL REFERENCES page_tags(tag_enum),
    kind            TEXT NOT NULL,                                   -- 'static' | 'entity' | 'user_custom'
    pinnable        BOOLEAN NOT NULL DEFAULT TRUE,
    default_pinned  BOOLEAN NOT NULL DEFAULT FALSE,
    default_order   INT NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES users(id) ON DELETE CASCADE,    -- NULL = system page
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = global
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Scoped uniqueness: a key_enum must be unique within (tenant, creator).
    -- System pages (both NULL) land in a single global namespace.
    CONSTRAINT pages_unique_key_per_scope UNIQUE (key_enum, tenant_id, created_by),
    CONSTRAINT pages_kind_valid CHECK (kind IN ('static', 'entity', 'user_custom'))
);

CREATE INDEX idx_pages_tag     ON pages(tag_enum);
CREATE INDEX idx_pages_tenant  ON pages(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_pages_creator ON pages(created_by) WHERE created_by IS NOT NULL;

CREATE TRIGGER trg_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: page_roles
-- Role gate, many-to-one. Uses the existing user_role enum so
-- catalogue role checks match user.role at the DB layer.
-- ============================================================
CREATE TABLE page_roles (
    page_id     UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    role        user_role NOT NULL,
    PRIMARY KEY (page_id, role)
);

CREATE INDEX idx_page_roles_role ON page_roles(role);

-- ============================================================
-- Seed: page_tags
-- ============================================================
INSERT INTO page_tags (tag_enum, display_name, default_order, is_admin_menu) VALUES
    ('personal',          'Personal',          0, FALSE),
    ('planning',          'Planning',          1, FALSE),
    ('strategic',         'Strategic',         2, FALSE),
    ('admin_settings',    'Admin Settings',    3, TRUE),
    ('personal_settings', 'Personal Settings', 4, TRUE);

-- ============================================================
-- Seed: pages (system-scoped — created_by = NULL, tenant_id = NULL)
-- Mirrors the current backend/internal/nav/catalog.go entries,
-- plus the three new admin-area pages.
-- ============================================================
INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order) VALUES
    ('dashboard',          'Dashboard',          '/dashboard',          'home',      'personal',          'static', TRUE,  TRUE,  0),
    ('my-vista',           'My Vista',           '/my-vista',           'eye',       'personal',          'static', TRUE,  TRUE,  1),
    ('backlog',            'Backlog',            '/backlog',            'clipboard', 'planning',          'static', TRUE,  TRUE,  0),
    ('planning',           'Planning',           '/planning',           'list',      'planning',          'static', TRUE,  TRUE,  1),
    ('portfolio',          'Portfolio',          '/portfolio',          'briefcase', 'planning',          'static', TRUE,  TRUE,  2),
    ('favourites',         'Favourites',         '/favourites',         'star',      'personal',          'static', TRUE,  TRUE,  2),
    ('risk',               'Risk',               '/risk',               'warning',   'strategic',         'static', TRUE,  TRUE,  0),
    ('workspace-settings', 'Workspace Settings', '/workspace-settings', 'cog',       'admin_settings',    'static', TRUE,  TRUE,  0),
    ('portfolio-settings', 'Portfolio Settings', '/portfolio-settings', 'briefcase', 'admin_settings',    'static', TRUE,  TRUE,  1),
    ('account-settings',   'Account Settings',   '/account-settings',   'user',      'personal_settings', 'static', TRUE,  TRUE,  0),
    ('dev',                'Dev Setup',          '/dev',                'wrench',    'personal',          'static', FALSE, FALSE, 99);

-- ============================================================
-- Seed: page_roles
-- Mirrors allRoles / adminRoles from catalog.go + new per-page gates.
-- ============================================================
-- all roles
INSERT INTO page_roles (page_id, role)
SELECT id, r::user_role
FROM pages, UNNEST(ARRAY['user', 'padmin', 'gadmin']) AS r
WHERE key_enum IN ('dashboard', 'my-vista', 'backlog', 'planning', 'portfolio',
                   'favourites', 'risk', 'account-settings', 'dev');

-- padmin + gadmin
INSERT INTO page_roles (page_id, role)
SELECT id, r::user_role
FROM pages, UNNEST(ARRAY['padmin', 'gadmin']) AS r
WHERE key_enum = 'portfolio-settings';

-- gadmin only
INSERT INTO page_roles (page_id, role)
SELECT id, 'gadmin'::user_role
FROM pages
WHERE key_enum = 'workspace-settings';

-- ============================================================
-- Rewrite existing user_nav_prefs rows pointing at the retired
-- "admin" item_key. Gadmins and padmins both redirect to
-- workspace-settings (padmin still has user-list visibility;
-- edit rights are gated by the role-ceiling rule in the service).
-- ============================================================
UPDATE user_nav_prefs
SET item_key = 'workspace-settings'
WHERE item_key = 'admin';

COMMIT;
