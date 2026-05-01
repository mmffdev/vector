-- ============================================================
-- MMFFDev - Vector: Work Items POC seed data
-- Seed 002 — applied on top of migrations 063-065
-- Run: PGPASSWORD=... psql -h localhost -p 5435 -U mmff_dev -d mmff_vector -v ON_ERROR_STOP=1 -f db/seed/002_work_items_poc.sql
--
-- Creates realistic but fake data for the Work Items POC:
--   - 1 sprint (active)
--   - 2 custom field library entries
--   - 1 work item template (Bug Report) with 2 fields
--   - 3 epics
--   - 6 stories (2 per epic)
--   - 4 tasks + 2 defects (children of stories)
--
-- Idempotent: all INSERTs use ON CONFLICT DO NOTHING.
-- Subscription: 00000000-0000-0000-0000-000000000001 (MMFFDev dev tenant)
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_sub   UUID := '00000000-0000-0000-0000-000000000001';
    v_owner UUID := '6cabe266-b2f4-43f9-879c-06020c789a0b'; -- padmin@mmffdev.com

    -- Sprint
    v_sprint_id UUID := '10000000-0000-0000-0000-000000000001';

    -- Custom field library
    v_fld_env_id    UUID := '10000000-0000-0000-0000-000000000010';
    v_fld_repro_id  UUID := '10000000-0000-0000-0000-000000000011';

    -- Template
    v_tmpl_id UUID := '10000000-0000-0000-0000-000000000020';

    -- Epics
    v_ep1 UUID := '10000000-0000-0000-0000-000000000100';
    v_ep2 UUID := '10000000-0000-0000-0000-000000000101';
    v_ep3 UUID := '10000000-0000-0000-0000-000000000102';

    -- Stories (2 per epic)
    v_st1 UUID := '10000000-0000-0000-0000-000000000200';
    v_st2 UUID := '10000000-0000-0000-0000-000000000201';
    v_st3 UUID := '10000000-0000-0000-0000-000000000202';
    v_st4 UUID := '10000000-0000-0000-0000-000000000203';
    v_st5 UUID := '10000000-0000-0000-0000-000000000204';
    v_st6 UUID := '10000000-0000-0000-0000-000000000205';

    -- Tasks (children of stories)
    v_ta1 UUID := '10000000-0000-0000-0000-000000000300';
    v_ta2 UUID := '10000000-0000-0000-0000-000000000301';
    v_ta3 UUID := '10000000-0000-0000-0000-000000000302';
    v_ta4 UUID := '10000000-0000-0000-0000-000000000303';

    -- Defects (children of stories)
    v_de1 UUID := '10000000-0000-0000-0000-000000000400';
    v_de2 UUID := '10000000-0000-0000-0000-000000000401';

