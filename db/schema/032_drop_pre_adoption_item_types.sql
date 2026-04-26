-- Migration 032: drop pre-adoption item-type cluster
--
-- portfolio_item_types, item_type_states, item_type_transition_edges,
-- and item_state_history were the pre-library approach to modelling
-- portfolio layer types and their state machines. They were replaced by
-- the subscription_layers / subscription_workflows /
-- subscription_workflow_transitions mirror tables written by the
-- adoption saga (migrations 029+).
--
-- No production Go code reads any of these tables (verified 2026-04-26).
-- The portfolio and product tables remain; their type_id column (a
-- loose reference into portfolio_item_types with no FK constraint) is
-- dropped here since it has no reader and no writer after adoption.
--
-- Drop order: child tables first (FK constraints respected).

-- 1. item_state_history → references item_type_states
DROP TABLE IF EXISTS item_state_history;

-- 2. item_type_transition_edges → references item_type_states
DROP TABLE IF EXISTS item_type_transition_edges;

-- 3. item_type_states → references canonical_states (outbound only)
DROP TABLE IF EXISTS item_type_states;

-- 4. portfolio_item_types — no inbound FKs
DROP TABLE IF EXISTS portfolio_item_types;

-- 5. Dead type_id columns on portfolio and product (no FK, no reader)
ALTER TABLE portfolio DROP COLUMN IF EXISTS type_id;
ALTER TABLE product   DROP COLUMN IF EXISTS type_id;

-- 6. Helper function only used by the deleted seed block
DROP FUNCTION IF EXISTS seed_default_states_for_type(UUID, UUID, TEXT, BOOLEAN);

-- 7. Rebuild provision_subscription_defaults without the dropped tables.
--    The old body seeded portfolio_item_types, item_type_states, and
--    item_type_transition_edges (all now gone). The trigger
--    trg_provision_on_first_gadmin stays; only the function body changes.
CREATE OR REPLACE FUNCTION provision_subscription_defaults(
    p_subscription_id  UUID,
    p_owner_user_id    UUID
) RETURNS VOID AS $$
DECLARE
    v_roadmap_id     UUID;
    v_workspace_id   UUID;
    v_product_id     UUID;
BEGIN
    -- Company roadmap (ROAD-00000001) — one per subscription.
    SELECT id INTO v_roadmap_id
        FROM company_roadmap
        WHERE subscription_id = p_subscription_id;

    IF v_roadmap_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'roadmap', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO company_roadmap (subscription_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, 1, 'Company Roadmap', p_owner_user_id)
            RETURNING id INTO v_roadmap_id;
    END IF;

    -- Workspace (SPACE-00000001).
    SELECT id INTO v_workspace_id
        FROM workspace
        WHERE subscription_id = p_subscription_id AND key_num = 1;

    IF v_workspace_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'workspace', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO workspace (subscription_id, company_roadmap_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, v_roadmap_id, 1, 'My Workspace', p_owner_user_id)
            RETURNING id INTO v_workspace_id;
    END IF;

    -- Product (PROD-00000001) under SPACE-00000001.
    SELECT id INTO v_product_id
        FROM product
        WHERE subscription_id = p_subscription_id AND key_num = 1;

    IF v_product_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'product', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO product (subscription_id, workspace_id, parent_portfolio_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, v_workspace_id, NULL, 1, 'Product', p_owner_user_id)
            RETURNING id INTO v_product_id;
    END IF;

    -- Portfolio sequence counter (starts at 1 so first portfolio is PO-00000001).
    INSERT INTO subscription_sequence (subscription_id, scope, next_num)
        VALUES (p_subscription_id, 'portfolio', 1)
        ON CONFLICT (subscription_id, scope) DO NOTHING;

    -- Stakeholder audit rows.
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'company_roadmap', v_roadmap_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'workspace',       v_workspace_id, p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'product',         v_product_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;

    -- execution_item_types (locked name, editable tag).
    INSERT INTO execution_item_types (subscription_id, name, tag, sort_order) VALUES
        (p_subscription_id, 'Epic Story', 'ES', 10),
        (p_subscription_id, 'User Story', 'US', 20),
        (p_subscription_id, 'Defect',     'DE', 30),
        (p_subscription_id, 'Task',       'TA', 40)
    ON CONFLICT (subscription_id, tag) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
