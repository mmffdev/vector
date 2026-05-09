-- ============================================================
-- ETL: defects (mmff_vector) → artefacts + artefact_field_values (vector_artefacts)
-- PLA-0033 / M3.3.2
--
-- Run against vector_artefacts with mmff_vector accessible via dblink or FDW.
-- The script uses a standalone approach: read from mmff_vector, write to
-- vector_artefacts. Run in two steps:
--
--   Step 1 (mmff_vector): export to CSV
--     psql $MMFF_VECTOR_URL -c "\COPY (SELECT ...) TO '/tmp/defects_export.csv' CSV HEADER"
--
--   Step 2 (vector_artefacts): import and transform
--     psql $VA_URL -f dev/scripts/etl_defects.sql
--
-- Column map (mmff_vector.defects → vector_artefacts):
--
--   NATIVE artefacts columns (direct copy):
--     id                → artefacts.id
--     subscription_id   → artefacts.subscription_id
--     key_num           → artefacts.number
--     name              → artefacts.title
--     description       → artefacts.description
--     name_author       → artefacts.created_by_user_id
--     name_owner        → artefacts.assigned_to_user_id
--     schedule_state    → artefacts.flow_state_id (mapped via canonical kind:
--                           defined/ready → todo
--                           in_progress   → in_progress
--                           completed     → done
--                           accepted      → done)
--     sprint            → artefacts.timebox_sprint_id (timebox sprint UUID, nullable)
--     created_at        → artefacts.created_at
--     updated_at        → artefacts.updated_at
--     archived_at       → artefacts.archived_at
--
--   DEFERRED / DROPPED:
--     type_id           → replaced by artefact_type_id (Defect type, resolved here)
--     hierarchy_parent  → artefacts.parent_artefact_id (deferred: source artefact
--                          may not exist in vector_artefacts yet; set NULL)
--     linked_story      → deferred (cross-type FK, no target artefact yet)
--     release           → artefacts.timebox_release_id (deferred: release ETL not
--                          yet run; set NULL)
--     rank              → artefacts.position (rank TEXT → ordinal INT derived from
--                          row_number() over subscription+type order)
--
--   artefact_field_values (EAV fields):
--     severity             → field: defect_severity   (string_value)
--     acceptance_criteria  → field: acceptance_criteria (text_value)
--     notes                → field: notes              (text_value)
--     steps_to_reproduce   → field: steps_to_reproduce (text_value)
--     environment          → field: environment        (string_value)
--     browser              → field: browser            (string_value)
--     regression           → field: regression         (boolean_value)
--     blocked              → field: blocked            (boolean_value)
--     blocked_reason       → field: blocked_reason     (string_value)
--     ready                → field: ready              (boolean_value)
--     expedite             → field: expedite           (boolean_value)
--     estimate_hours       → field: estimate_hours     (number_value)
--     estimate_remaining   → field: estimate_remaining (number_value)
--     risk_score           → field: risk_score         (number_value)
--     risk_impact          → field: risk_impact        (string_value)
--     lidentifier_colour   → field: lidentifier_colour (string_value)
--     lidentifier_type     → field: lidentifier_type   (string_value)
--
-- Idempotent: uses INSERT ... ON CONFLICT DO NOTHING on artefacts.id PK and
-- the unique index on artefact_field_values (artefact_id, field_library_id).
-- ============================================================

-- ============================================================
-- STEP 1: Export from mmff_vector (run against mmff_vector DB)
-- ============================================================
-- \COPY (
--     SELECT
--         d.id,
--         d.subscription_id,
--         d.key_num,
--         d.name,
--         d.description,
--         d.acceptance_criteria,
--         d.notes,
--         d.severity::text,
--         d.steps_to_reproduce,
--         d.environment,
--         d.browser,
--         d.regression,
--         d.name_author,
--         d.name_owner,
--         d.schedule_state,
--         d.blocked,
--         d.blocked_reason,
--         d.ready,
--         d.expedite,
--         d.sprint,
--         d.estimate_hours,
--         d.estimate_remaining,
--         d.risk_score,
--         d.risk_impact,
--         d.lidentifier_colour,
--         d.lidentifier_type,
--         d.created_at,
--         d.updated_at,
--         d.archived_at
--     FROM defects d
--     ORDER BY d.subscription_id, d.key_num
-- ) TO '/tmp/defects_export.csv' CSV HEADER;

