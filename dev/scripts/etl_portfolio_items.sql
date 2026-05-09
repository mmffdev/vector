-- ============================================================
-- ETL: obj_portfolio_items (mmff_vector) → artefacts + artefact_field_values (vector_artefacts)
-- PLA-0033 / M5.3.2
--
-- Run against vector_artefacts with mmff_vector accessible via dblink or FDW.
-- The script uses a standalone approach: read from mmff_vector, write to
-- vector_artefacts. Run in two steps:
--
--   Step 1 (mmff_vector): export to CSV
--     psql $MMFF_VECTOR_URL -c "\COPY (SELECT ...) TO '/tmp/portfolio_items_export.csv' CSV HEADER"
--
--   Step 2 (vector_artefacts): import and transform
--     psql $VA_URL -f dev/scripts/etl_portfolio_items.sql
--
-- Column map (obj_portfolio_items → artefacts):
--   id                            → artefacts.id          (preserved)
--   subscription_id               → artefacts.subscription_id
--   key_num                       → artefacts.number
--   hierarchy_parent              → artefacts.parent_artefact_id
--   name                          → artefacts.title
--   description                   → artefacts.description
--   name_author                   → artefacts.created_by_user_id
--   name_owner                    → artefacts.owned_by_user_id
--   flow_state (uuid → flow_states.id)  → artefacts.flow_state_id  (see note)
--   created_at                    → artefacts.created_at
--   updated_at                    → artefacts.updated_at
--   archived_at                   → artefacts.archived_at
--   workspace_id                  → artefacts.workspace_id (resolved from subscription default workspace)
--
-- Note on flow_state: obj_portfolio_items.flow_state is a UUID referencing
-- o_flow_tenant(id) in mmff_vector. The ETL resolves it to a flow_states.id
-- in vector_artefacts by joining via the exported flow_state_name column.
-- If no match is found, flow_state_id is set to NULL (allowed).
--
-- Column map (obj_portfolio_items → artefact_field_values):
--   acceptance_criteria           → pi_acceptance_criteria   (text_value)
--   notes                         → pi_notes                 (text_value)
--   flow_state_change_update_date → pi_flow_state_change_date (string_value, ISO8601)
--   flow_state_change_owner       → pi_flow_state_change_owner (string_value, UUID)
--   blocked                       → pi_blocked               (boolean_value)
--   blocked_reason                → pi_blocked_reason        (string_value)
--   date_work_planned_start       → pi_date_work_planned_start (date_value)
--   date_work_planned_finish      → pi_date_work_planned_finish (date_value)
--   date_work_started             → pi_date_work_started     (date_value)
--   date_work_accepted            → pi_date_work_accepted    (date_value)
--   estimate_initial              → pi_estimate_initial      (string_value)
--   estimate_updated              → pi_estimate_updated      (number_value)
--   risk_impact                   → pi_risk_impact           (string_value)
--   risk_probability              → pi_risk_probability      (string_value)
--   risk_score                    → pi_risk_score            (number_value)
--   strategic_investment_group    → pi_strategic_investment_group (string_value)
--   strategic_investment_weight   → pi_strategic_investment_weight (string_value)
--   strategic_item_type           → pi_strategic_item_type   (string_value)
--   value_stream_identifier       → pi_value_stream_identifier (string_value)
--   lidentifier_colour            → pi_lidentifier_colour    (string_value)
--   lidentifier_labels (text[])   → pi_lidentifier_labels    (text_value, JSON array)
--   lidentifier_tags   (text[])   → pi_lidentifier_tags      (text_value, JSON array)
--
-- Excluded (computed at read time, not stored):
--   count_child_defects, count_child_user_stories, count_dependants,
--   count_rollup_defect, count_rollup_defects, count_rollup_estimation,
--   count_rollup_risks, done_by_story_count
--
-- Idempotent: artefacts insert uses ON CONFLICT (id) DO NOTHING.
--             artefact_field_values uses ON CONFLICT (artefact_id, field_library_id) DO NOTHING.
-- ============================================================

