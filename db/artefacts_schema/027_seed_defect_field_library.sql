-- ============================================================
-- MMFFDev - vector_artefacts: M3 — Defect field library seed
-- Migration 027 — applied on top of 026_timebox_releases.sql
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 027_seed_defect_field_library.sql
--
-- Context:
--   The Defect artefact_types row is already seeded for every subscription
--   by seed_system_artefact_types() (migration 010, prefix='DE', scope='work').
--   This migration seeds the field_library entries for defect-specific
--   attributes that have no native column on artefacts, and binds them to
--   the Defect type via artefact_type_fields.
--
-- Column map (mmff_vector.defects → vector_artefacts):
--
--   NATIVE artefacts columns (direct ETL copy):
--     defects.id                → artefacts.id
--     defects.subscription_id   → artefacts.subscription_id
--     defects.key_num           → artefacts.number
--     defects.name              → artefacts.title
--     defects.description       → artefacts.description
--     defects.name_author       → artefacts.created_by_user_id
--     defects.name_owner        → artefacts.assigned_to_user_id
--     defects.schedule_state    → artefacts.flow_state_id (matched by kind)
--     defects.created_at        → artefacts.created_at
--     defects.updated_at        → artefacts.updated_at
--     defects.archived_at       → artefacts.archived_at
--
--   WIRE COLUMNS added in migration 012 (direct ETL copy):
--     defects.sprint            → artefacts.sprint_id (timebox sprint UUID)
--
--   NATIVE column added in migration 026:
--     defects.release           → artefacts.timebox_release_id
--
--   DROPPED / DEFERRED (no equivalent yet or cross-DB FK):
--     defects.type_id           → replaced by artefact_type_id (Defect type)
--     defects.hierarchy_parent  → artefacts.parent_artefact_id (deferred:
--                                  parent artefacts may not exist yet)
--     defects.linked_story      → deferred (cross-type FK, no target in va yet)
--     defects.rank              → artefacts.position (rank TEXT → ordinal INT,
--                                  ETL derives position from sort order)
--     defects.flow_state_change_* → not represented in artefacts
--     defects.date_work_accepted  → not represented in artefacts
--
--   artefact_field_values (seeded by this migration + used by ETL):
--     defects.severity             → field: defect_severity   (select)
--     defects.acceptance_criteria  → field: acceptance_criteria (richtext)
--     defects.notes                → field: notes              (richtext)
--     defects.steps_to_reproduce   → field: steps_to_reproduce (richtext)
--     defects.environment          → field: environment        (textbox)
--     defects.browser              → field: browser            (textbox)
--     defects.regression           → field: regression         (boolean)
--     defects.blocked              → field: blocked            (boolean)
--     defects.blocked_reason       → field: blocked_reason     (textbox)
--     defects.ready                → field: ready              (boolean)
--     defects.expedite             → field: expedite           (boolean)
--     defects.estimate_hours       → field: estimate_hours     (decimal)
--     defects.estimate_remaining   → field: estimate_remaining (decimal)
--     defects.risk_score           → field: risk_score         (decimal)
--     defects.risk_impact          → field: risk_impact        (select)
--     defects.lidentifier_colour   → field: lidentifier_colour (textbox)
--     defects.lidentifier_type     → field: lidentifier_type   (textbox)
--
-- All seeds use scope='tenant' (per-subscription fields in the subscription
-- that owns the Defect type). The ETL script (dev/scripts/etl_defects.sql)
-- matches field_library_id by (subscription_id, field_name) at import time.
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING on both the field_library
-- unique index (subscription_id, field_name) and the type_fields unique
-- index (artefact_type_id, field_library_id).
-- ============================================================

BEGIN;

-- ─── Step 1: seed artefact_field_library entries for defect-specific fields ──
-- We seed against the PoC subscription (00000000-0000-0000-0000-000000000001).
-- The ETL script will join on (subscription_id, field_name) so each
-- subscription needs its own rows; for new subscriptions the app provisioning
-- flow should call this logic.

