-- ============================================================
-- ETL: o_flow_tenant (mmff_vector) → flows + flow_states (vector_artefacts)
-- PLA-0031 / M1.3.2
--
-- Run against vector_artefacts with mmff_vector accessible via dblink or FDW.
-- The script uses a standalone approach: read from mmff_vector, write to
-- vector_artefacts. Run in two steps:
--
--   Step 1 (mmff_vector): export to CSV
--     psql $MMFF_VECTOR_URL -c "\COPY (SELECT ...) TO '/tmp/flows_export.csv' CSV HEADER"
--
--   Step 2 (vector_artefacts): import and transform
--     psql $VA_URL -f dev/scripts/etl_flows.sql
--
-- Column map:
--   o_flow_tenant.subscription_id          → used to find artefact_types.subscription_id
--   o_flow_tenant.system_artefact_type_id  → join o_artefact_type_registry → match artefact_types by name/prefix
--   o_flow_tenant.tenant_artefact_type_id  → join obj_execution_types_tenant → match artefact_types by name
--   o_flow_tenant.portfolio_item_type_id   → join portfolio_item_types → match artefact_types by name (scope=strategy)
--   o_flow_tenant.name                     → flow_states.name
--   o_flow_tenant.canonical_code           → flow_states.kind (mapped below)
--   o_flow_tenant.flow_position            → flow_states.sort_order
--   o_flow_tenant.archived_at              → flow_states.archived_at
--
-- canonical_code → kind mapping:
--   defined      → todo
--   ready        → todo
--   in_progress  → in_progress
--   completed    → done
--   accepted     → done
--
-- One flows row is created per distinct (subscription_id, artefact_type_id)
-- group found in the export. flow_states rows are linked to that flows row.
--
-- Idempotent: uses ON CONFLICT DO NOTHING on the flows partial unique index
-- (one default flow per artefact_type) for re-runs.
-- ============================================================

-- ============================================================
-- STEP 1: Export from mmff_vector (run against mmff_vector DB)
-- ============================================================
-- \COPY (
--     SELECT
--         ft.id                        AS state_id,
--         ft.subscription_id,
--         ft.flow_position,
--         ft.name                      AS state_name,
--         ft.canonical_code,
--         ft.description,
--         ft.archived_at,
--         -- resolve type label for matching in vector_artefacts
--         COALESCE(
--             sys.scope_key,
--             ten.name,
--             pit.name
--         )                            AS type_label,
--         CASE
--             WHEN ft.system_artefact_type_id  IS NOT NULL THEN 'system'
--             WHEN ft.tenant_artefact_type_id  IS NOT NULL THEN 'tenant'
--             WHEN ft.portfolio_item_type_id   IS NOT NULL THEN 'portfolio'
--         END                          AS type_kind
--     FROM o_flow_tenant ft
--     LEFT JOIN o_artefact_type_registry        sys ON sys.id = ft.system_artefact_type_id
--     LEFT JOIN obj_execution_types_tenant      ten ON ten.id = ft.tenant_artefact_type_id
--     LEFT JOIN portfolio_item_types            pit ON pit.id = ft.portfolio_item_type_id
--     WHERE ft.archived_at IS NULL
--     ORDER BY ft.subscription_id, type_label, ft.flow_position
-- ) TO '/tmp/flows_export.csv' CSV HEADER;

-- ============================================================
-- STEP 2: Import into vector_artefacts (run against vector_artefacts DB)
-- ============================================================

BEGIN;

-- Staging table for the CSV import
CREATE TEMP TABLE flows_import (
    state_id      UUID,
    subscription_id UUID,
    flow_position   INT,
    state_name      TEXT,
    canonical_code  TEXT,
    description     TEXT,
    archived_at     TIMESTAMPTZ,
    type_label      TEXT,
    type_kind       TEXT
);

-- Load the CSV (adjust path if needed)
-- \COPY flows_import FROM '/tmp/flows_export.csv' CSV HEADER;

-- canonical_code → kind mapping (complete set observed in prod data)
CREATE TEMP TABLE canonical_kind_map (canonical_code TEXT, kind TEXT);
INSERT INTO canonical_kind_map VALUES
    ('backlog',     'todo'),
    ('defined',     'todo'),
    ('ready',       'todo'),
    ('doing',       'in_progress'),
    ('in_progress', 'in_progress'),
    ('completed',   'done'),
    ('accepted',    'done');

-- Insert one flows row per distinct (subscription_id, type_label) group.
-- Matches artefact_types by subscription_id + name (case-insensitive).
-- Uses is_default=true; the partial unique index prevents duplicates on re-run.
INSERT INTO flows (artefact_type_id, name, description, is_default)
SELECT DISTINCT ON (fi.subscription_id, fi.type_label)
    at.id           AS artefact_type_id,
    fi.type_label   AS name,
    NULL            AS description,
    TRUE            AS is_default
FROM flows_import fi
JOIN artefact_types at
    ON  at.subscription_id = fi.subscription_id
    AND lower(at.name) = lower(fi.type_label)
    AND at.archived_at IS NULL
ON CONFLICT DO NOTHING;

-- Insert flow_states into flows that currently have NO states.
-- Flows with existing seeded states are left untouched (idempotent guard).
-- flow_states has no (flow_id, name) unique constraint, so we guard by
-- checking for any existing active states on the target flow before inserting.
INSERT INTO flow_states (flow_id, name, kind, sort_order, is_initial, archived_at)
SELECT
    f.id            AS flow_id,
    fi.state_name   AS name,
    ckm.kind        AS kind,
    fi.flow_position AS sort_order,
    -- first state by position becomes is_initial
    (fi.flow_position = first_pos.min_pos) AS is_initial,
    fi.archived_at
FROM flows_import fi
JOIN artefact_types at
    ON  at.subscription_id = fi.subscription_id
    AND lower(at.name) = lower(fi.type_label)
    AND at.archived_at IS NULL
JOIN flows f
    ON  f.artefact_type_id = at.id
    AND f.is_default = TRUE
    AND f.archived_at IS NULL
    -- Only populate empty flows; seeded flows keep their states
    AND NOT EXISTS (
        SELECT 1 FROM flow_states fs2
        WHERE fs2.flow_id = f.id AND fs2.archived_at IS NULL
    )
JOIN canonical_kind_map ckm
    ON ckm.canonical_code = fi.canonical_code
JOIN (
    SELECT subscription_id, type_label, MIN(flow_position) AS min_pos
    FROM flows_import
    GROUP BY subscription_id, type_label
) first_pos
    ON  first_pos.subscription_id = fi.subscription_id
    AND first_pos.type_label = fi.type_label;

-- Verification counts
SELECT
    'flows inserted'      AS label,
    COUNT(*)              AS count
FROM flows
WHERE created_at > now() - interval '10 minutes'
UNION ALL
SELECT
    'flow_states inserted',
    COUNT(*)
FROM flow_states
WHERE created_at > now() - interval '10 minutes';

COMMIT;
