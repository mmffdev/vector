-- ============================================================
-- MMFFDev - Vector: Default workspace provisioning
-- Seed 001 — applied on top of migration schema
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 001_default_workspace.sql
--
-- This seed is idempotent. It:
--   1. Installs provision_tenant_defaults(tenant_uuid, owner_user_uuid)
--      — a single PLPGSQL function that creates the full default
--      hierarchy for a tenant:
--        ROAD-00000001 (company_roadmap)
--        SPACE-00000001 (workspace)
--        PROD-00000001 (product)
--        + execution_item_types rows (Epic Story, User Story,
--          Defect, Task)
--        + tenant_sequence seed rows for every layer.
--   2. Installs an AFTER INSERT trigger on `users` that calls
--      provision_tenant_defaults the first time a gadmin is
--      created in a tenant that has no ROAD- row yet.
--   3. Backfills the MMFFDev default tenant
--      (00000000-0000-0000-0000-000000000001).
--
-- Note: portfolio_item_types, item_type_states, item_type_transition_edges
-- were removed in migration 032. Portfolio layer types are now sourced
-- from the library adoption saga (subscription_layers mirror table).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. provision_tenant_defaults
-- Idempotent. Safe to call multiple times on the same tenant —
-- every INSERT is guarded by NOT EXISTS / ON CONFLICT.
-- ============================================================
CREATE OR REPLACE FUNCTION provision_tenant_defaults(
    p_tenant_id       UUID,
    p_owner_user_id   UUID
) RETURNS VOID AS $$
DECLARE
    v_roadmap_id     UUID;
    v_workspace_id   UUID;
    v_product_id     UUID;
BEGIN
    -- ----------------------------------------------------------
    -- Company roadmap (ROAD-00000001) — one per tenant.
    -- ----------------------------------------------------------
    SELECT id INTO v_roadmap_id
        FROM company_roadmap
        WHERE tenant_id = p_tenant_id;

    IF v_roadmap_id IS NULL THEN
        INSERT INTO tenant_sequence (tenant_id, scope, next_num)
            VALUES (p_tenant_id, 'roadmap', 2)
            ON CONFLICT (tenant_id, scope) DO UPDATE
                SET next_num = GREATEST(tenant_sequence.next_num, 2);

        INSERT INTO company_roadmap (tenant_id, key_num, name, owner_user_id)
            VALUES (p_tenant_id, 1, 'Company Roadmap', p_owner_user_id)
            RETURNING id INTO v_roadmap_id;
    END IF;

    -- ----------------------------------------------------------
    -- Workspace (SPACE-00000001).
    -- ----------------------------------------------------------
    SELECT id INTO v_workspace_id
        FROM workspace
        WHERE tenant_id = p_tenant_id AND key_num = 1;

    IF v_workspace_id IS NULL THEN
        INSERT INTO tenant_sequence (tenant_id, scope, next_num)
            VALUES (p_tenant_id, 'workspace', 2)
            ON CONFLICT (tenant_id, scope) DO UPDATE
                SET next_num = GREATEST(tenant_sequence.next_num, 2);

        INSERT INTO workspace (tenant_id, company_roadmap_id, key_num, name, owner_user_id)
            VALUES (p_tenant_id, v_roadmap_id, 1, 'My Workspace', p_owner_user_id)
            RETURNING id INTO v_workspace_id;
    END IF;

    -- ----------------------------------------------------------
    -- Product (PROD-00000001) under SPACE-00000001.
    -- ----------------------------------------------------------
    SELECT id INTO v_product_id
        FROM product
        WHERE tenant_id = p_tenant_id AND key_num = 1;

    IF v_product_id IS NULL THEN
        INSERT INTO tenant_sequence (tenant_id, scope, next_num)
            VALUES (p_tenant_id, 'product', 2)
            ON CONFLICT (tenant_id, scope) DO UPDATE
                SET next_num = GREATEST(tenant_sequence.next_num, 2);

        INSERT INTO product (tenant_id, workspace_id, parent_portfolio_id, key_num, name, owner_user_id)
            VALUES (p_tenant_id, v_workspace_id, NULL, 1, 'Product', p_owner_user_id)
            RETURNING id INTO v_product_id;
    END IF;

    -- Seed the portfolio-sequence counter so when a portfolio is
    -- created later, it starts at PO-00000001.
    INSERT INTO tenant_sequence (tenant_id, scope, next_num)
        VALUES (p_tenant_id, 'portfolio', 1)
        ON CONFLICT (tenant_id, scope) DO NOTHING;

    -- ----------------------------------------------------------
    -- Stakeholder audit rows.
    -- ----------------------------------------------------------
    INSERT INTO entity_stakeholders (tenant_id, entity_kind, entity_id, user_id, role)
        VALUES (p_tenant_id, 'company_roadmap', v_roadmap_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (tenant_id, entity_kind, entity_id, user_id, role)
        VALUES (p_tenant_id, 'workspace',       v_workspace_id, p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (tenant_id, entity_kind, entity_id, user_id, role)
        VALUES (p_tenant_id, 'product',         v_product_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;

    -- ----------------------------------------------------------
    -- execution_item_types (locked name, editable tag).
    -- ----------------------------------------------------------
    INSERT INTO execution_item_types (tenant_id, name, tag, sort_order) VALUES
        (p_tenant_id, 'Epic Story', 'ES', 10),
        (p_tenant_id, 'User Story', 'US', 20),
        (p_tenant_id, 'Defect',     'DE', 30),
        (p_tenant_id, 'Task',       'TA', 40)
    ON CONFLICT (tenant_id, tag) DO NOTHING;

END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. AFTER INSERT trigger on users
-- First gadmin in a tenant with no roadmap → provision defaults
-- using that user as owner.
-- ============================================================
CREATE OR REPLACE FUNCTION provision_on_first_gadmin()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role = 'gadmin' AND NEW.is_active = TRUE THEN
        IF NOT EXISTS (
            SELECT 1 FROM company_roadmap WHERE tenant_id = NEW.tenant_id
        ) THEN
            PERFORM provision_tenant_defaults(NEW.tenant_id, NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_provision_on_first_gadmin ON users;

CREATE TRIGGER trg_provision_on_first_gadmin
    AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION provision_on_first_gadmin();

-- ============================================================
-- 3. Backfill the default MMFFDev tenant.
-- ============================================================
DO $$
DECLARE
    v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
    v_owner_id  UUID;
BEGIN
    SELECT id INTO v_owner_id
        FROM users
        WHERE tenant_id = v_tenant_id
          AND role = 'gadmin'
          AND is_active = TRUE
        ORDER BY created_at ASC
        LIMIT 1;

    IF v_owner_id IS NULL THEN
        RAISE NOTICE 'No active gadmin found for tenant %. Skipping backfill — trigger will provision on first gadmin.', v_tenant_id;
    ELSE
        PERFORM provision_tenant_defaults(v_tenant_id, v_owner_id);
        RAISE NOTICE 'Provisioned defaults for tenant % with owner %', v_tenant_id, v_owner_id;
    END IF;
END $$;

COMMIT;
