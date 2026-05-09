-- ============================================================
-- PLA-0033 / M5.2.1 + M5.2.2 — Seed Portfolio Item artefact type and
-- field_library entries for portfolio-item-specific columns.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 030_seed_portfolio_item_type.sql
--
-- Column map: obj_portfolio_items (mmff_vector) → vector_artefacts
-- ---------------------------------------------------------------
-- NATIVE artefacts columns (no field_library needed):
--   id                            → artefacts.id
--   subscription_id               → artefacts.subscription_id
--   key_num                       → artefacts.number
--   hierarchy_parent              → artefacts.parent_artefact_id
--   name                          → artefacts.title
--   description                   → artefacts.description
--   name_author                   → artefacts.created_by_user_id
--   name_owner                    → artefacts.owned_by_user_id
--   flow_state                    → artefacts.flow_state_id
--   created_at                    → artefacts.created_at
--   updated_at                    → artefacts.updated_at
--   archived_at                   → artefacts.archived_at
--
-- COMPUTED / ROLLUP columns — NOT migrated (derived at read time):
--   count_child_defects, count_child_user_stories, count_dependants,
--   count_rollup_defect, count_rollup_defects, count_rollup_estimation,
--   count_rollup_risks, done_by_story_count
--
-- type_id: the old mmff_vector portfolio_item_types.id is superseded by
-- artefacts.artefact_type_id pointing to this seed row. The mapping
-- is resolved during ETL by matching subscription_id.
--
-- FIELD_LIBRARY entries (portfolio-item-specific; field_name is the slug):
--   acceptance_criteria           → richtext  (pi_acceptance_criteria)
--   notes                         → richtext  (pi_notes)
--   flow_state_change_update_date → textbox   (pi_flow_state_change_date)
--   flow_state_change_owner       → user      (pi_flow_state_change_owner)
--   blocked                       → boolean   (pi_blocked)
--   blocked_reason                → textbox   (pi_blocked_reason)
--   date_work_planned_start       → date      (pi_date_work_planned_start)
--   date_work_planned_finish      → date      (pi_date_work_planned_finish)
--   date_work_started             → date      (pi_date_work_started)
--   date_work_accepted            → date      (pi_date_work_accepted)
--   estimate_initial              → textbox   (pi_estimate_initial)
--   estimate_updated              → decimal   (pi_estimate_updated)
--   risk_impact                   → select    (pi_risk_impact)
--   risk_probability              → select    (pi_risk_probability)
--   risk_score                    → decimal   (pi_risk_score)
--   strategic_investment_group    → textbox   (pi_strategic_investment_group)
--   strategic_investment_weight   → textbox   (pi_strategic_investment_weight)
--   strategic_item_type           → textbox   (pi_strategic_item_type)
--   value_stream_identifier       → textbox   (pi_value_stream_identifier)
--   lidentifier_colour            → textbox   (pi_lidentifier_colour)
--   lidentifier_labels            → multiselect (pi_lidentifier_labels)
--   lidentifier_tags              → multiselect (pi_lidentifier_tags)
--
-- Idempotent: uses ON CONFLICT DO NOTHING throughout.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- Step 1: Seed the artefact_types row for "Portfolio Item"
-- ----------------------------------------------------------------
-- Uses the PoC subscription UUID (00000000-0000-0000-0000-000000000001).
-- In production, this row is created per subscription by the provisioning
-- function. The ETL resolves artefact_type_id via subscription_id.
--
-- scope='work' so that portfolio items are served via /work-items (PLA-0033).
-- Although PI is logically a strategy-layer concept in mmff_vector, the
-- consolidation plan collapses it into the work-items surface. prefix='PI'
-- is safe: 'PI' is not used by any other seeded system type.

INSERT INTO artefact_types (
    subscription_id,
    workspace_id,
    scope,
    source,
    name,
    prefix,
    description,
    sort_order
)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid,
    w.id,
    'work',
    'system',
    'Portfolio Item',
    'PI',
    'A portfolio-level item tracking strategic work. Migrated from obj_portfolio_items (mmff_vector).',
    50
FROM (
    SELECT DISTINCT ON (subscription_id) id
    FROM fdw_workspaces
    WHERE subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
    ORDER BY subscription_id, id
) w
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------
-- Step 2: Seed field_library entries for portfolio-item-specific fields
-- ----------------------------------------------------------------
-- These fields have no native artefacts column equivalent.
-- All keyed under subscription 00000000-0000-0000-0000-000000000001.
-- In production, provisioning creates matching rows per subscription.