-- ============================================================
-- STEP 1: Export from mmff_vector (run against mmff_vector DB)
-- ============================================================
-- \COPY (
--     SELECT
--         pi.id,
--         pi.subscription_id,
--         pi.key_num,
--         pi.hierarchy_parent,
--         pi.name,
--         pi.description,
--         pi.acceptance_criteria,
--         pi.notes,
--         pi.name_author,
--         pi.name_owner,
--         -- Export flow state UUID and its canonical label for resolution in vector_artefacts
--         pi.flow_state                                    AS flow_state_id,
--         ft.name                                          AS flow_state_name,
--         ft.canonical_code                                AS flow_state_canonical_code,
--         pi.flow_state_change_update_date,
--         pi.flow_state_change_owner,
--         pi.blocked,
--         pi.blocked_reason,
--         pi.date_work_planned_start,
--         pi.date_work_planned_finish,
--         pi.date_work_started,
--         pi.date_work_accepted,
--         pi.estimate_initial,
--         pi.estimate_updated,
--         pi.risk_impact,
--         pi.risk_probability,
--         pi.risk_score,
--         pi.strategic_investment_group,
--         pi.strategic_investment_weight,
--         pi.strategic_item_type,
--         pi.value_stream_identifier,
--         pi.lidentifier_colour,
--         array_to_json(pi.lidentifier_labels)::text       AS lidentifier_labels_json,
--         array_to_json(pi.lidentifier_tags)::text         AS lidentifier_tags_json,
--         pi.created_at,
--         pi.updated_at,
--         pi.archived_at
--     FROM obj_portfolio_items pi
--     LEFT JOIN o_flow_tenant ft ON ft.id = pi.flow_state
--     ORDER BY pi.subscription_id, pi.key_num
-- ) TO '/tmp/portfolio_items_export.csv' CSV HEADER;

-- ============================================================
-- STEP 2: Import into vector_artefacts (run against vector_artefacts DB)
-- ============================================================

BEGIN;

-- Staging table for the CSV import
CREATE TEMP TABLE portfolio_items_import (
    id                              UUID,
    subscription_id                 UUID,
    key_num                         BIGINT,
    hierarchy_parent                UUID,
    name                            TEXT,
    description                     TEXT,
    acceptance_criteria             TEXT,
    notes                           TEXT,
    name_author                     UUID,
    name_owner                      UUID,
    flow_state_id                   UUID,
    flow_state_name                 TEXT,
    flow_state_canonical_code       TEXT,
    flow_state_change_update_date   TIMESTAMPTZ,
    flow_state_change_owner         UUID,
    blocked                         BOOLEAN,
    blocked_reason                  TEXT,
    date_work_planned_start         DATE,
    date_work_planned_finish        DATE,
    date_work_started               DATE,
    date_work_accepted              DATE,
    estimate_initial                TEXT,
    estimate_updated                NUMERIC,
    risk_impact                     TEXT,
    risk_probability                TEXT,
    risk_score                      NUMERIC,
    strategic_investment_group      TEXT,
    strategic_investment_weight     TEXT,
    strategic_item_type             TEXT,
    value_stream_identifier         TEXT,
    lidentifier_colour              TEXT,
    lidentifier_labels_json         TEXT,
    lidentifier_tags_json           TEXT,
    created_at                      TIMESTAMPTZ,
    updated_at                      TIMESTAMPTZ,
    archived_at                     TIMESTAMPTZ
);

-- Load the CSV (adjust path if needed)
-- \COPY portfolio_items_import FROM '/tmp/portfolio_items_export.csv' CSV HEADER;

-- ----------------------------------------------------------------
-- Resolve the Portfolio Item artefact_type_id for each subscription.
-- Uses the name 'Portfolio Item' seeded by 027_seed_portfolio_item_type.sql.
-- ----------------------------------------------------------------
CREATE TEMP TABLE pi_type_map AS
SELECT DISTINCT ON (pii.subscription_id)
    pii.subscription_id,
    at.id AS artefact_type_id
FROM portfolio_items_import pii
JOIN artefact_types at
    ON  at.subscription_id = pii.subscription_id
    AND at.name = 'Portfolio Item'
    AND at.archived_at IS NULL;

-- ----------------------------------------------------------------
-- Resolve workspace_id for each subscription.
-- Falls back to the first workspace found for the subscription.
-- vector_artefacts does not own workspaces (soft FK to mmff_vector),
-- so we reuse the subscription_id as a sentinel workspace_id when no
-- mapping table exists. Adjust this query if a workspace_map table
-- is introduced.
-- ----------------------------------------------------------------
-- NOTE: Replace the subquery below with the real workspace resolution
-- query if a cross-DB mapping table is available. For the PoC the
-- workspace_id is set equal to the subscription_id as a placeholder.
CREATE TEMP TABLE pi_workspace_map AS
SELECT DISTINCT
    subscription_id,
    subscription_id AS workspace_id  -- placeholder; replace with real lookup
