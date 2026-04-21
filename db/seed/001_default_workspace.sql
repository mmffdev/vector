-- ============================================================
-- MMFFDev - Vector: Default workspace provisioning
-- Seed 001 — applied on top of 007_rename_permissions.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 001_default_workspace.sql
--
-- This seed is idempotent. It:
--   1. Installs provision_tenant_defaults(tenant_uuid, owner_user_uuid)
--      — a single PLPGSQL function that creates the full default
--      hierarchy for a tenant:
--        ROAD-00000001 (company_roadmap)
--        SPACE-00000001 (workspace)
--        PROD-00000001 (product)
--        + portfolio_item_types rows (Portfolio Runway, Product,
--          Business Objective, Theme, Feature)
--        + execution_item_types rows (Epic Story, User Story,
--          Defect, Task)
--        + item_type_states rows for each type (one per canonical
--          state, SoW §3 defaults)
--        + item_type_transition_edges rows for each type (SoW
--          §3 default linear flow: defined → ready → in_progress
--          → completed [→ accepted, where applicable])
--        + tenant_sequence seed rows for every layer.
--   2. Installs an AFTER INSERT trigger on `users` that calls
--      provision_tenant_defaults the first time a gadmin is
--      created in a tenant that has no ROAD- row yet. This solves
--      the chicken-and-egg problem (owner_user_id is NOT NULL on
--      the default rows, but a brand-new tenant has no users).
--   3. Backfills the MMFFDev default tenant
--      (00000000-0000-0000-0000-000000000001) using the existing
--      admin@mmffdev.com gadmin user as owner, so the current
--      development DB ends up in the same shape a freshly
--      provisioned tenant would.
--
-- Execution-item names are the locked SoW defaults. The tags can
-- be edited per tenant afterwards (e.g. rename US → STORY).
-- Portfolio-item names AND tags can be edited freely.
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
    v_type_id        UUID;
    v_state_defined       UUID;
    v_state_ready         UUID;
    v_state_in_progress   UUID;
    v_state_completed     UUID;
    v_state_accepted      UUID;
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
    -- Product (PROD-00000001) under SPACE-00000001, no portfolio.
    -- type_id stays NULL — will be populated once we decide which
    -- portfolio_item_type represents "Product" (the row below).
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
    -- Stamp the gadmin as the initial 'owner' on each provisioned
    -- entity so there is a permanent historical record that gadmin
    -- owned this at provisioning time, even after ownership is
    -- handed off to a padmin or product lead during onboarding.
    -- (entity.owner_user_id is the live pointer; this table is the
    -- audit trail — SoW §7.)
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
    -- portfolio_item_types (editable name + tag).
    -- SoW defaults + 2-char tags.
    -- ----------------------------------------------------------
    INSERT INTO portfolio_item_types (tenant_id, name, tag, sort_order) VALUES
        (p_tenant_id, 'Portfolio Runway',   'RO', 10),
        (p_tenant_id, 'Product',            'PR', 20),
        (p_tenant_id, 'Business Objective', 'BO', 30),
        (p_tenant_id, 'Theme',              'TH', 40),
        (p_tenant_id, 'Feature',            'FE', 50)
    ON CONFLICT (tenant_id, tag) DO NOTHING;

    -- ----------------------------------------------------------
    -- execution_item_types (locked name, editable tag).
    -- SoW defaults.
    -- ----------------------------------------------------------
    INSERT INTO execution_item_types (tenant_id, name, tag, sort_order) VALUES
        (p_tenant_id, 'Epic Story', 'ES', 10),
        (p_tenant_id, 'User Story', 'US', 20),
        (p_tenant_id, 'Defect',     'DE', 30),
        (p_tenant_id, 'Task',       'TA', 40)
    ON CONFLICT (tenant_id, tag) DO NOTHING;

    -- ----------------------------------------------------------
    -- Default state sets + transition edges for every type.
    -- Portfolio layers and execution stories/defects/features get
    -- the full 5-state flow. Tasks skip `accepted`.
    --
    -- This block is re-run-safe: ON CONFLICT on the UNIQUE
    -- (tenant_id, item_type_id, item_type_kind, name) index.
    -- ----------------------------------------------------------
    FOR v_type_id IN
        SELECT id FROM portfolio_item_types WHERE tenant_id = p_tenant_id AND archived_at IS NULL
    LOOP
        PERFORM seed_default_states_for_type(p_tenant_id, v_type_id, 'portfolio', TRUE);
    END LOOP;

    FOR v_type_id IN
        SELECT id FROM execution_item_types
            WHERE tenant_id = p_tenant_id
              AND archived_at IS NULL
              AND name <> 'Task'
    LOOP
        PERFORM seed_default_states_for_type(p_tenant_id, v_type_id, 'execution', TRUE);
    END LOOP;

    -- Task: no `accepted` state (SoW §3).
    FOR v_type_id IN
        SELECT id FROM execution_item_types
            WHERE tenant_id = p_tenant_id
              AND archived_at IS NULL
              AND name = 'Task'
    LOOP
        PERFORM seed_default_states_for_type(p_tenant_id, v_type_id, 'execution', FALSE);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. seed_default_states_for_type
