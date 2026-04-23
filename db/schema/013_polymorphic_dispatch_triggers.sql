-- ============================================================
-- MMFFDev - Vector: Polymorphic FK dispatch triggers (TD-001 Phase 1)
-- Migration 013 — applied on top of 012_pages_partial_unique.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 013_polymorphic_dispatch_triggers.sql
--
-- Postgres can enforce the kind vocabulary via CHECK but cannot
-- enforce referential integrity for polymorphic (kind, id) pairs.
-- The dispatch function below resolves a (kind, id) to a parent
-- table, asserts the parent exists, and asserts the parent
-- tenant matches the polymorphic row's tenant context. Triggers
-- on the three live polymorphic tables call it on every
-- INSERT/UPDATE.
--
-- Coverage:
--   entity_stakeholders  — tenant on row; assert parent.tenant_id = NEW.tenant_id
--   item_type_states     — tenant on row; assert parent.tenant_id = NEW.tenant_id
--   page_entity_refs     — no tenant on row; assert parent.tenant_id = pages.tenant_id
--
-- Skipped: item_state_history. Its parent kinds (portfolio_item,
-- execution_item) don't have tables yet. Re-visit when they ship.
--
-- See docs/c_polymorphic_writes.md for the writer rules these
-- triggers enforce as defence in depth alongside the Go service.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Dispatch function
-- ------------------------------------------------------------
-- Returns (tenant_id, archived_at) for a (kind, id) pair.
-- Raises foreign_key_violation if no row exists for that (kind, id).
-- Caller asserts archived_at and tenant_id equality.
-- ============================================================
CREATE OR REPLACE FUNCTION dispatch_polymorphic_parent(
    p_kind TEXT,
    p_id   UUID,
    OUT parent_tenant_id UUID,
    OUT parent_archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    CASE p_kind
        WHEN 'company_roadmap' THEN
            SELECT tenant_id, archived_at INTO parent_tenant_id, parent_archived_at
              FROM company_roadmap WHERE id = p_id;
        WHEN 'workspace' THEN
            SELECT tenant_id, archived_at INTO parent_tenant_id, parent_archived_at
              FROM workspace WHERE id = p_id;
        WHEN 'portfolio' THEN
            SELECT tenant_id, archived_at INTO parent_tenant_id, parent_archived_at
              FROM portfolio WHERE id = p_id;
        WHEN 'product' THEN
            SELECT tenant_id, archived_at INTO parent_tenant_id, parent_archived_at
              FROM product WHERE id = p_id;
        ELSE
            -- Note: item_type_states uses kind enum {portfolio, execution}
            -- meaning portfolio_item_types / execution_item_types. That
            -- vocabulary is dispatched by dispatch_item_type_parent below,
            -- not this function. Don't confuse the two.
            RAISE EXCEPTION 'unknown polymorphic parent kind: %', p_kind
                USING ERRCODE = 'foreign_key_violation';
    END CASE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'polymorphic parent not found: kind=%, id=%', p_kind, p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
END;
$$;

COMMENT ON FUNCTION dispatch_polymorphic_parent(TEXT, UUID) IS
    'Resolves an entity_stakeholders / page_entity_refs polymorphic parent reference '
    'to (tenant_id, archived_at). Raises foreign_key_violation if missing. '
    'See docs/c_polymorphic_writes.md.';

-- ============================================================
-- 2. Dispatch function for item_type_states
-- ------------------------------------------------------------
-- item_type_states.kind enum is {portfolio, execution} but the
-- targets are portfolio_item_types / execution_item_types — a
-- different vocabulary from the entity_stakeholders one. Separate
-- function keeps each unambiguous.
-- ============================================================
CREATE OR REPLACE FUNCTION dispatch_item_type_parent(
    p_kind TEXT,
    p_id   UUID,
    OUT parent_tenant_id UUID,
    OUT parent_archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    CASE p_kind
        WHEN 'portfolio' THEN
            SELECT tenant_id, archived_at INTO parent_tenant_id, parent_archived_at
              FROM portfolio_item_types WHERE id = p_id;
        WHEN 'execution' THEN
            SELECT tenant_id, archived_at INTO parent_tenant_id, parent_archived_at
              FROM execution_item_types WHERE id = p_id;
        ELSE
            RAISE EXCEPTION 'unknown item_type parent kind: %', p_kind
                USING ERRCODE = 'foreign_key_violation';
    END CASE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'polymorphic item_type parent not found: kind=%, id=%', p_kind, p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
END;
$$;

COMMENT ON FUNCTION dispatch_item_type_parent(TEXT, UUID) IS
    'Resolves an item_type_states polymorphic parent reference to '
    '(tenant_id, archived_at). Raises foreign_key_violation if missing. '
    'See docs/c_polymorphic_writes.md.';

-- ============================================================
-- 3. Trigger fn: entity_stakeholders
-- ============================================================
CREATE OR REPLACE FUNCTION trg_entity_stakeholders_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_tenant UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT parent_tenant_id, parent_archived_at
      INTO parent_tenant, parent_archived
      FROM dispatch_polymorphic_parent(NEW.entity_kind, NEW.entity_id);

    IF parent_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'cross-tenant polymorphic write rejected: entity_stakeholders.tenant_id=% does not match parent (% / %).tenant_id=%',
            NEW.tenant_id, NEW.entity_kind, NEW.entity_id, parent_tenant
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: entity_stakeholders → (% / %) archived_at=%',
            NEW.entity_kind, NEW.entity_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_stakeholders_dispatch ON entity_stakeholders;
CREATE TRIGGER trg_entity_stakeholders_dispatch
    BEFORE INSERT OR UPDATE OF entity_kind, entity_id, tenant_id
    ON entity_stakeholders
    FOR EACH ROW
    EXECUTE FUNCTION trg_entity_stakeholders_dispatch();

-- ============================================================
-- 4. Trigger fn: page_entity_refs
-- ------------------------------------------------------------
-- No tenant_id on this table; the implied tenant is pages.tenant_id
-- for the row's page_id. Look it up and require equality with the
-- parent entity's tenant_id.
-- ============================================================
CREATE OR REPLACE FUNCTION trg_page_entity_refs_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    page_tenant UUID;
    parent_tenant UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT tenant_id INTO page_tenant FROM pages WHERE id = NEW.page_id;
    -- pages may legitimately be system-scoped (tenant_id IS NULL) but
    -- bookmark pages always carry a tenant. If page_tenant is NULL we
    -- still require the parent to exist — but cannot assert tenant
    -- equality. Treat NULL as a write that should not target a
    -- tenant-scoped parent: reject defensively.
    IF page_tenant IS NULL THEN
        RAISE EXCEPTION 'page_entity_refs write rejected: page_id=% has no tenant — bookmark pages must be tenant-scoped',
            NEW.page_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT parent_tenant_id, parent_archived_at
      INTO parent_tenant, parent_archived
      FROM dispatch_polymorphic_parent(NEW.entity_kind, NEW.entity_id);

    IF parent_tenant IS DISTINCT FROM page_tenant THEN
        RAISE EXCEPTION 'cross-tenant polymorphic write rejected: page_entity_refs page.tenant_id=% does not match parent (% / %).tenant_id=%',
            page_tenant, NEW.entity_kind, NEW.entity_id, parent_tenant
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: page_entity_refs → (% / %) archived_at=%',
            NEW.entity_kind, NEW.entity_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_page_entity_refs_dispatch ON page_entity_refs;
CREATE TRIGGER trg_page_entity_refs_dispatch
    BEFORE INSERT OR UPDATE OF entity_kind, entity_id, page_id
    ON page_entity_refs
    FOR EACH ROW
    EXECUTE FUNCTION trg_page_entity_refs_dispatch();

-- ============================================================
-- 5. Trigger fn: item_type_states
-- ============================================================
CREATE OR REPLACE FUNCTION trg_item_type_states_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_tenant UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT parent_tenant_id, parent_archived_at
      INTO parent_tenant, parent_archived
      FROM dispatch_item_type_parent(NEW.item_type_kind, NEW.item_type_id);

    IF parent_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'cross-tenant polymorphic write rejected: item_type_states.tenant_id=% does not match parent (% / %).tenant_id=%',
            NEW.tenant_id, NEW.item_type_kind, NEW.item_type_id, parent_tenant
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: item_type_states → (% / %) archived_at=%',
            NEW.item_type_kind, NEW.item_type_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_item_type_states_dispatch ON item_type_states;
CREATE TRIGGER trg_item_type_states_dispatch
    BEFORE INSERT OR UPDATE OF item_type_kind, item_type_id, tenant_id
    ON item_type_states
    FOR EACH ROW
    EXECUTE FUNCTION trg_item_type_states_dispatch();

-- ============================================================
-- item_state_history: deferred. Its parent kinds (portfolio_item,
-- execution_item) have no parent tables yet. When they ship, add
-- a fourth trigger here mirroring the pattern above.
-- ============================================================

COMMIT;
