-- ============================================================
-- ETL: user_stories (mmff_vector) → artefacts + artefact_field_values (vector_artefacts)
-- PLA-0031 / M4.3.2
--
-- Run against vector_artefacts with mmff_vector accessible via dblink or FDW.
-- The script uses a standalone approach: read from mmff_vector, write to
-- vector_artefacts. Run in two steps:
--
--   Step 1 (mmff_vector): export to CSV
--     psql $MMFF_VECTOR_URL -c "\COPY (SELECT ...) TO '/tmp/user_stories_export.csv' CSV HEADER"
--
--   Step 2 (vector_artefacts): import and transform
--     psql $VA_URL -f dev/scripts/etl_user_stories.sql
--
-- Column map — M4.3.1 audit (user_stories → artefacts + artefact_field_values):
--
--   NATIVE artefacts columns:
--   user_stories.id                  → artefacts.id
--   user_stories.subscription_id     → artefacts.subscription_id
--   user_stories.key_num             → artefacts.number
--   user_stories.type_id             → (dropped — type resolved to artefact_types by name/prefix)
--   user_stories.hierarchy_parent    → artefacts.parent_artefact_id (soft FK; set after self-loop)
--   user_stories.name                → artefacts.title
--   user_stories.description         → artefacts.description
--   user_stories.name_author         → artefacts.created_by_user_id
--   user_stories.name_owner          → artefacts.owned_by_user_id
--   user_stories.rank                → artefacts.position (converted from lexicographic rank to row number)
--   user_stories.created_at          → artefacts.created_at
--   user_stories.updated_at          → artefacts.updated_at
--   user_stories.archived_at         → artefacts.archived_at
--
--   workspace_id: resolved from mmff_vector.workspaces via subscription_id
--   (exported as workspace_id in the CSV JOIN below).
--
--   artefact_field_values entries (field_name → value column):
--   acceptance_criteria   → us_acceptance_criteria    (text_value)
--   notes                 → us_notes                  (text_value)
--   schedule_state        → us_schedule_state         (string_value)
--   blocked               → us_blocked                (boolean_value)
--   blocked_reason        → us_blocked_reason         (string_value)
--   ready                 → us_ready                  (boolean_value)
--   expedite              → us_expedite               (boolean_value)
--   affects_doc           → us_affects_doc            (boolean_value)
--   sprint                → us_sprint_id              (string_value  — UUID as text)
--   release               → us_release_id             (string_value  — UUID as text)
--   estimate_points       → us_estimate_points        (number_value)
--   estimate_hours        → us_estimate_hours         (number_value)
--   estimate_remaining    → us_estimate_remaining     (number_value)
--   risk_score            → us_risk_score             (number_value)
--   risk_impact           → us_risk_impact            (string_value)
--   risk_probability      → us_risk_probability       (string_value)
--   lidentifier_colour    → us_lidentifier_colour     (string_value)
--   lidentifier_type      → us_lidentifier_type       (string_value)
--   count_child_tasks     → us_count_child_tasks      (number_value)
--   count_child_defects   → us_count_child_defects    (number_value)
--   count_child_test_cases→ us_count_child_test_cases (number_value)
--   test_case_status      → us_test_case_status       (string_value)
--   defect_status         → us_defect_status          (string_value)
--
-- Idempotent: artefacts insert uses ON CONFLICT (id) DO NOTHING.
--             artefact_field_values insert uses ON CONFLICT DO NOTHING
--             (unique index on artefact_id, field_library_id).
-- ============================================================

