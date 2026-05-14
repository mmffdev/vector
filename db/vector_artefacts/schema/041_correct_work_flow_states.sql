-- ============================================================
-- F1.1.1–F1.1.5 — Correct seeded flow states for work types
--
-- Story/Epic/Defect: replace 4-state generic set (To Do, In Progress,
-- Done, Cancelled) with 5-state design set (Backlog, Ready, Doing,
-- Completed, Accepted).
--
-- Task: replace with 3-state set (Ready, Doing, Completed) — no Cancelled.
--
-- Defect: add a second QA/business flow (Submitted, Open, Fixed,
-- In Test, Not Reproducible, Deferred) alongside the execution flow.
--
-- All via vector_artefacts DB.
-- Apply: psql -U mmff_dev -d vector_artefacts -f 041_correct_work_flow_states.sql
-- ============================================================

BEGIN;

-- ── Step 1: Extend kind CHECK to include 'accepted' (F1.1.7) ────────────────

ALTER TABLE flow_states DROP CONSTRAINT flow_states_kind_check;
ALTER TABLE flow_states ADD CONSTRAINT flow_states_kind_check
    CHECK (kind IN ('todo', 'in_progress', 'done', 'accepted', 'cancelled'));

-- ── Step 2: Story (US) — replace 4 states with 5 ────────────────────────────
-- Flow id: 060d1387-3f98-492a-adfa-20b93650faf0

-- Drop existing transitions first (FK refs state ids)
DELETE FROM flow_transitions
WHERE flow_id = '060d1387-3f98-492a-adfa-20b93650faf0';

-- Reuse existing state rows (update in-place to preserve any artefact FK refs)
UPDATE flow_states SET name = 'Backlog',   kind = 'todo',        sort_order = 10, is_initial = TRUE
WHERE id = '05117643-4f8d-4851-b789-6dd9037020eb'; -- was To Do

UPDATE flow_states SET name = 'Ready',     kind = 'todo',        sort_order = 20, is_initial = FALSE
WHERE id = '4b7825a5-7e28-4031-8f53-f2199a113b61'; -- was In Progress

UPDATE flow_states SET name = 'Doing',     kind = 'in_progress', sort_order = 30, is_initial = FALSE
WHERE id = '806d3e1f-e511-4310-a37a-d1b332a560de'; -- was Done

UPDATE flow_states SET name = 'Completed', kind = 'done',        sort_order = 40, is_initial = FALSE
WHERE id = '5fb9b711-b88b-4530-9712-f6288f8376bf'; -- was Cancelled

-- Insert new Accepted state
INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial)
VALUES ('060d1387-3f98-492a-adfa-20b93650faf0', 'Accepted', 'accepted', 50, FALSE);

-- Rebuild transitions: Backlog→Ready→Doing→Completed→Accepted + back-steps
DO $$
DECLARE
    v_backlog   UUID := '05117643-4f8d-4851-b789-6dd9037020eb';
    v_ready     UUID := '4b7825a5-7e28-4031-8f53-f2199a113b61';
    v_doing     UUID := '806d3e1f-e511-4310-a37a-d1b332a560de';
    v_completed UUID := '5fb9b711-b88b-4530-9712-f6288f8376bf';
    v_accepted  UUID;
    v_flow      UUID := '060d1387-3f98-492a-adfa-20b93650faf0';
BEGIN
    SELECT id INTO v_accepted FROM flow_states WHERE flow_id = v_flow AND name = 'Accepted';
    INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
        (v_flow, v_backlog,   v_ready),
        (v_flow, v_ready,     v_doing),
        (v_flow, v_doing,     v_completed),
        (v_flow, v_completed, v_accepted),
        -- back-steps
        (v_flow, v_ready,     v_backlog),
        (v_flow, v_doing,     v_ready),
        (v_flow, v_completed, v_doing),
        (v_flow, v_accepted,  v_completed);
END $$;

-- ── Step 3: Epic (EP) — same 5-state set as Story ───────────────────────────
-- Flow id: 2cd0d7b3-f239-4711-9dfe-caff4bef56e5

