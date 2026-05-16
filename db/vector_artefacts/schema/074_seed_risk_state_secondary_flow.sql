-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 4
-- Migration 074 — seed Risk State (secondary flow) — 7 states + free transitions
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 074_seed_risk_state_secondary_flow.sql
--
-- Risk's secondary flow — runs alongside Risk Flow (the default delivery
-- flow from mig 073). Captures the richer risk-lifecycle state machine:
--
--   Identified → Assessing → Mitigating → Monitoring → Closed
--                                                   ↘ Accepted-Residual (risk acknowledged, no further mitigation planned)
--                                                   ↘ Escalated         (kicked up to portfolio level)
--
-- All 'done'-kind states (Closed, Accepted-Residual, Escalated) are terminal
-- but can be re-entered if the risk surfaces again. Transitions follow the
-- Defect State pattern: forgiving — most states can return to any other.
--
-- Mirrors Defect's two-flow pattern: 1 default execution flow + 1 secondary
-- state-machine. flows_is_default = FALSE so flow_defaults snapshot is
-- unaffected.
--
-- Depends on: mig 071 (Risk artefacts_types row).
-- Idempotent: skips if Risk State flow already exists.
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_risk_type_id        UUID;
    v_flow_id             UUID;
    v_identified          UUID;
    v_assessing           UUID;
    v_mitigating          UUID;
    v_monitoring          UUID;
    v_closed              UUID;
    v_accepted_residual   UUID;
    v_escalated           UUID;
BEGIN
    SELECT artefacts_types_id INTO v_risk_type_id
      FROM artefacts_types
     WHERE artefacts_types_prefix = 'RSK'
       AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid
       AND artefacts_types_archived_at IS NULL;

    IF v_risk_type_id IS NULL THEN
        RAISE EXCEPTION 'Migration 074: Risk type not found. Apply mig 071 first.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM flows
         WHERE flows_id_artefact_type = v_risk_type_id
           AND flows_name = 'Risk State'
           AND flows_archived_at IS NULL
    ) THEN
        RAISE NOTICE 'Migration 074: Risk State flow already seeded, skipping.';
        RETURN;
    END IF;

    -- Secondary flow — NOT the default.
    INSERT INTO flows (
        flows_id_artefact_type,
        flows_name,
        flows_description,
        flows_is_default
    )
    VALUES (
        v_risk_type_id,
        'Risk State',
        'Secondary state-machine for richer Risk lifecycle: includes Accepted-Residual and Escalated terminal states.',
        FALSE
    )
    RETURNING flows_id INTO v_flow_id;

    -- 7 states
    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Identified', 'backlog', 10, TRUE, FALSE, 'Risk recorded, no assessment yet.')
    RETURNING flows_states_id INTO v_identified;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Assessing', 'todo', 20, FALSE, TRUE, 'Impact and probability being scored; mitigation owner identified.')
    RETURNING flows_states_id INTO v_assessing;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Mitigating', 'in_progress', 30, FALSE, FALSE, 'Mitigation actions in flight.')
    RETURNING flows_states_id INTO v_mitigating;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Monitoring', 'in_progress', 40, FALSE, FALSE, 'Mitigation complete or paused; risk being watched for re-emergence.')
    RETURNING flows_states_id INTO v_monitoring;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Closed', 'done', 50, FALSE, FALSE, 'Risk fully resolved or no longer applicable.')
    RETURNING flows_states_id INTO v_closed;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Accepted-Residual', 'done', 60, FALSE, FALSE, 'Risk acknowledged; no further mitigation planned; residual exposure accepted by stakeholders.')
    RETURNING flows_states_id INTO v_accepted_residual;

    INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable, flows_states_description)
    VALUES (v_flow_id, 'Escalated', 'done', 70, FALSE, FALSE, 'Risk escalated to portfolio or executive level; ownership transferred.')
    RETURNING flows_states_id INTO v_escalated;

    -- Free transition graph — Defect State pattern.
    -- Forward path + reverse edges + cross-edges between terminal states.
    INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to) VALUES
        -- Forward
        (v_flow_id, v_identified,        v_assessing),
        (v_flow_id, v_assessing,         v_mitigating),
        (v_flow_id, v_mitigating,        v_monitoring),
        (v_flow_id, v_monitoring,        v_closed),
        -- Terminal branches from Monitoring
        (v_flow_id, v_monitoring,        v_accepted_residual),
        (v_flow_id, v_monitoring,        v_escalated),
        -- Terminal branches from Mitigating (urgent close)
        (v_flow_id, v_mitigating,        v_closed),
        (v_flow_id, v_mitigating,        v_accepted_residual),
        (v_flow_id, v_mitigating,        v_escalated),
        -- Terminal branches from Assessing (immediate decision)
        (v_flow_id, v_assessing,         v_closed),
        (v_flow_id, v_assessing,         v_accepted_residual),
        (v_flow_id, v_assessing,         v_escalated),
        -- Re-open from terminal states
        (v_flow_id, v_closed,            v_monitoring),
        (v_flow_id, v_closed,            v_mitigating),
        (v_flow_id, v_closed,            v_assessing),
        (v_flow_id, v_accepted_residual, v_monitoring),
        (v_flow_id, v_accepted_residual, v_mitigating),
        (v_flow_id, v_escalated,         v_mitigating),
        (v_flow_id, v_escalated,         v_assessing),
        -- Lateral between terminal states
        (v_flow_id, v_closed,            v_accepted_residual),
        (v_flow_id, v_accepted_residual, v_closed),
        (v_flow_id, v_accepted_residual, v_escalated),
        -- Reverse from Mitigating
        (v_flow_id, v_mitigating,        v_assessing),
        -- Reverse from Assessing
        (v_flow_id, v_assessing,         v_identified);
END
$$;

-- Sanity check
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
       AND f.flows_name = 'Risk State'
       AND f.flows_archived_at IS NULL;

    SELECT COUNT(*) INTO v_state_count FROM flows_states WHERE flows_states_id_flow = v_flow_id AND flows_states_archived_at IS NULL;
    SELECT COUNT(*) INTO v_trans_count FROM flows_transitions WHERE flows_transitions_id_flow = v_flow_id;

    IF v_state_count <> 7 THEN
        RAISE EXCEPTION 'Migration 074 sanity: expected 7 Risk State states, found %', v_state_count;
    END IF;
    IF v_trans_count <> 24 THEN
        RAISE EXCEPTION 'Migration 074 sanity: expected 24 Risk State transitions, found %', v_trans_count;
    END IF;
END
$$;

COMMIT;