FROM portfolio_items_import;

-- ----------------------------------------------------------------
-- Resolve flow_state_id in vector_artefacts.
-- Matches on (artefact_type_id, flow_state_name) via the flows / flow_states
-- tables. NULL if no match (artefacts.flow_state_id is nullable).
-- ----------------------------------------------------------------
CREATE TEMP TABLE pi_flow_state_map AS
SELECT DISTINCT ON (pii.id)
    pii.id AS portfolio_item_id,
    fs.id  AS flow_state_id_va
FROM portfolio_items_import pii
JOIN pi_type_map ptm ON ptm.subscription_id = pii.subscription_id
JOIN flows f
    ON  f.artefact_type_id = ptm.artefact_type_id
    AND f.is_default = TRUE
    AND f.archived_at IS NULL
JOIN flow_states fs
    ON  fs.flow_id = f.id
    AND lower(fs.name) = lower(pii.flow_state_name)
WHERE pii.flow_state_id IS NOT NULL;

-- ----------------------------------------------------------------
-- Insert into artefacts
-- ----------------------------------------------------------------
INSERT INTO artefacts (
    id,
    subscription_id,
    workspace_id,
    artefact_type_id,
    number,
    title,
    description,
    parent_artefact_id,
    flow_state_id,
    created_by_user_id,
    owned_by_user_id,
    position,
    created_at,
    updated_at,
    archived_at
)
SELECT
    pii.id,
    pii.subscription_id,
    pwm.workspace_id,
    ptm.artefact_type_id,
    pii.key_num,
    pii.name,
    pii.description,
    pii.hierarchy_parent,
    pfsm.flow_state_id_va,
    pii.name_author,
    pii.name_owner,
    pii.key_num::integer,   -- use key_num as initial position (stable sort)
    pii.created_at,
    pii.updated_at,
    pii.archived_at
FROM portfolio_items_import pii
JOIN pi_type_map      ptm  ON ptm.subscription_id  = pii.subscription_id
JOIN pi_workspace_map pwm  ON pwm.subscription_id  = pii.subscription_id
LEFT JOIN pi_flow_state_map pfsm ON pfsm.portfolio_item_id = pii.id
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------
-- Insert field values — one INSERT per field to keep conflict targets clear.
-- Each uses ON CONFLICT (artefact_id, field_library_id) DO NOTHING.
-- ----------------------------------------------------------------

-- acceptance_criteria (richtext → text_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, text_value)
SELECT
    pii.id,
    fl.id,
    pii.acceptance_criteria
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_acceptance_criteria'
    AND fl.archived_at IS NULL
WHERE pii.acceptance_criteria IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- notes (richtext → text_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, text_value)
SELECT
    pii.id,
    fl.id,
    pii.notes
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_notes'
    AND fl.archived_at IS NULL
WHERE pii.notes IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- flow_state_change_update_date (textbox → string_value, ISO 8601)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.flow_state_change_update_date::text
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_flow_state_change_date'
    AND fl.archived_at IS NULL
WHERE pii.flow_state_change_update_date IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- flow_state_change_owner (user → string_value, UUID)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.flow_state_change_owner::text
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_flow_state_change_owner'
    AND fl.archived_at IS NULL
WHERE pii.flow_state_change_owner IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- blocked (boolean → boolean_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, boolean_value)
SELECT
    pii.id,
    fl.id,
    pii.blocked
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_blocked'
    AND fl.archived_at IS NULL
