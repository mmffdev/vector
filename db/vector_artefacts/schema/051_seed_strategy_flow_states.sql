-- vector_artefacts: seed flow states for strategy artefact types
-- 2026-05-13 — fix for 041_correct_work_flow_states.sql which filtered on
-- prefixes BC/BE/PO/SO but actual strategy prefixes are BO/FT/PRW/PR/TH.
-- Seeds any strategy flow that still has zero states (idempotent guard).

BEGIN;

DO $$
DECLARE
    v_flow_id   UUID;
    v_backlog   UUID;
    v_todo      UUID;
    v_doing     UUID;
    v_completed UUID;
    v_accepted  UUID;
    r RECORD;
BEGIN
    FOR r IN
        SELECT f.id AS flow_id
        FROM flows f
        JOIN artefact_types at ON at.id = f.artefact_type_id
        WHERE at.scope = 'strategy'
          AND at.archived_at IS NULL
          AND f.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM flow_states fs WHERE fs.flow_id = f.id AND fs.archived_at IS NULL)
    LOOP
        v_flow_id := r.flow_id;

        INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
        VALUES (v_flow_id, 'Backlog',   'backlog',     10, TRUE,  FALSE) RETURNING id INTO v_backlog;

        INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
        VALUES (v_flow_id, 'To Do',     'todo',        20, FALSE, TRUE)  RETURNING id INTO v_todo;

        INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
        VALUES (v_flow_id, 'Doing',     'in_progress', 30, FALSE, FALSE) RETURNING id INTO v_doing;

        INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
        VALUES (v_flow_id, 'Completed', 'done',        40, FALSE, FALSE) RETURNING id INTO v_completed;

        INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
        VALUES (v_flow_id, 'Accepted',  'accepted',    50, FALSE, FALSE) RETURNING id INTO v_accepted;

        INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
            (v_flow_id, v_backlog,   v_todo),
            (v_flow_id, v_todo,      v_doing),
            (v_flow_id, v_doing,     v_completed),
            (v_flow_id, v_completed, v_accepted),
            (v_flow_id, v_todo,      v_backlog),
            (v_flow_id, v_doing,     v_todo),
            (v_flow_id, v_completed, v_doing),
            (v_flow_id, v_accepted,  v_completed);
    END LOOP;
END $$;

COMMIT;
