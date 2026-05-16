-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 3
-- Migration 073 — seed Risk Flow (default) — 5 states + transitions
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 073_seed_risk_default_flow.sql
--
-- The default flow for Risk: Identified → Analysing → Mitigating → Closed →
-- Accepted (kind-aligned: backlog/todo/in_progress/done/accepted).
-- Identified is the initial state (backlog-kind). Analysing is the pullable
-- state (todo-kind, the kanban pull target).
--
-- Transition graph mirrors the Defect Flow's promiscuous shape (every state
-- can return to every earlier one, plus the forward path). 16 edges.
--
-- Depends on: mig 071 (Risk artefacts_types row).
-- flow_defaults snapshot auto-fires via mig 044's existing trigger (this
-- flow has is_default=TRUE so it's picked up automatically).
--
-- Idempotent: skips entirely if a default flow for Risk already exists.
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_risk_type_id UUID;
    v_flow_id      UUID;
    v_identified   UUID;
    v_analysing    UUID;
    v_mitigating   UUID;
    v_closed       UUID;
    v_accepted     UUID;
BEGIN
    -- Resolve Risk artefact_type id (from mig 071).
    SELECT artefacts_types_id INTO v_risk_type_id
      FROM artefacts_types
     WHERE artefacts_types_prefix = 'RSK'
       AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
       AND artefacts_types_archived_at IS NULL;

    IF v_risk_type_id IS NULL THEN
        RAISE EXCEPTION 'Migration 073: Risk type not found. Apply mig 071 first.';
    END IF;

    -- Idempotency: skip if Risk Flow already exists.
    IF EXISTS (
        SELECT 1 FROM flows
         WHERE flows_id_artefact_type = v_risk_type_id
           AND flows_name = 'Risk Flow'
           AND flows_archived_at IS NULL
    ) THEN
        RAISE NOTICE 'Migration 073: Risk Flow already seeded, skipping.';
        RETURN;
    END IF;

    -- 1. Create the default flow.
    INSERT INTO flows (
        flows_id_artefact_type,
        flows_name,
        flows_description,
        flows_is_default
    )
    VALUES (
        v_risk_type_id,
        'Risk Flow',
        'Default Risk delivery workflow: Identified through Mitigating to Accepted closure.',
        TRUE
    )
    RETURNING flows_id INTO v_flow_id;

    -- 2. Create the 5 kind-aligned states.
    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Identified', 'backlog', 10, TRUE, FALSE, 'Risk has been identified and recorded; no analysis yet.')
    RETURNING flows_states_id INTO v_identified;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Analysing', 'todo', 20, FALSE, TRUE, 'Assessment of impact, probability, and required mitigation underway.')
    RETURNING flows_states_id INTO v_analysing;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Mitigating', 'in_progress', 30, FALSE, FALSE, 'Mitigation actions in flight; risk is being actively reduced.')
    RETURNING flows_states_id INTO v_mitigating;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Closed', 'done', 40, FALSE, FALSE, 'Risk no longer relevant or fully mitigated; not yet formally accepted.')
    RETURNING flows_states_id INTO v_closed;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Accepted', 'accepted', 50, FALSE, FALSE, 'Risk closure acknowledged by stakeholders; archived for audit.')
    RETURNING flows_states_id INTO v_accepted;

    -- 3. Transitions — Defect Flow's promiscuous shape:
    --    forward path + reverse edges from every state back to earlier ones.
    INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to) VALUES
        -- Forward path
        (v_flow_id, v_identified, v_analysing),
        (v_flow_id, v_analysing,  v_mitigating),
        (v_flow_id, v_mitigating, v_closed),
        (v_flow_id, v_closed,     v_accepted),
        -- Reverse from Analysing
        (v_flow_id, v_analysing,  v_identified),
        -- Reverse from Mitigating
        (v_flow_id, v_mitigating, v_analysing),
        (v_flow_id, v_mitigating, v_identified),
        -- Reverse from Closed
        (v_flow_id, v_closed,     v_mitigating),
        (v_flow_id, v_closed,     v_analysing),
        (v_flow_id, v_closed,     v_identified),
        -- Reverse from Accepted (rare but allowed if a risk recurs)
        (v_flow_id, v_accepted,   v_closed),
        (v_flow_id, v_accepted,   v_mitigating),
        (v_flow_id, v_accepted,   v_analysing),
        (v_flow_id, v_accepted,   v_identified),
        -- Skip-ahead edges (Identified directly to later states for already-mitigated risks)
        (v_flow_id, v_identified, v_mitigating),
        (v_flow_id, v_identified, v_closed);
END
$$;

-- Sanity check: Risk Flow has exactly 5 states and 16 transitions.
DO $$
DECLARE
    v_state_count INTEGER;
    v_trans_count INTEGER;
    v_flow_id     UUID;
BEGIN
    SELECT f.flows_id INTO v_flow_id
      FROM flows f
      JOIN artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
     WHERE at.artefacts_types_prefix = 'RSK'
       AND f.flows_name = 'Risk Flow'
       AND f.flows_archived_at IS NULL;

    SELECT COUNT(*) INTO v_state_count FROM flows_states WHERE flows_states_id_flow = v_flow_id AND flows_states_archived_at IS NULL;
    SELECT COUNT(*) INTO v_trans_count FROM flows_transitions WHERE flows_transitions_id_flow = v_flow_id;

    IF v_state_count <> 5 THEN
        RAISE EXCEPTION 'Migration 073 sanity: expected 5 Risk Flow states, found %', v_state_count;
    END IF;
    IF v_trans_count <> 16 THEN
        RAISE EXCEPTION 'Migration 073 sanity: expected 16 Risk Flow transitions, found %', v_trans_count;
    END IF;
END
$$;

COMMIT;
