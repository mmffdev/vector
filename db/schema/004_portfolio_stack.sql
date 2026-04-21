-- ============================================================
-- MMFFDev - Vector: Portfolio stack (Workspace / Portfolio / Product)
-- Migration 004 — applied on top of 003_mfa_scaffold.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 004_portfolio_stack.sql
--
-- Establishes the tenant-scoped hierarchy above work items:
--     Tenant → Company Roadmap → Workspace → Portfolio → Product
--
-- Tenant isolation: every table carries tenant_id and is uniquely
-- indexed by (tenant_id, ...). Soft-archive only — no hard deletes
-- (GDPR audit trail requirement, SoW §7).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. tenant_sequence
-- Per-(tenant, scope) monotonic counter. Row-lock strategy:
--     SELECT next_num FROM tenant_sequence
--         WHERE tenant_id=? AND scope=? FOR UPDATE;
--     UPDATE tenant_sequence SET next_num = next_num + 1 WHERE ...;
-- Gap-permitted by design (archived/deleted numbers never reused).
--
-- `scope` is the dimension over which a counter runs:
--   - 'roadmap', 'workspace', 'portfolio', 'product' for stack layers
--   - the UUID of a portfolio_item_types / execution_item_types row
--     for item-type counters (TA-*, US-*, …) — added in 005+.
-- ============================================================
CREATE TABLE tenant_sequence (
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    scope       TEXT        NOT NULL,
    next_num    BIGINT      NOT NULL DEFAULT 1 CHECK (next_num > 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, scope)
);

CREATE TRIGGER trg_tenant_sequence_updated_at
    BEFORE UPDATE ON tenant_sequence
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. company_roadmap
-- One row per tenant. Pseudo-container above workspaces representing
-- the company's entire offering. Always auto-created; never deletable.
-- ============================================================
CREATE TABLE company_roadmap (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
    key_num         BIGINT      NOT NULL CHECK (key_num > 0),
    name            TEXT        NOT NULL,
    owner_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT company_roadmap_key_unique UNIQUE (tenant_id, key_num)
);

CREATE TRIGGER trg_company_roadmap_updated_at
    BEFORE UPDATE ON company_roadmap
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. workspace
-- gadmin creates these. Every tenant gets SPACE-00000001 seeded by
-- the 001_default_workspace.sql seed / provisioning trigger.
-- ============================================================
CREATE TABLE workspace (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    company_roadmap_id  UUID        NOT NULL REFERENCES company_roadmap(id) ON DELETE RESTRICT,
    key_num             BIGINT      NOT NULL CHECK (key_num > 0),
    name                TEXT        NOT NULL,
    owner_user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT workspace_key_unique UNIQUE (tenant_id, key_num)
);

CREATE INDEX idx_workspace_tenant_id          ON workspace(tenant_id);
CREATE INDEX idx_workspace_company_roadmap_id ON workspace(company_roadmap_id);
CREATE INDEX idx_workspace_active             ON workspace(tenant_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_workspace_updated_at
    BEFORE UPDATE ON workspace
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 4. portfolio
-- Portfolio Runway layer. padmin creates under a workspace.
-- type_id FK resolves into portfolio_item_types (added in 005),
-- so that column stays nullable for migration 004 and becomes
-- NOT NULL in 005 once the target table exists.
-- ============================================================
CREATE TABLE portfolio (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    workspace_id    UUID        NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT,
    type_id         UUID,
    key_num         BIGINT      NOT NULL CHECK (key_num > 0),
    name            TEXT        NOT NULL,
    owner_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT portfolio_key_unique UNIQUE (tenant_id, key_num)
);

CREATE INDEX idx_portfolio_tenant_id    ON portfolio(tenant_id);
CREATE INDEX idx_portfolio_workspace_id ON portfolio(workspace_id);
CREATE INDEX idx_portfolio_active       ON portfolio(tenant_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_portfolio_updated_at
    BEFORE UPDATE ON portfolio
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 5. product
-- PROD-00000001 is auto-seeded under SPACE-00000001 per tenant.
-- A product is child of a portfolio (when the customer models
-- portfolios) or directly under the workspace (parent_portfolio_id
-- NULL = direct-under-workspace). type_id resolves to
-- portfolio_item_types (see note on portfolio.type_id).
-- ============================================================
CREATE TABLE product (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    workspace_id         UUID        NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT,
    parent_portfolio_id  UUID        REFERENCES portfolio(id) ON DELETE RESTRICT,
    type_id              UUID,
    key_num              BIGINT      NOT NULL CHECK (key_num > 0),
    name                 TEXT        NOT NULL,
    owner_user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT product_key_unique UNIQUE (tenant_id, key_num)
);

CREATE INDEX idx_product_tenant_id           ON product(tenant_id);
CREATE INDEX idx_product_workspace_id        ON product(workspace_id);
CREATE INDEX idx_product_parent_portfolio_id ON product(parent_portfolio_id);
CREATE INDEX idx_product_active              ON product(tenant_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_product_updated_at
    BEFORE UPDATE ON product
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 6. entity_stakeholders
-- Polymorphic stakeholder list. One row per (entity, user, role).
-- Separate from entity.owner_user_id so ownership can never be
-- accidentally overwritten by a bulk stakeholder update.
--
-- entity_kind values: 'company_roadmap','workspace','portfolio',
-- 'product' (item-kind values will be added in 005+).
-- FK to the target row is enforced in application code (the shape
-- is polymorphic, so no single FK works) but a CHECK restricts the
-- vocabulary of entity_kind.
-- ============================================================
CREATE TABLE entity_stakeholders (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    entity_kind  TEXT        NOT NULL CHECK (
                    entity_kind IN ('company_roadmap','workspace','portfolio','product')
                 ),
    entity_id    UUID        NOT NULL,
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role         TEXT        NOT NULL DEFAULT 'stakeholder',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT stakeholder_unique UNIQUE (entity_kind, entity_id, user_id, role)
);

CREATE INDEX idx_stakeholders_tenant_id ON entity_stakeholders(tenant_id);
CREATE INDEX idx_stakeholders_entity    ON entity_stakeholders(entity_kind, entity_id);
CREATE INDEX idx_stakeholders_user      ON entity_stakeholders(user_id);

COMMIT;