INSERT INTO artefact_field_library (subscription_id, scope, field_name, label, field_type, description)
VALUES
    -- Acceptance criteria (rich text)
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_acceptance_criteria', 'Acceptance Criteria', 'richtext',
     'Conditions that must be satisfied for the portfolio item to be accepted.'),

    -- Notes (rich text)
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_notes', 'Notes', 'richtext',
     'Free-form notes for the portfolio item.'),

    -- Flow state change tracking
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_flow_state_change_date', 'Flow State Change Date', 'textbox',
     'Timestamp when the flow state last changed (ISO 8601 string).'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_flow_state_change_owner', 'Flow State Change Owner', 'user',
     'User who last changed the flow state (UUID of user).'),

    -- Blocking
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_blocked', 'Blocked', 'boolean',
     'Whether this portfolio item is currently blocked.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_blocked_reason', 'Blocked Reason', 'textbox',
     'Explanation of why this portfolio item is blocked.'),

    -- Work dates
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_date_work_planned_start', 'Planned Start Date', 'date',
     'Date when work is planned to start.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_date_work_planned_finish', 'Planned Finish Date', 'date',
     'Date when work is planned to finish.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_date_work_started', 'Work Started Date', 'date',
     'Actual date when work started.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_date_work_accepted', 'Work Accepted Date', 'date',
     'Date when work was formally accepted.'),

    -- Estimation
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_estimate_initial', 'Initial Estimate', 'textbox',
     'Initial estimate (t-shirt size or story-points string).'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_estimate_updated', 'Updated Estimate', 'decimal',
     'Latest numeric estimate in points or hours.'),

    -- Risk
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_risk_impact', 'Risk Impact', 'select',
     'Risk impact rating for this portfolio item.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_risk_probability', 'Risk Probability', 'select',
     'Risk probability rating for this portfolio item.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_risk_score', 'Risk Score', 'decimal',
     'Computed risk score (impact × probability).'),

    -- Strategic fields
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_strategic_investment_group', 'Strategic Investment Group', 'textbox',
     'Strategic investment group this item belongs to.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_strategic_investment_weight', 'Strategic Investment Weight', 'textbox',
     'Weight or allocation within the strategic investment group.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_strategic_item_type', 'Strategic Item Type', 'textbox',
     'Classification of this item within the strategic taxonomy.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_value_stream_identifier', 'Value Stream Identifier', 'textbox',
     'Identifier linking this item to a value stream.'),

    -- Label identity fields
    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_lidentifier_colour', 'Label Colour', 'textbox',
     'Hex colour code for the label identifier.'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_lidentifier_labels', 'Labels', 'multiselect',
     'User-assigned label identifiers (stored as JSON array).'),

    ('00000000-0000-0000-0000-000000000001'::uuid, 'tenant',
     'pi_lidentifier_tags', 'Tags', 'multiselect',
     'User-assigned tags (stored as JSON array).')

ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------
-- Step 3: Bind all portfolio-item fields to the Portfolio Item type
-- ----------------------------------------------------------------
-- Resolves artefact_type_id and field_library_id by name/slug to stay
-- idempotent across re-runs regardless of UUID assignment.

INSERT INTO artefact_type_fields (artefact_type_id, field_library_id, position, required)
SELECT
    at.id AS artefact_type_id,
    fl.id AS field_library_id,
    row_number() OVER (ORDER BY fl.label) * 10 AS position,
    FALSE AS required
FROM artefact_types at
CROSS JOIN artefact_field_library fl
WHERE at.subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND at.name = 'Portfolio Item'
  AND at.archived_at IS NULL
  AND fl.subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND fl.field_name IN (
      'pi_acceptance_criteria',
      'pi_notes',
      'pi_flow_state_change_date',
      'pi_flow_state_change_owner',
      'pi_blocked',
      'pi_blocked_reason',
      'pi_date_work_planned_start',
      'pi_date_work_planned_finish',
      'pi_date_work_started',
      'pi_date_work_accepted',
      'pi_estimate_initial',
      'pi_estimate_updated',
      'pi_risk_impact',
      'pi_risk_probability',
      'pi_risk_score',
      'pi_strategic_investment_group',
      'pi_strategic_investment_weight',
      'pi_strategic_item_type',
      'pi_value_stream_identifier',
      'pi_lidentifier_colour',
      'pi_lidentifier_labels',
      'pi_lidentifier_tags'
  )
  AND fl.archived_at IS NULL
ON CONFLICT DO NOTHING;

-- Verification counts
SELECT
    'artefact_types (Portfolio Item)' AS label,
    COUNT(*) AS count
FROM artefact_types
WHERE name = 'Portfolio Item' AND archived_at IS NULL
UNION ALL
SELECT
    'field_library (pi_* fields)',
    COUNT(*)
FROM artefact_field_library
WHERE field_name LIKE 'pi_%' AND archived_at IS NULL
UNION ALL
SELECT
    'artefact_type_fields bindings',
    COUNT(*)
FROM artefact_type_fields atf
JOIN artefact_types at ON at.id = atf.artefact_type_id
WHERE at.name = 'Portfolio Item';

COMMIT;