DELETE FROM flow_transitions WHERE flow_id = '2cd0d7b3-f239-4711-9dfe-caff4bef56e5';

UPDATE flow_states SET name = 'Backlog',   kind = 'todo',        sort_order = 10, is_initial = TRUE
WHERE id = '4dcd9148-bd7c-4c2b-a32c-410dbd317918';

UPDATE flow_states SET name = 'Ready',     kind = 'todo',        sort_order = 20, is_initial = FALSE
WHERE id = '8db89a60-285a-4b19-9646-bc158d4085b5';

UPDATE flow_states SET name = 'Doing',     kind = 'in_progress', sort_order = 30, is_initial = FALSE
WHERE id = '83e71141-2c68-45ca-9d1d-81a000421d40';

UPDATE flow_states SET name = 'Completed', kind = 'done',        sort_order = 40, is_initial = FALSE
WHERE id = '10a83635-2df7-45ae-86e7-56c47db771a3';

INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial)
VALUES ('2cd0d7b3-f239-4711-9dfe-caff4bef56e5', 'Accepted', 'accepted', 50, FALSE);

DO $$
DECLARE
    v_backlog   UUID := '4dcd9148-bd7c-4c2b-a32c-410dbd317918';
    v_ready     UUID := '8db89a60-285a-4b19-9646-bc158d4085b5';
    v_doing     UUID := '83e71141-2c68-45ca-9d1d-81a000421d40';
    v_completed UUID := '10a83635-2df7-45ae-86e7-56c47db771a3';
    v_accepted  UUID;
    v_flow      UUID := '2cd0d7b3-f239-4711-9dfe-caff4bef56e5';
BEGIN
    SELECT id INTO v_accepted FROM flow_states WHERE flow_id = v_flow AND name = 'Accepted';
    INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
        (v_flow, v_backlog,   v_ready),
        (v_flow, v_ready,     v_doing),
        (v_flow, v_doing,     v_completed),
        (v_flow, v_completed, v_accepted),
        (v_flow, v_ready,     v_backlog),
        (v_flow, v_doing,     v_ready),
        (v_flow, v_completed, v_doing),
        (v_flow, v_accepted,  v_completed);
END $$;

-- ── Step 4: Defect (DE) execution flow — same 5-state set ───────────────────
-- Flow id: d28367cc-11d8-428f-87e5-0c1a0bb0a745

DELETE FROM flow_transitions WHERE flow_id = 'd28367cc-11d8-428f-87e5-0c1a0bb0a745';

UPDATE flow_states SET name = 'Backlog',   kind = 'todo',        sort_order = 10, is_initial = TRUE
WHERE id = '4a7e1478-7881-4711-a061-7b33ac795156';

UPDATE flow_states SET name = 'Ready',     kind = 'todo',        sort_order = 20, is_initial = FALSE
WHERE id = '20bbd213-56e2-4e73-a810-f7a1c1dfffb4';

UPDATE flow_states SET name = 'Doing',     kind = 'in_progress', sort_order = 30, is_initial = FALSE
WHERE id = '7be32ef9-c47b-4a45-8690-c2f083867a9d';

UPDATE flow_states SET name = 'Completed', kind = 'done',        sort_order = 40, is_initial = FALSE
WHERE id = '522db8e5-80f1-401d-999a-db4bd268364c';

INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial)
VALUES ('d28367cc-11d8-428f-87e5-0c1a0bb0a745', 'Accepted', 'accepted', 50, FALSE);

DO $$
DECLARE
    v_backlog   UUID := '4a7e1478-7881-4711-a061-7b33ac795156';
    v_ready     UUID := '20bbd213-56e2-4e73-a810-f7a1c1dfffb4';
    v_doing     UUID := '7be32ef9-c47b-4a45-8690-c2f083867a9d';
    v_completed UUID := '522db8e5-80f1-401d-999a-db4bd268364c';
    v_accepted  UUID;
    v_flow      UUID := 'd28367cc-11d8-428f-87e5-0c1a0bb0a745';