-- Helper: seeds defined/ready/in_progress/completed (+ optional
-- accepted) for a single item type plus the linear transition
-- edges between them. Idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION seed_default_states_for_type(
    p_tenant_id       UUID,
    p_item_type_id    UUID,
    p_item_type_kind  TEXT,
    p_include_accepted BOOLEAN
) RETURNS VOID AS $$
DECLARE
    v_defined      UUID;
    v_ready        UUID;
    v_in_progress  UUID;
    v_completed    UUID;
    v_accepted     UUID;
BEGIN
    INSERT INTO item_type_states (tenant_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
        VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, 'Defined',     'defined',     10)
        ON CONFLICT (tenant_id, item_type_id, item_type_kind, name) DO NOTHING;
    INSERT INTO item_type_states (tenant_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
        VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, 'Ready',       'ready',       20)
        ON CONFLICT (tenant_id, item_type_id, item_type_kind, name) DO NOTHING;
    INSERT INTO item_type_states (tenant_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
        VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, 'In Progress', 'in_progress', 30)
        ON CONFLICT (tenant_id, item_type_id, item_type_kind, name) DO NOTHING;
    INSERT INTO item_type_states (tenant_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
        VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, 'Completed',   'completed',   40)
        ON CONFLICT (tenant_id, item_type_id, item_type_kind, name) DO NOTHING;

    SELECT id INTO v_defined
        FROM item_type_states
        WHERE tenant_id = p_tenant_id AND item_type_id = p_item_type_id
          AND item_type_kind = p_item_type_kind AND name = 'Defined';
    SELECT id INTO v_ready
        FROM item_type_states
        WHERE tenant_id = p_tenant_id AND item_type_id = p_item_type_id
          AND item_type_kind = p_item_type_kind AND name = 'Ready';
    SELECT id INTO v_in_progress
        FROM item_type_states
        WHERE tenant_id = p_tenant_id AND item_type_id = p_item_type_id
          AND item_type_kind = p_item_type_kind AND name = 'In Progress';
    SELECT id INTO v_completed
        FROM item_type_states
        WHERE tenant_id = p_tenant_id AND item_type_id = p_item_type_id
          AND item_type_kind = p_item_type_kind AND name = 'Completed';

    IF p_include_accepted THEN
        INSERT INTO item_type_states (tenant_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
            VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, 'Accepted', 'accepted', 50)
            ON CONFLICT (tenant_id, item_type_id, item_type_kind, name) DO NOTHING;

        SELECT id INTO v_accepted
            FROM item_type_states
            WHERE tenant_id = p_tenant_id AND item_type_id = p_item_type_id
              AND item_type_kind = p_item_type_kind AND name = 'Accepted';
    END IF;

    -- Linear transitions. Each ON CONFLICT on the uniqueness
    -- index makes the block safely re-runnable.
    INSERT INTO item_type_transition_edges (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id)
        VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, v_defined,     v_ready)
        ON CONFLICT (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id) DO NOTHING;
    INSERT INTO item_type_transition_edges (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id)
        VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, v_ready,       v_in_progress)
        ON CONFLICT (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id) DO NOTHING;
    INSERT INTO item_type_transition_edges (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id)
        VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, v_in_progress, v_completed)
        ON CONFLICT (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id) DO NOTHING;

    IF p_include_accepted THEN
        INSERT INTO item_type_transition_edges (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id)
            VALUES (p_tenant_id, p_item_type_id, p_item_type_kind, v_completed, v_accepted)
            ON CONFLICT (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id) DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. AFTER INSERT trigger on users
-- First gadmin in a tenant with no roadmap → provision defaults
-- using that user as owner. Solves the tenant-has-no-users-yet
-- chicken-and-egg at tenant-creation time.
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
-- 4. Backfill the default MMFFDev tenant.
-- Uses the existing admin@mmffdev.com gadmin as owner.
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
