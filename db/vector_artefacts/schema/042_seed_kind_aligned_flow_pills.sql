-- ============================================================
-- FLOW1.1.1–FLOW1.1.4 — Kind primitive widening + is_pullable flag +
-- seed re-alignment + DE/US corruption repair.
--
-- This migration establishes the canonical flow-state model:
--   * 6 primitive kinds: backlog | todo | in_progress | done | accepted | cancelled
--   * is_pullable BOOLEAN flag — opt-in per pill, default FALSE
--   * Default-flow pill names align 1:1 with their kinds (Backlog/To Do/Doing/...)
--   * The single pullable pill in default flows is "To Do"
--
-- Folds in the repair of corrupted DE-Default and US-Default flows
-- (drag-test damage: junk pills inserted, canonical kinds scrambled).
--
-- Apply: psql -U mmff_dev -d vector_artefacts -f 042_seed_kind_aligned_flow_pills.sql
-- ============================================================

BEGIN;

-- ── Step 1: Widen kind CHECK to include 'backlog' (FLOW1.1.1) ───────────────

ALTER TABLE flow_states DROP CONSTRAINT flow_states_kind_check;
ALTER TABLE flow_states ADD CONSTRAINT flow_states_kind_check
    CHECK (kind IN ('backlog', 'todo', 'in_progress', 'done', 'accepted', 'cancelled'));

-- ── Step 2: Add is_pullable column (FLOW1.1.2) ──────────────────────────────

ALTER TABLE flow_states
    ADD COLUMN is_pullable BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN flow_states.is_pullable IS
    'TRUE when teams may pull artefacts from this state. Independent of kind. '
    'Default flows seed exactly one pullable pill ("To Do"); compliance-gated '
    'flows can have multiple kind=todo pills with only the final one pullable. '
    'Pull-surface query: WHERE is_pullable=TRUE OR kind IN (in_progress,done,accepted).';

-- ── Step 3: Repair US (Story) Default flow + re-align (FLOW1.1.3 + 1.1.4) ──
-- Flow id: 060d1387-3f98-492a-adfa-20b93650faf0
-- Corruption: stray pill "test" at sort 50 pushing Accepted to 60.
-- Re-alignment: rename "Ready" → "To Do" in place; flip Backlog kind to 'backlog'.

DELETE FROM flow_transitions WHERE flow_id = '060d1387-3f98-492a-adfa-20b93650faf0';

-- Delete junk pill (id resolved by name match — not in canonical seed list)
DELETE FROM flow_states
WHERE flow_id = '060d1387-3f98-492a-adfa-20b93650faf0'
  AND id NOT IN (
      '05117643-4f8d-4851-b789-6dd9037020eb',  -- Backlog
      '4b7825a5-7e28-4031-8f53-f2199a113b61',  -- Ready (→ To Do)
      '806d3e1f-e511-4310-a37a-d1b332a560de',  -- Doing
      '5fb9b711-b88b-4530-9712-f6288f8376bf',  -- Completed
      '68d7436a-be9e-4f5e-b9d6-d2b3d9a9b9b9'   -- Accepted (placeholder; resolved below)
  )
  AND id NOT IN (
      SELECT id FROM flow_states
      WHERE flow_id = '060d1387-3f98-492a-adfa-20b93650faf0'
        AND name = 'Accepted' AND kind = 'accepted'
  );

UPDATE flow_states SET name = 'Backlog', kind = 'backlog', sort_order = 10, is_initial = TRUE,  is_pullable = FALSE, archived_at = NULL
WHERE id = '05117643-4f8d-4851-b789-6dd9037020eb';

UPDATE flow_states SET name = 'To Do',   kind = 'todo',    sort_order = 20, is_initial = FALSE, is_pullable = TRUE,  archived_at = NULL
WHERE id = '4b7825a5-7e28-4031-8f53-f2199a113b61';

UPDATE flow_states SET name = 'Doing',     kind = 'in_progress', sort_order = 30, is_initial = FALSE, is_pullable = FALSE, archived_at = NULL
WHERE id = '806d3e1f-e511-4310-a37a-d1b332a560de';

UPDATE flow_states SET name = 'Completed', kind = 'done',        sort_order = 40, is_initial = FALSE, is_pullable = FALSE, archived_at = NULL
WHERE id = '5fb9b711-b88b-4530-9712-f6288f8376bf';