BEGIN

    -- --------------------------------------------------------
    -- Sprint
    -- --------------------------------------------------------
    INSERT INTO sprints (id, subscription_id, name, goal, start_date, end_date, status, created_by)
    VALUES (
        v_sprint_id, v_sub,
        'Sprint 1 — Work Items POC',
        'Ship the Work Items tree grid and detail panel end-to-end',
        CURRENT_DATE - 7,
        CURRENT_DATE + 7,
        'active',
        v_owner
    )
    ON CONFLICT (id) DO NOTHING;

    -- --------------------------------------------------------
    -- Custom field library
    -- --------------------------------------------------------
    INSERT INTO o_execution_custom_field_library (id, subscription_id, field_name, label, type, options_json, created_by)
    VALUES
        (v_fld_env_id,   v_sub, 'environment',       'Environment',       'select',
         '["production","staging","development","local"]'::jsonb, v_owner),
        (v_fld_repro_id, v_sub, 'repro_steps',       'Reproduction Steps','richtext',
         NULL, v_owner)
    ON CONFLICT (id) DO NOTHING;

    -- --------------------------------------------------------
    -- Work item template: Bug Report
    -- --------------------------------------------------------
    INSERT INTO o_execution_work_item_templates (id, subscription_id, name, description, item_type, created_by)
    VALUES (
        v_tmpl_id, v_sub,
        'Bug Report',
        'Standard template for defect / bug reports',
        'story',
        v_owner
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO o_execution_work_item_template_fields (template_id, field_library_id, position, required)
    VALUES
        (v_tmpl_id, v_fld_env_id,   0, TRUE),
        (v_tmpl_id, v_fld_repro_id, 1, FALSE)
    ON CONFLICT (template_id, field_library_id) DO NOTHING;

    -- --------------------------------------------------------
    -- Epics (item_type = 'epic')
    -- --------------------------------------------------------
    INSERT INTO o_artefacts_execution_work_items
        (id, subscription_id, key_num, title, item_type, status, priority, owner_id, created_by)
    VALUES
        (v_ep1, v_sub, 1, 'Portfolio Model — Core Adoption Flow', 'epic', 'in_progress', 'high',    v_owner, v_owner),
        (v_ep2, v_sub, 2, 'Work Items — Tree Grid & Custom Fields', 'epic', 'open',       'critical', v_owner, v_owner),
        (v_ep3, v_sub, 3, 'Navigation & UX Improvements',           'epic', 'open',       'medium',   v_owner, v_owner)
    ON CONFLICT (id) DO NOTHING;

    -- Set root_feature_id to self for epics (they are their own root)
    UPDATE o_artefacts_execution_work_items
        SET root_feature_id = id
        WHERE id IN (v_ep1, v_ep2, v_ep3) AND root_feature_id IS NULL;

    -- --------------------------------------------------------
    -- Stories (item_type = 'story', parent = epic)
    -- --------------------------------------------------------
    INSERT INTO o_artefacts_execution_work_items
        (id, subscription_id, key_num, title, item_type, status, priority, story_points, sprint_id, parent_id, root_feature_id, owner_id, created_by)
    VALUES
        -- Epic 1 children
        (v_st1, v_sub, 4,  'Backend: adoption orchestrator (7-step saga)',  'story', 'done',        'high',   8,  v_sprint_id, v_ep1, v_ep1, v_owner, v_owner),
        (v_st2, v_sub, 5,  'Frontend: adoption overlay with SSE progress',  'story', 'in_progress', 'high',   5,  v_sprint_id, v_ep1, v_ep1, v_owner, v_owner),
        -- Epic 2 children
        (v_st3, v_sub, 6,  'Backend: work items list + children endpoints', 'story', 'open',        'critical',5, v_sprint_id, v_ep2, v_ep2, v_owner, v_owner),
        (v_st4, v_sub, 7,  'Frontend: work items tree grid (3-level)',       'story', 'open',        'critical',8, v_sprint_id, v_ep2, v_ep2, v_owner, v_owner),
        -- Epic 3 children
        (v_st5, v_sub, 8,  'Sidebar: collapsed icon-only state + flyout',   'story', 'open',        'medium', 3,  NULL,        v_ep3, v_ep3, v_owner, v_owner),
        (v_st6, v_sub, 9,  'AppHeader: breadcrumb + avatar + notifications','story', 'open',        'low',    3,  NULL,        v_ep3, v_ep3, v_owner, v_owner)
    ON CONFLICT (id) DO NOTHING;

    -- --------------------------------------------------------
    -- Tasks (children of stories, unified work items table)
    -- --------------------------------------------------------
    INSERT INTO o_artefacts_execution_work_items
        (id, subscription_id, key_num, title, item_type, status, priority, sprint_id, parent_id, root_feature_id, owner_id, created_by)
    VALUES
        (v_ta1, v_sub, 10, 'Write migration for sprints + core columns',       'task', 'done',        'high',     v_sprint_id, v_st3, v_ep2, v_owner, v_owner),
        (v_ta2, v_sub, 11, 'Implement GET /api/work-items handler',            'task', 'open',        'high',     v_sprint_id, v_st3, v_ep2, v_owner, v_owner),
        (v_ta3, v_sub, 12, 'Build TreeGrid React component (expand/collapse)', 'task', 'open',        'critical', v_sprint_id, v_st4, v_ep2, v_owner, v_owner),
        (v_ta4, v_sub, 13, 'Add filter bar to Work Items page',                'task', 'open',        'medium',   v_sprint_id, v_st4, v_ep2, v_owner, v_owner)
    ON CONFLICT (id) DO NOTHING;

    -- --------------------------------------------------------
    -- Defects (children of stories, unified work items table)
    -- --------------------------------------------------------
    INSERT INTO o_artefacts_execution_work_items
        (id, subscription_id, key_num, title, item_type, status, priority, sprint_id, parent_id, root_feature_id, owner_id, created_by)
    VALUES
        (v_de1, v_sub, 14, 'Adoption overlay freezes on Step 4 timeout',        'defect', 'open', 'high',   v_sprint_id, v_st2, v_ep1, v_owner, v_owner),
        (v_de2, v_sub, 15, 'Tree grid loses scroll position on filter change',   'defect', 'open', 'medium', v_sprint_id, v_st4, v_ep2, v_owner, v_owner)
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Work Items POC seed complete.';
END;
$$;

COMMIT;