BEGIN
    SELECT id INTO v_accepted FROM flow_states WHERE flow_id = v_flow AND name = 'Accepted';
    INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
        (v_flow, v_backlog,   v_ready),
        (v_flow, v_ready,     v_doing),
        (v_flow, v_doing,     v_completed),
        (v_flow, v_completed, v_accepted),
        (v_flow, v_ready,     v_backlog),
        (v_flow, v_doing,     v_ready),
        (v_flow, v_completed, v_doing),
        (v_flow, v_accepted,  v_completed);
END $$;

-- ── Step 5: Task (TA) — 3-state set: Ready, Doing, Completed ────────────────
-- Flow id: ab5437db-d99f-4c51-982c-bb7f09362faf

DELETE FROM flow_transitions WHERE flow_id = 'ab5437db-d99f-4c51-982c-bb7f09362faf';

UPDATE flow_states SET name = 'Ready',     kind = 'todo',        sort_order = 10, is_initial = TRUE
WHERE id = 'b7ee344c-58e6-4ec1-ab1c-8f7a20c2528a'; -- was To Do

UPDATE flow_states SET name = 'Doing',     kind = 'in_progress', sort_order = 20, is_initial = FALSE
WHERE id = 'dc558e63-28cd-4805-9d8d-13e4dfcb1521'; -- was In Progress

UPDATE flow_states SET name = 'Completed', kind = 'done',        sort_order = 30, is_initial = FALSE
WHERE id = '80b544a8-6d41-4ce8-a4c3-4bb9c2636d16'; -- was Done

-- Remove Cancelled entirely (no artefacts in prod yet; safe delete)
DELETE FROM flow_states WHERE id = 'fac847fd-a1e9-4d81-be14-21642e6d21e8';

INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
    ('ab5437db-d99f-4c51-982c-bb7f09362faf', 'b7ee344c-58e6-4ec1-ab1c-8f7a20c2528a', 'dc558e63-28cd-4805-9d8d-13e4dfcb1521'),
    ('ab5437db-d99f-4c51-982c-bb7f09362faf', 'dc558e63-28cd-4805-9d8d-13e4dfcb1521', '80b544a8-6d41-4ce8-a4c3-4bb9c2636d16'),
    ('ab5437db-d99f-4c51-982c-bb7f09362faf', 'dc558e63-28cd-4805-9d8d-13e4dfcb1521', 'b7ee344c-58e6-4ec1-ab1c-8f7a20c2528a'),
    ('ab5437db-d99f-4c51-982c-bb7f09362faf', '80b544a8-6d41-4ce8-a4c3-4bb9c2636d16', 'dc558e63-28cd-4805-9d8d-13e4dfcb1521');

-- ── Step 6: Feature (FE) — update Accepted to use new 'accepted' kind ───────
-- Flow id: 4f10d0e0-43e3-4769-9757-2e9a2cb0a66f
-- Also fix Ready: should be 'todo' (already correct), Accepted was 'done' → 'accepted'

UPDATE flow_states SET kind = 'accepted'
WHERE id = 'aab4bbac-7d3f-4c58-be52-e773abf52b96'; -- Feature Accepted

-- ── Step 7: Defect QA/business flow — seed new flow ─────────────────────────
-- Defect artefact_type_id: resolved via prefix DE
-- New flow named "QA" alongside the existing "Default" (execution) flow.

DO $$
DECLARE
    v_de_type_id UUID;
    v_flow_id    UUID;
    v_submitted  UUID;
    v_open       UUID;
    v_fixed      UUID;
    v_in_test    UUID;
    v_not_repro  UUID;
    v_deferred   UUID;