-- ============================================================
-- STEP 1: Export from mmff_vector (run against mmff_vector DB)
-- ============================================================
-- \COPY (
--     SELECT
--         us.id,
--         us.subscription_id,
--         -- resolve workspace_id: use the subscription's primary workspace
--         w.id                         AS workspace_id,
--         us.key_num,
--         us.hierarchy_parent,
--         us.name,
--         us.description,
--         us.acceptance_criteria,
--         us.notes,
--         us.name_author,
--         us.name_owner,
--         us.schedule_state,
--         us.blocked,
--         us.blocked_reason,
--         us.ready,
--         us.expedite,
--         us.affects_doc,
--         us.sprint,
--         us.release,
--         us.estimate_points,
--         us.estimate_hours,
--         us.estimate_remaining,
--         us.rank,
--         us.risk_score,
--         us.risk_impact,
--         us.risk_probability,
--         us.lidentifier_colour,
--         us.lidentifier_type,
--         us.count_child_tasks,
--         us.count_child_defects,
--         us.count_child_test_cases,
--         us.test_case_status,
--         us.defect_status,
--         us.created_at,
--         us.updated_at,
--         us.archived_at
--     FROM user_stories us
--     -- workspace join: take the first workspace per subscription
--     -- (mmff_vector has no is_default; use master_record_workspaces)
--     JOIN (
--         SELECT DISTINCT ON (subscription_id) id, subscription_id
--         FROM master_record_workspaces
--         ORDER BY subscription_id, id
--     ) w ON w.subscription_id = us.subscription_id
--     ORDER BY us.subscription_id, us.key_num
-- ) TO '/tmp/user_stories_export.csv' CSV HEADER;
--
-- NOTE: When running Step 2 via FDW (both DBs on same server), replace
-- the \COPY load with a direct INSERT from fdw_user_stories + fdw_workspaces,
-- and use DISTINCT ON (subscription_id) on fdw_workspaces for workspace_id.
-- Also add explicit NULL casts (NULL::text, NULL::numeric, NULL::boolean) in
-- the field_values UNION ALL to avoid type-inference errors.

-- ============================================================
-- STEP 2: Import into vector_artefacts (run against vector_artefacts DB)
-- ============================================================

BEGIN;

-- Staging table for the CSV import
CREATE TEMP TABLE us_import (
    id                    UUID,
    subscription_id       UUID,
    workspace_id          UUID,
    key_num               BIGINT,
    hierarchy_parent      UUID,
    name                  TEXT,
    description           TEXT,
    acceptance_criteria   TEXT,
    notes                 TEXT,
    name_author           UUID,
    name_owner            UUID,
    schedule_state        TEXT,
    blocked               BOOLEAN,
    blocked_reason        TEXT,
    ready                 BOOLEAN,
    expedite              BOOLEAN,
    affects_doc           BOOLEAN,
    sprint                UUID,
    release               UUID,
    estimate_points       NUMERIC,
    estimate_hours        NUMERIC,
    estimate_remaining    NUMERIC,
    rank                  TEXT,
    risk_score            NUMERIC,
    risk_impact           TEXT,
    risk_probability      TEXT,
    lidentifier_colour    TEXT,
    lidentifier_type      TEXT,
    count_child_tasks     INTEGER,
    count_child_defects   INTEGER,
    count_child_test_cases INTEGER,
    test_case_status      TEXT,
    defect_status         TEXT,
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ,
    archived_at           TIMESTAMPTZ
);

-- Load the CSV (adjust path if needed)
-- \COPY us_import FROM '/tmp/user_stories_export.csv' CSV HEADER;

-- ============================================================
-- Insert artefacts rows
--
-- position is derived from rank (lexicographic text → row_number per
-- subscription/type group). Ties in rank are broken by key_num.
-- hierarchy_parent is left NULL here; the self-referencing update
-- below patches it in after all rows exist.
-- ============================================================