WHERE pii.blocked IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- blocked_reason (textbox → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.blocked_reason
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_blocked_reason'
    AND fl.archived_at IS NULL
WHERE pii.blocked_reason IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- date_work_planned_start (date → date_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, date_value)
SELECT
    pii.id,
    fl.id,
    pii.date_work_planned_start
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_date_work_planned_start'
    AND fl.archived_at IS NULL
WHERE pii.date_work_planned_start IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- date_work_planned_finish (date → date_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, date_value)
SELECT
    pii.id,
    fl.id,
    pii.date_work_planned_finish
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_date_work_planned_finish'
    AND fl.archived_at IS NULL
WHERE pii.date_work_planned_finish IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- date_work_started (date → date_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, date_value)
SELECT
    pii.id,
    fl.id,
    pii.date_work_started
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_date_work_started'
    AND fl.archived_at IS NULL
WHERE pii.date_work_started IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- date_work_accepted (date → date_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, date_value)
SELECT
    pii.id,
    fl.id,
    pii.date_work_accepted
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_date_work_accepted'
    AND fl.archived_at IS NULL
WHERE pii.date_work_accepted IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- estimate_initial (textbox → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.estimate_initial
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_estimate_initial'
    AND fl.archived_at IS NULL
WHERE pii.estimate_initial IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- estimate_updated (decimal → number_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, number_value)
SELECT
    pii.id,
    fl.id,
    pii.estimate_updated
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_estimate_updated'
    AND fl.archived_at IS NULL
WHERE pii.estimate_updated IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- risk_impact (select → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.risk_impact
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_risk_impact'
    AND fl.archived_at IS NULL
WHERE pii.risk_impact IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- risk_probability (select → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.risk_probability
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_risk_probability'
    AND fl.archived_at IS NULL
WHERE pii.risk_probability IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- risk_score (decimal → number_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, number_value)
SELECT
    pii.id,
    fl.id,
    pii.risk_score
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_risk_score'
    AND fl.archived_at IS NULL
WHERE pii.risk_score IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- strategic_investment_group (textbox → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.strategic_investment_group
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_strategic_investment_group'
    AND fl.archived_at IS NULL
WHERE pii.strategic_investment_group IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- strategic_investment_weight (textbox → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.strategic_investment_weight
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_strategic_investment_weight'
    AND fl.archived_at IS NULL
WHERE pii.strategic_investment_weight IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- strategic_item_type (textbox → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.strategic_item_type
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_strategic_item_type'
    AND fl.archived_at IS NULL
WHERE pii.strategic_item_type IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- value_stream_identifier (textbox → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.value_stream_identifier
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_value_stream_identifier'
    AND fl.archived_at IS NULL
WHERE pii.value_stream_identifier IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- lidentifier_colour (textbox → string_value)
INSERT INTO artefact_field_values (artefact_id, field_library_id, string_value)
SELECT
    pii.id,
    fl.id,
    pii.lidentifier_colour
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_lidentifier_colour'
    AND fl.archived_at IS NULL
WHERE pii.lidentifier_colour IS NOT NULL
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- lidentifier_labels (multiselect → text_value, JSON array string from export)
INSERT INTO artefact_field_values (artefact_id, field_library_id, text_value)
SELECT
    pii.id,
    fl.id,
    pii.lidentifier_labels_json
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_lidentifier_labels'
    AND fl.archived_at IS NULL
WHERE pii.lidentifier_labels_json IS NOT NULL
  AND pii.lidentifier_labels_json <> '[]'
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- lidentifier_tags (multiselect → text_value, JSON array string from export)
INSERT INTO artefact_field_values (artefact_id, field_library_id, text_value)
SELECT
    pii.id,
    fl.id,
    pii.lidentifier_tags_json
FROM portfolio_items_import pii
JOIN artefact_field_library fl
    ON  fl.subscription_id = pii.subscription_id
    AND fl.field_name = 'pi_lidentifier_tags'
    AND fl.archived_at IS NULL
WHERE pii.lidentifier_tags_json IS NOT NULL
  AND pii.lidentifier_tags_json <> '[]'
  AND EXISTS (SELECT 1 FROM artefacts a WHERE a.id = pii.id)
ON CONFLICT (artefact_id, field_library_id) DO NOTHING;

-- ----------------------------------------------------------------
-- Verification counts
-- ----------------------------------------------------------------
SELECT
    'portfolio items imported (artefacts)'          AS label,
    COUNT(*)                                         AS count
FROM artefacts a
JOIN artefact_types at ON at.id = a.artefact_type_id
WHERE at.name = 'Portfolio Item'
UNION ALL
SELECT
    'portfolio items in staging',
    COUNT(*)
FROM portfolio_items_import
UNION ALL
SELECT
    'field value rows inserted',
    COUNT(*)
FROM artefact_field_values afv
JOIN artefacts a ON a.id = afv.artefact_id
JOIN artefact_types at ON at.id = a.artefact_type_id
WHERE at.name = 'Portfolio Item';

COMMIT;