UPDATE flow_states SET name = 'Accepted',  kind = 'accepted',    sort_order = 50, is_initial = FALSE, is_pullable = FALSE, archived_at = NULL
WHERE flow_id = '060d1387-3f98-492a-adfa-20b93650faf0' AND name = 'Accepted' AND kind = 'accepted';

DO $$
DECLARE
    v_backlog   UUID := '05117643-4f8d-4851-b789-6dd9037020eb';
    v_todo      UUID := '4b7825a5-7e28-4031-8f53-f2199a113b61';
    v_doing     UUID := '806d3e1f-e511-4310-a37a-d1b332a560de';
    v_completed UUID := '5fb9b711-b88b-4530-9712-f6288f8376bf';
    v_accepted  UUID;
    v_flow      UUID := '060d1387-3f98-492a-adfa-20b93650faf0';
BEGIN
    SELECT id INTO v_accepted FROM flow_states
    WHERE flow_id = v_flow AND name = 'Accepted' AND kind = 'accepted'
    ORDER BY sort_order LIMIT 1;

    INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
        (v_flow, v_backlog,   v_todo),
        (v_flow, v_todo,      v_doing),
        (v_flow, v_doing,     v_completed),
        (v_flow, v_completed, v_accepted),
        (v_flow, v_todo,      v_backlog),
        (v_flow, v_doing,     v_todo),
        (v_flow, v_completed, v_doing),
        (v_flow, v_accepted,  v_completed);
END $$;

-- ── Step 4: Repair DE (Defect) Default flow + re-align ──────────────────────
-- Flow id: d28367cc-11d8-428f-87e5-0c1a0bb0a745
-- Corruption: 8 junk pills (Test, Start, fwerrt, fdgfdggddg, gfgffg, TEST PILL,
-- Lego, ertyertyerty), canonical kinds scrambled (Doing was 'accepted',
-- Completed was 'in_progress', Accepted was 'todo').

DELETE FROM flow_transitions WHERE flow_id = 'd28367cc-11d8-428f-87e5-0c1a0bb0a745';

-- Delete junk pills (anything whose id is not in the canonical seed list).
-- Canonical Accepted state for this flow needs runtime resolution because
-- there are 2 pills currently named "Accepted" in the corrupt data; we keep
-- the one with kind='accepted' (the canonical one created by 041 INSERT).
DELETE FROM flow_states
WHERE flow_id = 'd28367cc-11d8-428f-87e5-0c1a0bb0a745'
  AND id NOT IN (
      '4a7e1478-7881-4711-a061-7b33ac795156',  -- Backlog
      '20bbd213-56e2-4e73-a810-f7a1c1dfffb4',  -- Ready (→ To Do)
      '7be32ef9-c47b-4a45-8690-c2f083867a9d',  -- Doing
      '522db8e5-80f1-401d-999a-db4bd268364c'   -- Completed
  )
  AND id NOT IN (
      -- Keep the canonical Accepted (kind='accepted'), drop any duplicates.
      SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, name) AS rn
          FROM flow_states
          WHERE flow_id = 'd28367cc-11d8-428f-87e5-0c1a0bb0a745'
            AND name = 'Accepted' AND kind = 'accepted'
      ) t WHERE rn = 1
  );

-- Reset canonical pills (note: was kind='todo' for Backlog originally; flipping to 'backlog')
UPDATE flow_states SET name = 'Backlog', kind = 'backlog', sort_order = 10, is_initial = TRUE,  is_pullable = FALSE, archived_at = NULL
WHERE id = '4a7e1478-7881-4711-a061-7b33ac795156';

UPDATE flow_states SET name = 'To Do',   kind = 'todo',    sort_order = 20, is_initial = FALSE, is_pullable = TRUE,  archived_at = NULL
WHERE id = '20bbd213-56e2-4e73-a810-f7a1c1dfffb4';

UPDATE flow_states SET name = 'Doing',     kind = 'in_progress', sort_order = 30, is_initial = FALSE, is_pullable = FALSE, archived_at = NULL
WHERE id = '7be32ef9-c47b-4a45-8690-c2f083867a9d';

UPDATE flow_states SET name = 'Completed', kind = 'done',        sort_order = 40, is_initial = FALSE, is_pullable = FALSE, archived_at = NULL
WHERE id = '522db8e5-80f1-401d-999a-db4bd268364c';