INSERT INTO artefacts (
    id,
    subscription_id,
    workspace_id,
    artefact_type_id,
    number,
    title,
    description,
    parent_artefact_id,
    created_by_user_id,
    owned_by_user_id,
    position,
    created_at,
    updated_at,
    archived_at
)
SELECT
    ui.id,
    ui.subscription_id,
    ui.workspace_id,
    at.id                                            AS artefact_type_id,
    ui.key_num                                       AS number,
    ui.name                                          AS title,
    ui.description,
    NULL                                             AS parent_artefact_id,  -- patched below
    ui.name_author                                   AS created_by_user_id,
    ui.name_owner                                    AS owned_by_user_id,
    -- Convert lexicographic rank to a stable integer position within the
    -- (subscription, type) group.
    ROW_NUMBER() OVER (
        PARTITION BY ui.subscription_id
        ORDER BY ui.rank NULLS LAST, ui.key_num
    )::INTEGER                                       AS position,
    ui.created_at,
    ui.updated_at,
    ui.archived_at
FROM us_import ui
JOIN artefact_types at
    ON  at.subscription_id = ui.subscription_id
    AND at.scope   = 'work'
    AND at.source  = 'system'
    AND at.prefix  = 'US'
    AND at.archived_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- Patch hierarchy_parent: update parent_artefact_id for rows where the
-- parent was also a user_story (and thus now exists as an artefact).
UPDATE artefacts a
SET parent_artefact_id = ui.hierarchy_parent
FROM us_import ui
WHERE a.id = ui.id
  AND ui.hierarchy_parent IS NOT NULL
  -- Only link if the parent was also migrated.
  AND EXISTS (SELECT 1 FROM artefacts WHERE id = ui.hierarchy_parent);

-- ============================================================
-- Insert artefact_field_values
--
-- Each non-NULL field from us_import becomes one row in
-- artefact_field_values, referencing the correct field_library_id
-- by field_name slug, scoped to the correct subscription.
-- ON CONFLICT DO NOTHING makes re-runs safe.
-- ============================================================

-- Helper CTE: resolve all us_* field_library ids per subscription.
-- We join field_library by (subscription_id, field_name) and fall back
-- to a global row (NULL subscription_id) if a tenant row is absent.
WITH fl AS (
    SELECT DISTINCT ON (ui.subscription_id, afl.field_name)
        ui.subscription_id,
        afl.id           AS field_library_id,
        afl.field_name,
        afl.field_type
    FROM us_import ui
    JOIN artefact_field_library afl
        ON  afl.field_name LIKE 'us_%'
        AND afl.archived_at IS NULL
        AND (
            afl.subscription_id = ui.subscription_id
            OR afl.subscription_id IS NULL
        )
    ORDER BY
        ui.subscription_id,
        afl.field_name,
        -- Prefer subscription-specific over global.
        (afl.subscription_id IS NOT NULL) DESC
)

INSERT INTO artefact_field_values
    (artefact_id, field_library_id, string_value, text_value, number_value, boolean_value)

-- acceptance_criteria (richtext → text_value)
SELECT ui.id, fl.field_library_id, NULL, ui.acceptance_criteria, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_acceptance_criteria'
WHERE ui.acceptance_criteria IS NOT NULL

UNION ALL

-- notes (richtext → text_value)
SELECT ui.id, fl.field_library_id, NULL, ui.notes, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_notes'
WHERE ui.notes IS NOT NULL

UNION ALL

-- schedule_state (select → string_value)
SELECT ui.id, fl.field_library_id, ui.schedule_state, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_schedule_state'
WHERE ui.schedule_state IS NOT NULL

UNION ALL

