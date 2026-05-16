-- ============================================================
-- MMFFDev - Vector: Item type catalogues
-- Migration 005 — applied on top of 004_portfolio_stack.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 005_item_types.sql
--
-- Two parallel catalogues:
--   - portfolio_item_types: Portfolio Runway, Product, Business
--     Objective, Theme, Feature. Names AND tags are editable.
--   - execution_item_types: Epic Story, User Story, Defect, Task.
--     Names are LOCKED (a User Story is always a User Story).
--     Only the tag is editable (e.g. rename US -> STORY).
--
-- Work item rows reference a type by UUID only. Renaming a tag is
-- a one-row update; previously issued human keys (e.g. US-00000347)
-- continue to resolve by UUID and re-render with the new tag.
--
-- Tag length: 2-4 characters (SoW §9).
-- Scope: tenant-level for MVP. A nullable config_root_id can be
-- added later (see SoW §12 — Multi-Division Config paid tier)
-- without a breaking migration.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. portfolio_item_types
-- Editable name + tag. One row per (tenant, tag).
-- Portfolio layers can be renamed freely by gadmin/padmin.
-- ============================================================
CREATE TABLE portfolio_item_types (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name         TEXT        NOT NULL,
    tag          TEXT        NOT NULL CHECK (length(tag) BETWEEN 2 AND 4),
    sort_order   INT         NOT NULL DEFAULT 0,
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT portfolio_item_types_tag_unique  UNIQUE (tenant_id, tag),
    CONSTRAINT portfolio_item_types_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX idx_portfolio_item_types_tenant_id ON portfolio_item_types(tenant_id);
CREATE INDEX idx_portfolio_item_types_active    ON portfolio_item_types(tenant_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_portfolio_item_types_updated_at
    BEFORE UPDATE ON portfolio_item_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. execution_item_types
-- Locked name, editable tag. Same shape as portfolio_item_types
-- but name is enforced immutable by a BEFORE UPDATE trigger.
-- ============================================================
CREATE TABLE execution_item_types (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name         TEXT        NOT NULL,
    tag          TEXT        NOT NULL CHECK (length(tag) BETWEEN 2 AND 4),
    sort_order   INT         NOT NULL DEFAULT 0,
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT execution_item_types_tag_unique  UNIQUE (tenant_id, tag),
    CONSTRAINT execution_item_types_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX idx_execution_item_types_tenant_id ON execution_item_types(tenant_id);
CREATE INDEX idx_execution_item_types_active    ON execution_item_types(tenant_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_execution_item_types_updated_at
    BEFORE UPDATE ON execution_item_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. Name-lock trigger on execution_item_types
-- Prevents UPDATE from changing the `name` column. Tag stays
-- editable (that's the whole point). Insert is unaffected.
-- Raises a named exception so the API layer can surface a
-- friendly error message.
-- ============================================================
CREATE OR REPLACE FUNCTION execution_item_types_lock_name()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
        RAISE EXCEPTION 'execution_item_types.name is immutable (id=%, old=%, new=%)',
            OLD.id, OLD.name, NEW.name
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_execution_item_types_lock_name
    BEFORE UPDATE ON execution_item_types
    FOR EACH ROW EXECUTE FUNCTION execution_item_types_lock_name();

COMMIT;