BEGIN
    SELECT id INTO v_de_type_id
    FROM artefact_types
    WHERE prefix = 'DE' AND archived_at IS NULL
    LIMIT 1;

    -- Idempotent: skip if QA flow already exists
    IF EXISTS (SELECT 1 FROM flows WHERE artefact_type_id = v_de_type_id AND name = 'QA') THEN
        RETURN;
    END IF;

    INSERT INTO flows (artefact_type_id, name, description, is_default)
    VALUES (v_de_type_id, 'QA', 'Defect QA and business lifecycle', FALSE)
    RETURNING id INTO v_flow_id;

    INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial)
    VALUES (v_flow_id, 'Submitted',       'todo',        10, TRUE)  RETURNING id INTO v_submitted;

    INSERT INTO flow_states (flow_id, name, kind, sort_order)
    VALUES (v_flow_id, 'Open',            'todo',        20) RETURNING id INTO v_open;

    INSERT INTO flow_states (flow_id, name, kind, sort_order)
    VALUES (v_flow_id, 'Fixed',           'in_progress', 30) RETURNING id INTO v_fixed;

    INSERT INTO flow_states (flow_id, name, kind, sort_order)
    VALUES (v_flow_id, 'In Test',         'in_progress', 40) RETURNING id INTO v_in_test;

    INSERT INTO flow_states (flow_id, name, kind, sort_order)
    VALUES (v_flow_id, 'Not Reproducible','done',        50) RETURNING id INTO v_not_repro;

    INSERT INTO flow_states (flow_id, name, kind, sort_order)
    VALUES (v_flow_id, 'Deferred',        'done',        60) RETURNING id INTO v_deferred;

    INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
        (v_flow_id, v_submitted, v_open),
        (v_flow_id, v_open,      v_fixed),
        (v_flow_id, v_fixed,     v_in_test),
        (v_flow_id, v_in_test,   v_not_repro),
        (v_flow_id, v_in_test,   v_deferred),
        -- reopen paths
        (v_flow_id, v_open,      v_submitted),
        (v_flow_id, v_fixed,     v_open),
        (v_flow_id, v_in_test,   v_fixed);
END $$;

-- ── Step 8: Strategy types BC, BE, PO, SO — seed 5-state default flows ──────

DO $$
DECLARE
    v_flow_id   UUID;
    v_backlog   UUID;
    v_ready     UUID;
    v_doing     UUID;
    v_completed UUID;
    v_accepted  UUID;
    r RECORD;
BEGIN
    FOR r IN
        SELECT f.id AS flow_id
        FROM flows f
        JOIN artefact_types at ON at.id = f.artefact_type_id
        WHERE at.prefix IN ('BC','BE','PO','SO')
          AND NOT EXISTS (SELECT 1 FROM flow_states fs WHERE fs.flow_id = f.id)
    LOOP
        v_flow_id := r.flow_id;

        INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial)
        VALUES (v_flow_id, 'Backlog',   'todo',        10, TRUE)  RETURNING id INTO v_backlog;

        INSERT INTO flow_states (flow_id, name, kind, sort_order)
        VALUES (v_flow_id, 'Ready',     'todo',        20) RETURNING id INTO v_ready;

        INSERT INTO flow_states (flow_id, name, kind, sort_order)
        VALUES (v_flow_id, 'Doing',     'in_progress', 30) RETURNING id INTO v_doing;

        INSERT INTO flow_states (flow_id, name, kind, sort_order)
        VALUES (v_flow_id, 'Completed', 'done',        40) RETURNING id INTO v_completed;

        INSERT INTO flow_states (flow_id, name, kind, sort_order)
        VALUES (v_flow_id, 'Accepted',  'accepted',    50) RETURNING id INTO v_accepted;

        INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
            (v_flow_id, v_backlog,   v_ready),
            (v_flow_id, v_ready,     v_doing),
            (v_flow_id, v_doing,     v_completed),
            (v_flow_id, v_completed, v_accepted),
            (v_flow_id, v_ready,     v_backlog),
            (v_flow_id, v_doing,     v_ready),
            (v_flow_id, v_completed, v_doing),
            (v_flow_id, v_accepted,  v_completed);
    END LOOP;
END $$;

COMMIT;