UPDATE flow_states SET name = 'Accepted',  kind = 'accepted',    sort_order = 50, is_initial = FALSE, is_pullable = FALSE, archived_at = NULL
WHERE flow_id = 'd28367cc-11d8-428f-87e5-0c1a0bb0a745' AND name = 'Accepted' AND kind = 'accepted';

-- Safety net: if the canonical Accepted row didn't survive (e.g. dev DB never
-- ran 041 cleanly), insert a fresh one.
INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial, is_pullable)
SELECT 'd28367cc-11d8-428f-87e5-0c1a0bb0a745', 'Accepted', 'accepted', 50, FALSE, FALSE
WHERE NOT EXISTS (
    SELECT 1 FROM flow_states
    WHERE flow_id = 'd28367cc-11d8-428f-87e5-0c1a0bb0a745'
      AND name = 'Accepted' AND kind = 'accepted'
);

DO $$
DECLARE
    v_backlog   UUID := '4a7e1478-7881-4711-a061-7b33ac795156';
    v_todo      UUID := '20bbd213-56e2-4e73-a810-f7a1c1dfffb4';
    v_doing     UUID := '7be32ef9-c47b-4a45-8690-c2f083867a9d';
    v_completed UUID := '522db8e5-80f1-401d-999a-db4bd268364c';
    v_accepted  UUID;
    v_flow      UUID := 'd28367cc-11d8-428f-87e5-0c1a0bb0a745';
BEGIN
    SELECT id INTO v_accepted FROM flow_states
    WHERE flow_id = v_flow AND name = 'Accepted' AND kind = 'accepted'
    ORDER BY sort_order LIMIT 1;

    INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
        (v_flow, v_backlog,   v_todo),
        (v_flow, v_todo,      v_doing),
        (v_flow, v_doing,     v_completed),
        (v_flow, v_completed, v_accepted),
        (v_flow, v_todo,      v_backlog),
        (v_flow, v_doing,     v_todo),
        (v_flow, v_completed, v_doing),
        (v_flow, v_accepted,  v_completed);
END $$;

-- ── Step 5: Re-align Epic (EP) Default flow ─────────────────────────────────
-- Flow id: 2cd0d7b3-f239-4711-9dfe-caff4bef56e5
-- Already clean per check; just rename Ready → To Do, flip Backlog kind, set is_pullable.

DELETE FROM flow_transitions WHERE flow_id = '2cd0d7b3-f239-4711-9dfe-caff4bef56e5';

UPDATE flow_states SET name = 'Backlog', kind = 'backlog', sort_order = 10, is_initial = TRUE,  is_pullable = FALSE
WHERE id = '4dcd9148-bd7c-4c2b-a32c-410dbd317918';

UPDATE flow_states SET name = 'To Do',   kind = 'todo',    sort_order = 20, is_initial = FALSE, is_pullable = TRUE
WHERE id = '8db89a60-285a-4b19-9646-bc158d4085b5';

UPDATE flow_states SET name = 'Doing',     kind = 'in_progress', sort_order = 30, is_initial = FALSE, is_pullable = FALSE
WHERE id = '83e71141-2c68-45ca-9d1d-81a000421d40';

UPDATE flow_states SET name = 'Completed', kind = 'done',        sort_order = 40, is_initial = FALSE, is_pullable = FALSE
WHERE id = '10a83635-2df7-45ae-86e7-56c47db771a3';

UPDATE flow_states SET name = 'Accepted',  kind = 'accepted',    sort_order = 50, is_initial = FALSE, is_pullable = FALSE
WHERE flow_id = '2cd0d7b3-f239-4711-9dfe-caff4bef56e5' AND name = 'Accepted' AND kind = 'accepted';

DO $$
DECLARE
    v_backlog   UUID := '4dcd9148-bd7c-4c2b-a32c-410dbd317918';
    v_todo      UUID := '8db89a60-285a-4b19-9646-bc158d4085b5';
    v_doing     UUID := '83e71141-2c68-45ca-9d1d-81a000421d40';
    v_completed UUID := '10a83635-2df7-45ae-86e7-56c47db771a3';
    v_accepted  UUID;
    v_flow      UUID := '2cd0d7b3-f239-4711-9dfe-caff4bef56e5';