-- blocked (boolean → boolean_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, NULL, ui.blocked
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_blocked'
WHERE ui.blocked IS NOT NULL

UNION ALL

-- blocked_reason (textbox → string_value)
SELECT ui.id, fl.field_library_id, ui.blocked_reason, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_blocked_reason'
WHERE ui.blocked_reason IS NOT NULL

UNION ALL

-- ready (boolean → boolean_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, NULL, ui.ready
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_ready'
WHERE ui.ready IS NOT NULL

UNION ALL

-- expedite (boolean → boolean_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, NULL, ui.expedite
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_expedite'
WHERE ui.expedite IS NOT NULL

UNION ALL

-- affects_doc (boolean → boolean_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, NULL, ui.affects_doc
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_affects_doc'
WHERE ui.affects_doc IS NOT NULL

UNION ALL

-- sprint (UUID as text → string_value)
SELECT ui.id, fl.field_library_id, ui.sprint::TEXT, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_sprint_id'
WHERE ui.sprint IS NOT NULL

UNION ALL

-- release (UUID as text → string_value)
SELECT ui.id, fl.field_library_id, ui.release::TEXT, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_release_id'
WHERE ui.release IS NOT NULL

UNION ALL

-- estimate_points (decimal → number_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, ui.estimate_points, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_estimate_points'
WHERE ui.estimate_points IS NOT NULL

UNION ALL

-- estimate_hours (decimal → number_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, ui.estimate_hours, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_estimate_hours'
WHERE ui.estimate_hours IS NOT NULL

UNION ALL

-- estimate_remaining (decimal → number_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, ui.estimate_remaining, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_estimate_remaining'
WHERE ui.estimate_remaining IS NOT NULL

UNION ALL

-- risk_score (decimal → number_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, ui.risk_score, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_risk_score'
WHERE ui.risk_score IS NOT NULL

UNION ALL

-- risk_impact (select → string_value)
SELECT ui.id, fl.field_library_id, ui.risk_impact, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_risk_impact'
WHERE ui.risk_impact IS NOT NULL

UNION ALL

-- risk_probability (select → string_value)
SELECT ui.id, fl.field_library_id, ui.risk_probability, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_risk_probability'
WHERE ui.risk_probability IS NOT NULL

UNION ALL

-- lidentifier_colour (textbox → string_value)
SELECT ui.id, fl.field_library_id, ui.lidentifier_colour, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_lidentifier_colour'
WHERE ui.lidentifier_colour IS NOT NULL

UNION ALL

-- lidentifier_type (textbox → string_value)
SELECT ui.id, fl.field_library_id, ui.lidentifier_type, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_lidentifier_type'
WHERE ui.lidentifier_type IS NOT NULL

UNION ALL

-- count_child_tasks (integer → number_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, ui.count_child_tasks, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_count_child_tasks'
WHERE ui.count_child_tasks IS NOT NULL

UNION ALL

-- count_child_defects (integer → number_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, ui.count_child_defects, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_count_child_defects'
WHERE ui.count_child_defects IS NOT NULL

UNION ALL

-- count_child_test_cases (integer → number_value)
SELECT ui.id, fl.field_library_id, NULL, NULL, ui.count_child_test_cases, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_count_child_test_cases'
WHERE ui.count_child_test_cases IS NOT NULL

UNION ALL

-- test_case_status (textbox → string_value)
SELECT ui.id, fl.field_library_id, ui.test_case_status, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_test_case_status'
WHERE ui.test_case_status IS NOT NULL

UNION ALL

-- defect_status (textbox → string_value)
SELECT ui.id, fl.field_library_id, ui.defect_status, NULL, NULL, NULL
FROM us_import ui
JOIN fl ON fl.subscription_id = ui.subscription_id AND fl.field_name = 'us_defect_status'
WHERE ui.defect_status IS NOT NULL

ON CONFLICT DO NOTHING;

-- Verification counts
SELECT
    'artefacts inserted (User Story)'  AS label,
    COUNT(*)                            AS count
FROM artefacts a
JOIN artefact_types at ON at.id = a.artefact_type_id
WHERE at.prefix = 'US'
  AND at.scope  = 'work'
  AND a.created_at > now() - interval '10 minutes'
UNION ALL
SELECT
    'artefact_field_values inserted',
    COUNT(*)
FROM artefact_field_values afv
JOIN artefacts a ON a.id = afv.artefact_id
JOIN artefact_types at ON at.id = a.artefact_type_id
WHERE at.prefix = 'US'
  AND at.scope  = 'work'
  AND afv.created_at > now() - interval '10 minutes';

COMMIT;