-- ============================================================
-- STEP 2: Import into vector_artefacts (run against vector_artefacts DB)
-- ============================================================

BEGIN;

-- ─── Staging table for the CSV import ────────────────────────────────────────

CREATE TEMP TABLE defects_import (
    id                  UUID,
    subscription_id     UUID,
    key_num             BIGINT,
    name                TEXT,
    description         TEXT,
    acceptance_criteria TEXT,
    notes               TEXT,
    severity            TEXT,
    steps_to_reproduce  TEXT,
    environment         TEXT,
    browser             TEXT,
    regression          BOOLEAN,
    name_author         UUID,
    name_owner          UUID,
    schedule_state      TEXT,
    blocked             BOOLEAN,
    blocked_reason      TEXT,
    ready               BOOLEAN,
    expedite            BOOLEAN,
    sprint              UUID,
    estimate_hours      NUMERIC,
    estimate_remaining  NUMERIC,
    risk_score          NUMERIC,
    risk_impact         TEXT,
    lidentifier_colour  TEXT,
    lidentifier_type    TEXT,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    archived_at         TIMESTAMPTZ
);

-- Load the CSV (adjust path if needed)
-- \COPY defects_import FROM '/tmp/defects_export.csv' CSV HEADER;

-- ─── schedule_state → flow kind mapping ──────────────────────────────────────

CREATE TEMP TABLE defect_state_kind_map (schedule_state TEXT, kind TEXT);
INSERT INTO defect_state_kind_map VALUES
    ('defined',     'todo'),
    ('ready',       'todo'),
    ('in_progress', 'in_progress'),
    ('completed',   'done'),
    ('accepted',    'done');

-- ─── STEP A: Insert artefacts rows ───────────────────────────────────────────
-- Resolves artefact_type_id from the Defect system type (prefix='DE') per
-- subscription. Resolves flow_state_id from the default flow for that type,
-- matching by kind. workspace_id falls back to subscription_id when no
-- workspace row exists in fdw_workspaces (consistent with migration 019).
-- position is derived from the sort order of key_num within each
-- (subscription_id, artefact_type_id) group.

INSERT INTO artefacts (
    id,
    subscription_id,
    workspace_id,
    artefact_type_id,
    number,
    title,
    description,
    flow_state_id,
    created_by_user_id,
    assigned_to_user_id,
    timebox_sprint_id,
    position,
    created_at,
    updated_at,
    archived_at
)
SELECT
    di.id,
    di.subscription_id,
    -- workspace_id: prefer fdw_workspaces; fall back to subscription_id.
    COALESCE(
        (SELECT fw.id FROM fdw_workspaces fw
         WHERE fw.subscription_id = di.subscription_id
         LIMIT 1),
        di.subscription_id
    )                                           AS workspace_id,
    at.id                                       AS artefact_type_id,
    di.key_num                                  AS number,
    di.name                                     AS title,
    di.description,
    -- flow_state_id: match default flow → state by kind mapping.
    (
        SELECT fs.id
        FROM flows f
        JOIN flow_states fs ON fs.flow_id = f.id AND fs.archived_at IS NULL
        JOIN defect_state_kind_map skm ON skm.kind = fs.kind
        WHERE f.artefact_type_id = at.id
          AND f.is_default = TRUE
          AND f.archived_at IS NULL
          AND skm.schedule_state = di.schedule_state
        ORDER BY fs.sort_order
        LIMIT 1
    )                                           AS flow_state_id,
    di.name_author                              AS created_by_user_id,
    di.name_owner                               AS assigned_to_user_id,
    di.sprint                                   AS timebox_sprint_id,
    -- position: ordinal within (subscription, type) ordered by key_num.
    (ROW_NUMBER() OVER (
        PARTITION BY di.subscription_id
        ORDER BY di.key_num
    ) - 1)::INTEGER                             AS position,
    di.created_at,
    di.updated_at,
    di.archived_at
FROM defects_import di
JOIN artefact_types at
    ON  at.subscription_id = di.subscription_id
    AND at.scope           = 'work'
    AND at.source          = 'system'
    AND at.prefix          = 'DE'
    AND at.archived_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- ─── STEP B: Insert artefact_field_values for defect-specific fields ──────────