DO $$
DECLARE
    v_sub UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- defect_severity: select field, options: low / medium / high / critical
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, options_json, scope, description)
    VALUES (
        v_sub, 'defect_severity', 'Severity', 'select',
        '["low","medium","high","critical"]'::jsonb,
        'tenant',
        'Severity level of the defect (low / medium / high / critical).'
    )
    ON CONFLICT DO NOTHING;

    -- acceptance_criteria: richtext
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'acceptance_criteria', 'Acceptance Criteria', 'richtext',
        'tenant',
        'Conditions that must be met for the defect to be considered resolved.'
    )
    ON CONFLICT DO NOTHING;

    -- notes: richtext
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'notes', 'Notes', 'richtext',
        'tenant',
        'Free-form notes about the defect.'
    )
    ON CONFLICT DO NOTHING;

    -- steps_to_reproduce: richtext
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'steps_to_reproduce', 'Steps to Reproduce', 'richtext',
        'tenant',
        'Step-by-step instructions to reproduce the defect.'
    )
    ON CONFLICT DO NOTHING;

    -- environment: textbox
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'environment', 'Environment', 'textbox',
        'tenant',
        'The environment in which the defect was observed (e.g. Dev, Staging, Prod).'
    )
    ON CONFLICT DO NOTHING;

    -- browser: textbox
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'browser', 'Browser', 'textbox',
        'tenant',
        'Browser and version in which the defect was observed (e.g. Chrome 124).'
    )
    ON CONFLICT DO NOTHING;

    -- regression: boolean
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'regression', 'Regression', 'boolean',
        'tenant',
        'Whether this defect is a regression (broke previously-working functionality).'
    )
    ON CONFLICT DO NOTHING;

    -- blocked: boolean
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'blocked', 'Blocked', 'boolean',
        'tenant',
        'Whether work on this defect is currently blocked.'
    )
    ON CONFLICT DO NOTHING;

    -- blocked_reason: textbox
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'blocked_reason', 'Blocked Reason', 'textbox',
        'tenant',
        'Explanation of why the defect is blocked.'
    )
    ON CONFLICT DO NOTHING;

    -- ready: boolean
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'ready', 'Ready', 'boolean',
        'tenant',
        'Whether the defect is ready to be picked up.'
    )
    ON CONFLICT DO NOTHING;

    -- expedite: boolean
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'expedite', 'Expedite', 'boolean',
        'tenant',
        'Whether this defect should be expedited (bypass normal queue).'
    )
    ON CONFLICT DO NOTHING;

    -- estimate_hours: decimal
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'estimate_hours', 'Estimate (Hours)', 'decimal',
        'tenant',
        'Original effort estimate in hours.'
    )
    ON CONFLICT DO NOTHING;

    -- estimate_remaining: decimal
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'estimate_remaining', 'Remaining (Hours)', 'decimal',
        'tenant',
        'Remaining effort estimate in hours.'
    )
    ON CONFLICT DO NOTHING;

    -- risk_score: decimal
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'risk_score', 'Risk Score', 'decimal',
        'tenant',
        'Numeric risk score (0–100).'
    )
    ON CONFLICT DO NOTHING;

    -- risk_impact: select field, options: low / medium / high / critical
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, options_json, scope, description)
    VALUES (
        v_sub, 'risk_impact', 'Risk Impact', 'select',
        '["low","medium","high","critical"]'::jsonb,
        'tenant',
        'Severity of impact if the risk materialises.'
    )
    ON CONFLICT DO NOTHING;

    -- lidentifier_colour: textbox
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'lidentifier_colour', 'Label Colour', 'textbox',
        'tenant',
        'Hex colour code for the visual lane identifier label.'
    )
    ON CONFLICT DO NOTHING;

    -- lidentifier_type: textbox
    INSERT INTO artefact_field_library (subscription_id, field_name, label, field_type, scope, description)
    VALUES (
        v_sub, 'lidentifier_type', 'Label Type', 'textbox',
        'tenant',
        'Category / type label for the visual lane identifier.'
    )
    ON CONFLICT DO NOTHING;
END $$;

-- ─── Step 2: bind each field to the Defect artefact_type ─────────────────────
-- Uses ON CONFLICT DO NOTHING so repeated runs are safe.

DO $$
DECLARE
    v_sub     UUID := '00000000-0000-0000-0000-000000000001';
    v_type_id UUID;
BEGIN
    SELECT id INTO v_type_id
    FROM artefact_types
    WHERE subscription_id = v_sub
      AND scope  = 'work'
      AND source = 'system'
      AND prefix = 'DE'
      AND archived_at IS NULL
    LIMIT 1;

    IF v_type_id IS NULL THEN
        RAISE EXCEPTION 'Defect artefact_type not found for subscription %. '
                        'Run seed_system_artefact_types first.', v_sub;
    END IF;

    INSERT INTO artefact_type_fields (artefact_type_id, field_library_id, position, required)
    SELECT
        v_type_id,
        fl.id,
        row_number() OVER (ORDER BY fl.field_name) * 10,
        CASE fl.field_name WHEN 'defect_severity' THEN TRUE ELSE FALSE END
    FROM artefact_field_library fl
    WHERE fl.subscription_id = v_sub
      AND fl.field_name IN (
            'defect_severity', 'acceptance_criteria', 'notes',
            'steps_to_reproduce', 'environment', 'browser',
            'regression', 'blocked', 'blocked_reason', 'ready', 'expedite',
            'estimate_hours', 'estimate_remaining',
            'risk_score', 'risk_impact',
            'lidentifier_colour', 'lidentifier_type'
          )
      AND fl.archived_at IS NULL
    ON CONFLICT DO NOTHING;
END $$;

COMMIT;
