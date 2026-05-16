-- ============================================================
-- MMFFDev - vector_artefacts: Work Items POC fixture (v2 cutover)
-- Mirror of mmff_vector.db/seed/002_work_items_poc.sql, ported to the
-- unified `artefacts` schema in the vector_artefacts database.
--
-- Run against vector_artefacts:
--   PGPASSWORD=... psql -h localhost -p <DEV_DB_PORT> -U mmff_dev \
--                       -d vector_artefacts -v ON_ERROR_STOP=1 \
--                       -f db/artefacts_schema/seed/01_work_items_fixture.sql
--
-- (DEV_DB_PORT typically 5435 — see dev/scripts/resolve-dev-db-port.sh.)
--
-- IDEMPOTENT: every INSERT uses ON CONFLICT DO NOTHING. Re-runs are no-ops.
--
-- Subscription: 00000000-0000-0000-0000-000000000001 (MMFFDev dev tenant) —
-- the same subscription used by db/seed/002_work_items_poc.sql and by
-- 011_seed_system_strategy_types.sql.
--
-- PREREQUISITES (must be in place before this file applies):
--   1. Schema migrations 001..009 applied to vector_artefacts.
--   2. The 4 system work artefact_types seeded for this subscription:
--          Story (US), Defect (DE), Task (TA), Epic (EP).
--      The function lives in 010_seed_system_artefact_types.sql but is
--      NOT auto-invoked by that file. Either:
--          SELECT seed_system_artefact_types('00000000-0000-0000-0000-000000000001'::uuid);
--      or apply this fixture in the same psql session as that SELECT.
--      A guard at the top of this file ABORTS with a clear NOTICE if any
--      of the four types are missing.
--
-- WORKSPACE NOTE: artefacts.workspace_id is NOT NULL but is a soft FK to
-- mmff_vector.workspace(id). The mmff_vector seed does not pin a stable
-- UUID for the default workspace, so this fixture uses a deterministic
-- fixture-only UUID — '20000000-0000-0000-0000-000000000001'. Production
-- code paths must validate workspace_id against mmff_vector before insert;
-- the fixture is exempt because vector_artefacts does not enforce the FK.
--
-- ID PRESERVATION: the source fixture (db/seed/002_work_items_poc.sql)
-- uses deterministic UUIDs of the form 10000000-...-NNN for every work
-- item row. Those UUIDs are PRESERVED here so cross-DB references between
-- mmff_vector.o_artefacts_execution_work_items.id and
-- vector_artefacts.artefacts.id stay aligned during the cutover.
--
-- WHAT IS NOT MIRRORED:
--   - sprints, o_execution_custom_field_library, o_execution_work_item_templates,
--     o_execution_work_item_template_fields — these legacy tables have no
--     1:1 equivalent yet in vector_artefacts. Sprint membership in the new
--     model belongs in artefact_field_values via field_library; that wiring
--     is out of scope for this fixture (no field_library rows seeded).
--   - status / priority / story_points / sprint_id / key_num — these were
--     core columns on the legacy work-items table; in the new model they
--     are custom fields. Not seeded here. The PoC v2 page renders state
--     via flow_state_id, which IS populated below from each row's
--     mapped status -> default-flow state-name lookup.
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_sub        UUID := '00000000-0000-0000-0000-000000000001';
    v_workspace  UUID := '20000000-0000-0000-0000-000000000001';  -- fixture-only soft FK
    v_owner      UUID := '6cabe266-b2f4-43f9-879c-06020c789a0b';  -- padmin@mmffdev.com (mmff_vector.users)

    -- artefact_types (resolved by lookup; fail loudly if missing).
    v_t_epic   UUID;
    v_t_story  UUID;
    v_t_task   UUID;
    v_t_defect UUID;

    -- flow_states resolved per type (kind = 'todo'|'in_progress'|'done').
    v_s_epic_todo     UUID;  v_s_epic_progress UUID;  v_s_epic_done UUID;
    v_s_story_todo    UUID;  v_s_story_progress UUID; v_s_story_done UUID;
    v_s_task_todo     UUID;  v_s_task_progress UUID;  v_s_task_done UUID;
    v_s_defect_todo   UUID;  v_s_defect_progress UUID;v_s_defect_done UUID;

    -- Mirrored row UUIDs (taken verbatim from db/seed/002_work_items_poc.sql).
    v_ep1 UUID := '10000000-0000-0000-0000-000000000100';
    v_ep2 UUID := '10000000-0000-0000-0000-000000000101';
    v_ep3 UUID := '10000000-0000-0000-0000-000000000102';

    v_st1 UUID := '10000000-0000-0000-0000-000000000200';
    v_st2 UUID := '10000000-0000-0000-0000-000000000201';
    v_st3 UUID := '10000000-0000-0000-0000-000000000202';
    v_st4 UUID := '10000000-0000-0000-0000-000000000203';
    v_st5 UUID := '10000000-0000-0000-0000-000000000204';
    v_st6 UUID := '10000000-0000-0000-0000-000000000205';

    v_ta1 UUID := '10000000-0000-0000-0000-000000000300';
    v_ta2 UUID := '10000000-0000-0000-0000-000000000301';
    v_ta3 UUID := '10000000-0000-0000-0000-000000000302';
    v_ta4 UUID := '10000000-0000-0000-0000-000000000303';

    v_de1 UUID := '10000000-0000-0000-0000-000000000400';
    v_de2 UUID := '10000000-0000-0000-0000-000000000401';
