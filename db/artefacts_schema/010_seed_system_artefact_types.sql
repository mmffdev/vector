-- ============================================================
-- MMFFDev - vector_artefacts: seed function for system artefact types
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 010_seed_system_artefact_types.sql
--
-- Defines a function the app calls each time a new subscription is created
-- in mmff_vector. Cross-DB triggers do not exist, so this is invoked by
-- application code (the same handler that inserts the subscription row).
--
-- Seeds:
--   - 4 system work types: Story (US), Defect (DE), Task (TA), Epic (EP)
--   - 1 default flow per type with the canonical 4 states:
--       To Do  ->  In Progress  ->  Done   (+ Cancelled side-state)
--   - allowed transitions: any-to-any except self
--
-- Strategy types are NOT seeded here. They arrive via portfolio-model
-- adoption (see strategy_layers_adopted).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION seed_system_artefact_types(p_subscription_id UUID)
RETURNS VOID AS $$
DECLARE
    v_type_id      UUID;
    v_flow_id      UUID;
    v_todo_id      UUID;
    v_progress_id  UUID;
    v_done_id      UUID;
    v_cancelled_id UUID;
    v_seed RECORD;
BEGIN
    FOR v_seed IN
        SELECT * FROM (VALUES
            ('Story',  'US', 10),
            ('Defect', 'DE', 20),
            ('Task',   'TA', 30),
            ('Epic',   'EP', 40)
        ) AS t(name, prefix, sort_order)
    LOOP
        -- Skip if this subscription already has this system prefix (idempotent re-seed).
        IF EXISTS (
            SELECT 1 FROM artefact_types
            WHERE subscription_id = p_subscription_id
              AND scope  = 'work'
              AND source = 'system'
              AND prefix = v_seed.prefix
              AND archived_at IS NULL
        ) THEN
            CONTINUE;
        END IF;

        -- 1. Create the type.
        INSERT INTO artefact_types (
            subscription_id, scope, source, name, prefix, sort_order
        )
        VALUES (
            p_subscription_id, 'work', 'system', v_seed.name, v_seed.prefix, v_seed.sort_order
        )
        RETURNING id INTO v_type_id;

        -- 2. Create the default flow for this type.
        INSERT INTO flows (artefact_type_id, name, description, is_default)
        VALUES (v_type_id, 'Default', 'System default flow', TRUE)
        RETURNING id INTO v_flow_id;

        -- 3. Create the 4 canonical states.
        INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial)
        VALUES (v_flow_id, 'To Do', 'todo', 10, TRUE)
        RETURNING id INTO v_todo_id;

        INSERT INTO flow_states (flow_id, name, kind, sort_order)
        VALUES (v_flow_id, 'In Progress', 'in_progress', 20)
        RETURNING id INTO v_progress_id;

        INSERT INTO flow_states (flow_id, name, kind, sort_order)
        VALUES (v_flow_id, 'Done', 'done', 30)
        RETURNING id INTO v_done_id;

        INSERT INTO flow_states (flow_id, name, kind, sort_order)
        VALUES (v_flow_id, 'Cancelled', 'cancelled', 40)
        RETURNING id INTO v_cancelled_id;

        -- 4. Allowed transitions: forward path + cancel-from-anywhere + reopen.
        INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
            (v_flow_id, v_todo_id,     v_progress_id),
            (v_flow_id, v_progress_id, v_done_id),
            (v_flow_id, v_progress_id, v_todo_id),
            (v_flow_id, v_done_id,     v_progress_id),
            (v_flow_id, v_todo_id,     v_cancelled_id),
            (v_flow_id, v_progress_id, v_cancelled_id),
            (v_flow_id, v_cancelled_id, v_todo_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION seed_system_artefact_types(UUID) IS
    'Idempotently seeds the 4 system work types (Story/Defect/Task/Epic) '
    'with default flow + canonical 4 states + transitions for one '
    'subscription. Called by the app when a new subscription is provisioned. '
    'Strategy types arrive separately via portfolio-model adoption.';

COMMIT;