-- For each defect and each non-NULL defect-specific field, insert one row.
-- The field_library_id is resolved by (subscription_id, field_name).
-- The correct typed column (string_value / text_value / number_value /
-- boolean_value) is populated; all others remain NULL.
-- ON CONFLICT DO NOTHING makes re-runs safe.

-- severity (string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    di.id,
    fl.id,
    di.severity
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'defect_severity'
    AND fl.archived_at IS NULL
WHERE di.severity IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- acceptance_criteria (text_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, text_value)
SELECT
    di.id,
    fl.id,
    di.acceptance_criteria
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'acceptance_criteria'
    AND fl.archived_at IS NULL
WHERE di.acceptance_criteria IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- notes (text_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, text_value)
SELECT
    di.id,
    fl.id,
    di.notes
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'notes'
    AND fl.archived_at IS NULL
WHERE di.notes IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- steps_to_reproduce (text_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, text_value)
SELECT
    di.id,
    fl.id,
    di.steps_to_reproduce
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'steps_to_reproduce'
    AND fl.archived_at IS NULL
WHERE di.steps_to_reproduce IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- environment (string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    di.id,
    fl.id,
    di.environment
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'environment'
    AND fl.archived_at IS NULL
WHERE di.environment IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- browser (string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    di.id,
    fl.id,
    di.browser
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'browser'
    AND fl.archived_at IS NULL
WHERE di.browser IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- regression (boolean_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, boolean_value)
SELECT
    di.id,
    fl.id,
    di.regression
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'regression'
    AND fl.archived_at IS NULL
WHERE di.regression IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- blocked (boolean_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, boolean_value)
SELECT
    di.id,
    fl.id,
    di.blocked
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'blocked'
    AND fl.archived_at IS NULL
WHERE di.blocked IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- blocked_reason (string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    di.id,
    fl.id,
    di.blocked_reason
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'blocked_reason'
    AND fl.archived_at IS NULL
WHERE di.blocked_reason IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- ready (boolean_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, boolean_value)
SELECT
    di.id,
    fl.id,
    di.ready
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'ready'
    AND fl.archived_at IS NULL
WHERE di.ready IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- expedite (boolean_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, boolean_value)
SELECT
    di.id,
    fl.id,
    di.expedite
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'expedite'
    AND fl.archived_at IS NULL
WHERE di.expedite IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- estimate_hours (number_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, number_value)
SELECT
    di.id,
    fl.id,
    di.estimate_hours
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'estimate_hours'
    AND fl.archived_at IS NULL
WHERE di.estimate_hours IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- estimate_remaining (number_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, number_value)
SELECT
    di.id,
    fl.id,
    di.estimate_remaining
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'estimate_remaining'
    AND fl.archived_at IS NULL
WHERE di.estimate_remaining IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- risk_score (number_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, number_value)
SELECT
    di.id,
    fl.id,
    di.risk_score
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'risk_score'
    AND fl.archived_at IS NULL
WHERE di.risk_score IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- risk_impact (string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    di.id,
    fl.id,
    di.risk_impact
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'risk_impact'
    AND fl.archived_at IS NULL
WHERE di.risk_impact IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- lidentifier_colour (string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    di.id,
    fl.id,
    di.lidentifier_colour
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'lidentifier_colour'
    AND fl.archived_at IS NULL
WHERE di.lidentifier_colour IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- lidentifier_type (string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    di.id,
    fl.id,
    di.lidentifier_type
FROM defects_import di
JOIN artefact_field_library fl
    ON  fl.subscription_id = di.subscription_id
    AND fl.field_name = 'lidentifier_type'
    AND fl.archived_at IS NULL
WHERE di.lidentifier_type IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = di.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- ─── Verification counts ──────────────────────────────────────────────────────

SELECT
    'artefacts inserted (Defect type)'  AS label,
    COUNT(*)                            AS count
FROM artefacts a
JOIN artefact_types at ON at.id = a.artefact_type_id
WHERE at.prefix = 'DE'
  AND a.created_at > now() - interval '10 minutes'
UNION ALL
SELECT
    'artefact_field_values inserted',
    COUNT(*)
FROM artefact_field_values afv
JOIN artefacts a ON a.id = afv.artefact_id
JOIN artefact_types at ON at.id = a.artefact_type_id
WHERE at.prefix = 'DE'
  AND afv.created_at > now() - interval '10 minutes';

COMMIT;