BEGIN
    -- ----------------------------------------------------------
    -- 1. Resolve the 4 system work artefact_types for this subscription.
    --    Abort with a clear message if any are missing.
    -- ----------------------------------------------------------
    SELECT id INTO v_t_epic   FROM artefact_types
        WHERE subscription_id = v_sub AND scope = 'work' AND prefix = 'EP'
          AND archived_at IS NULL;
    SELECT id INTO v_t_story  FROM artefact_types
        WHERE subscription_id = v_sub AND scope = 'work' AND prefix = 'US'
          AND archived_at IS NULL;
    SELECT id INTO v_t_task   FROM artefact_types
        WHERE subscription_id = v_sub AND scope = 'work' AND prefix = 'TA'
          AND archived_at IS NULL;
    SELECT id INTO v_t_defect FROM artefact_types
        WHERE subscription_id = v_sub AND scope = 'work' AND prefix = 'DE'
          AND archived_at IS NULL;

    IF v_t_epic   IS NULL OR v_t_story  IS NULL
    OR v_t_task   IS NULL OR v_t_defect IS NULL THEN
        RAISE EXCEPTION
            'work_items_fixture: missing system work artefact_types for subscription %. '
            'Run: SELECT seed_system_artefact_types(''%''::uuid);  before this seed.',
            v_sub, v_sub;
    END IF;

    -- ----------------------------------------------------------
    -- 2. Resolve default-flow states for each type (todo / in_progress / done).
    --    The seed function in 010_seed_system_artefact_types.sql creates
    --    one default flow per type with these three kinds + 'cancelled'.
    -- ----------------------------------------------------------
    SELECT fs.id INTO v_s_epic_todo
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_epic AND fs.kind = 'todo';
    SELECT fs.id INTO v_s_epic_progress
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_epic AND fs.kind = 'in_progress';
    SELECT fs.id INTO v_s_epic_done
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_epic AND fs.kind = 'done';

    SELECT fs.id INTO v_s_story_todo
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_story AND fs.kind = 'todo';
    SELECT fs.id INTO v_s_story_progress
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_story AND fs.kind = 'in_progress';
    SELECT fs.id INTO v_s_story_done
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_story AND fs.kind = 'done';

    SELECT fs.id INTO v_s_task_todo
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_task AND fs.kind = 'todo';
    SELECT fs.id INTO v_s_task_progress
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_task AND fs.kind = 'in_progress';
    SELECT fs.id INTO v_s_task_done
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_task AND fs.kind = 'done';

    SELECT fs.id INTO v_s_defect_todo
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_defect AND fs.kind = 'todo';
    SELECT fs.id INTO v_s_defect_progress
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_defect AND fs.kind = 'in_progress';
    SELECT fs.id INTO v_s_defect_done
        FROM flow_states fs
        JOIN flows f ON f.id = fs.flow_id AND f.is_default
        WHERE f.artefact_type_id = v_t_defect AND fs.kind = 'done';

    -- ----------------------------------------------------------
    -- 3. Epics (3 rows) — top-level, no parent.
    --    Source mapping (item_type='epic' -> artefact_type EP).
    --    Source statuses: 'in_progress', 'open', 'open' -> kind in_progress/todo/todo.
    -- ----------------------------------------------------------
    INSERT INTO artefacts (
        id, subscription_id, workspace_id, artefact_type_id, number,
        title, parent_artefact_id, flow_state_id,
        created_by_user_id, owned_by_user_id, position
    ) VALUES
        (v_ep1, v_sub, v_workspace, v_t_epic, 1,
         'Portfolio Model — Core Adoption Flow',
         NULL, v_s_epic_progress,
         v_owner, v_owner, 0),
        (v_ep2, v_sub, v_workspace, v_t_epic, 2,
         'Work Items — Tree Grid & Custom Fields',
         NULL, v_s_epic_todo,
         v_owner, v_owner, 1),
        (v_ep3, v_sub, v_workspace, v_t_epic, 3,
         'Navigation & UX Improvements',
         NULL, v_s_epic_todo,
         v_owner, v_owner, 2)
    ON CONFLICT (id) DO NOTHING;

    -- ----------------------------------------------------------
    -- 4. Stories (6 rows) — children of epics.
    --    Source statuses (per row): done, in_progress, open, open, open, open.
    -- ----------------------------------------------------------
    INSERT INTO artefacts (
        id, subscription_id, workspace_id, artefact_type_id, number,
        title, parent_artefact_id, flow_state_id,
        created_by_user_id, owned_by_user_id, position
    ) VALUES
        (v_st1, v_sub, v_workspace, v_t_story, 1,
         'Backend: adoption orchestrator (7-step saga)',
         v_ep1, v_s_story_done,        v_owner, v_owner, 0),
        (v_st2, v_sub, v_workspace, v_t_story, 2,
         'Frontend: adoption overlay with SSE progress',
         v_ep1, v_s_story_progress,    v_owner, v_owner, 1),
        (v_st3, v_sub, v_workspace, v_t_story, 3,
         'Backend: work items list + children endpoints',
         v_ep2, v_s_story_todo,        v_owner, v_owner, 0),
        (v_st4, v_sub, v_workspace, v_t_story, 4,
         'Frontend: work items tree grid (3-level)',
         v_ep2, v_s_story_todo,        v_owner, v_owner, 1),
        (v_st5, v_sub, v_workspace, v_t_story, 5,
         'Sidebar: collapsed icon-only state + flyout',
         v_ep3, v_s_story_todo,        v_owner, v_owner, 0),
        (v_st6, v_sub, v_workspace, v_t_story, 6,
         'AppHeader: breadcrumb + avatar + notifications',
         v_ep3, v_s_story_todo,        v_owner, v_owner, 1)
    ON CONFLICT (id) DO NOTHING;

    -- ----------------------------------------------------------
    -- 5. Tasks (4 rows) — children of stories.
    --    Source statuses: done, open, open, open.
    -- ----------------------------------------------------------
    INSERT INTO artefacts (
        id, subscription_id, workspace_id, artefact_type_id, number,
        title, parent_artefact_id, flow_state_id,
        created_by_user_id, owned_by_user_id, position
    ) VALUES
        (v_ta1, v_sub, v_workspace, v_t_task, 1,
         'Write migration for sprints + core columns',
         v_st3, v_s_task_done, v_owner, v_owner, 0),
        (v_ta2, v_sub, v_workspace, v_t_task, 2,
         'Implement GET /api/work-items handler',
         v_st3, v_s_task_todo, v_owner, v_owner, 1),
        (v_ta3, v_sub, v_workspace, v_t_task, 3,
         'Build TreeGrid React component (expand/collapse)',
         v_st4, v_s_task_todo, v_owner, v_owner, 0),
        (v_ta4, v_sub, v_workspace, v_t_task, 4,
         'Add filter bar to Work Items page',
         v_st4, v_s_task_todo, v_owner, v_owner, 1)
    ON CONFLICT (id) DO NOTHING;

    -- ----------------------------------------------------------
    -- 6. Defects (2 rows) — children of stories.
    --    Source statuses: open, open.
    -- ----------------------------------------------------------
    INSERT INTO artefacts (
        id, subscription_id, workspace_id, artefact_type_id, number,
        title, parent_artefact_id, flow_state_id,
        created_by_user_id, owned_by_user_id, position
    ) VALUES
        (v_de1, v_sub, v_workspace, v_t_defect, 1,
         'Adoption overlay freezes on Step 4 timeout',
         v_st2, v_s_defect_todo, v_owner, v_owner, 0),
        (v_de2, v_sub, v_workspace, v_t_defect, 2,
         'Tree grid loses scroll position on filter change',
         v_st4, v_s_defect_todo, v_owner, v_owner, 1)
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Work Items v2 fixture seed complete (15 artefacts: 3 epic, 6 story, 4 task, 2 defect).';
END;
$$;

COMMIT;