BEGIN
    SELECT id INTO v_accepted FROM flow_states
    WHERE flow_id = v_flow AND name = 'Accepted' AND kind = 'accepted'
    ORDER BY sort_order LIMIT 1;

    INSERT INTO flow_transitions (flow_id, from_state_id, to_state_id) VALUES
        (v_flow, v_backlog,   v_todo),
        (v_flow, v_todo,      v_doing),
        (v_flow, v_doing,     v_completed),
        (v_flow, v_completed, v_accepted),
        (v_flow, v_todo,      v_backlog),
        (v_flow, v_doing,     v_todo),
        (v_flow, v_completed, v_doing),
        (v_flow, v_accepted,  v_completed);
END $$;

-- ── Step 6: Task (TA) Default — 3-state set, To Do is pullable + is_initial ─
-- Flow id: ab5437db-d99f-4c51-982c-bb7f09362faf

UPDATE flow_states SET name = 'To Do',     kind = 'todo',        sort_order = 10, is_initial = TRUE,  is_pullable = TRUE
WHERE id = 'b7ee344c-58e6-4ec1-ab1c-8f7a20c2528a';

UPDATE flow_states SET name = 'Doing',     kind = 'in_progress', sort_order = 20, is_initial = FALSE, is_pullable = FALSE
WHERE id = 'dc558e63-28cd-4805-9d8d-13e4dfcb1521';

UPDATE flow_states SET name = 'Completed', kind = 'done',        sort_order = 30, is_initial = FALSE, is_pullable = FALSE
WHERE id = '80b544a8-6d41-4ce8-a4c3-4bb9c2636d16';

-- Task transitions are already correct (no Backlog/Accepted), no rebuild needed.

-- ── Step 7: Feature (FE) Default — re-align ─────────────────────────────────
-- Flow id: 4f10d0e0-43e3-4769-9757-2e9a2cb0a66f
-- Pills already exist with correct kinds (per 041 step 6 and seed); rename
-- "Ready" → "To Do" by name match, flip Backlog kind, set is_pullable.

UPDATE flow_states SET kind = 'backlog', is_pullable = FALSE
WHERE flow_id = '4f10d0e0-43e3-4769-9757-2e9a2cb0a66f' AND name = 'Backlog';

UPDATE flow_states SET name = 'To Do', is_pullable = TRUE
WHERE flow_id = '4f10d0e0-43e3-4769-9757-2e9a2cb0a66f' AND name = 'Ready';

UPDATE flow_states SET is_pullable = FALSE
WHERE flow_id = '4f10d0e0-43e3-4769-9757-2e9a2cb0a66f' AND name IN ('Doing', 'Completed', 'Accepted');

-- ── Step 8: Strategy types BC, BE, PO, SO Default flows — re-align ──────────
-- Pills already seeded by 041 step 8. Rename Ready→To Do, flip Backlog kind,
-- set is_pullable on the new To Do pill.

UPDATE flow_states fs SET kind = 'backlog', is_pullable = FALSE
FROM flows f
JOIN artefact_types at ON at.id = f.artefact_type_id
WHERE fs.flow_id = f.id
  AND at.prefix IN ('BC','BE','PO','SO')
  AND fs.name = 'Backlog';

UPDATE flow_states fs SET name = 'To Do', is_pullable = TRUE
FROM flows f
JOIN artefact_types at ON at.id = f.artefact_type_id
WHERE fs.flow_id = f.id
  AND at.prefix IN ('BC','BE','PO','SO')
  AND fs.name = 'Ready';

UPDATE flow_states fs SET is_pullable = FALSE
FROM flows f
JOIN artefact_types at ON at.id = f.artefact_type_id
WHERE fs.flow_id = f.id
  AND at.prefix IN ('BC','BE','PO','SO')
  AND fs.name IN ('Doing', 'Completed', 'Accepted');

-- ── Step 9: Defect QA flow — leave names alone, set is_pullable on Open ─────
-- Flow: DE QA (97b4cae0…). Pills are domain-specific (Submitted/Open/Fixed/...).
-- Convention: Submitted is initial (pre-triage backlog-like), Open is the
-- pullable handoff point where the dev team can take it.

UPDATE flow_states SET kind = 'backlog', is_pullable = FALSE
WHERE flow_id IN (SELECT id FROM flows WHERE name = 'QA' AND artefact_type_id IN (
        SELECT id FROM artefact_types WHERE prefix = 'DE'))
  AND name = 'Submitted';

UPDATE flow_states SET is_pullable = TRUE
WHERE flow_id IN (SELECT id FROM flows WHERE name = 'QA' AND artefact_type_id IN (
        SELECT id FROM artefact_types WHERE prefix = 'DE'))
  AND name = 'Open';

COMMIT;
