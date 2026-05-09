-- ============================================================
-- MMFFDev - vector_artefacts: M4.2.1 + M4.2.2
-- Seed artefact_types row for "User Story" and seed
-- artefact_field_library entries for user-story-specific fields.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 034_seed_user_story_type.sql
--
-- PLA-0031 / M4.2.1 + M4.2.2
--
-- This migration is idempotent:
--   - artefact_types insert uses WHERE NOT EXISTS (the partial unique index
--     on subscription_id, scope, prefix for live rows cannot be named in
--     ON CONFLICT for per-subscription conditional inserts).
--   - artefact_field_library inserts use ON CONFLICT DO NOTHING (unique index
--     on subscription_id, field_name for live rows).
--
-- The PoC subscription UUID is:
--   00000000-0000-0000-0000-000000000001
--
-- "User Story" is a 'work'-scope, 'system'-source type with prefix 'US'
-- and sort_order 10 (same as the seed_system_artefact_types function).
-- This migration adds the type for the ETL import path; on fresh installs
-- seed_system_artefact_types() already creates this row, so the WHERE NOT
-- EXISTS guard protects against double-insert on those instances.
-- ============================================================

BEGIN;

-- ============================================================
-- M4.2.1 — artefact_types row for "User Story"
-- ============================================================
-- The user-story type already exists for every subscription seeded via
-- seed_system_artefact_types() (010_seed_system_artefact_types.sql).
-- This insert covers any subscription where the seed function was never run
-- (e.g. subscriptions created before the function existed or test tenants).

INSERT INTO artefact_types (
    subscription_id,
    scope,
    source,
    name,
    prefix,
    description,
    sort_order
)
SELECT
    s.subscription_id,
    'work',
    'system',
    'User Story',
    'US',
    'A discrete unit of user-visible functionality, written from the perspective of the end user.',
    10
FROM (
    -- All distinct subscription_ids already present in artefact_types.
    SELECT DISTINCT subscription_id FROM artefact_types
) s
WHERE NOT EXISTS (
    SELECT 1 FROM artefact_types
    WHERE subscription_id = s.subscription_id
      AND scope  = 'work'
      AND source = 'system'
      AND prefix = 'US'
      AND archived_at IS NULL
);

-- ============================================================
-- M4.2.2 — artefact_field_library entries for user-story-specific fields
-- ============================================================
-- Fields that have NO native equivalent in the artefacts table are defined
-- here as tenant-scoped field definitions for the PoC subscription.
--
-- Column mapping (full audit — M4.3.1):
--
--   user_stories column         → artefacts native / artefact_field_values
--   -------------------------------------------------------------------
--   id                          → artefacts.id                     (native)
--   subscription_id             → artefacts.subscription_id        (native)
--   key_num                     → artefacts.number                 (native)
--   type_id                     → artefacts.artefact_type_id       (native; resolved by prefix=US)
--   hierarchy_parent            → artefacts.parent_artefact_id     (native)
--   name                        → artefacts.title                  (native)
--   description                 → artefacts.description            (native)
--   name_author                 → artefacts.created_by_user_id     (native)
--   name_owner                  → artefacts.owned_by_user_id       (native)
--   rank                        → artefacts.position               (native; converted to row_number)
--   created_at                  → artefacts.created_at             (native)
--   updated_at                  → artefacts.updated_at             (native)
--   archived_at                 → artefacts.archived_at            (native)
--   -------------------------------------------------------------------
--   acceptance_criteria         → us_acceptance_criteria           (richtext  → text_value)
--   notes                       → us_notes                         (richtext  → text_value)
--   schedule_state              → us_schedule_state                (select    → string_value)
--   blocked                     → us_blocked                       (boolean   → boolean_value)
--   blocked_reason              → us_blocked_reason                (textbox   → string_value)
--   ready                       → us_ready                         (boolean   → boolean_value)
--   expedite                    → us_expedite                      (boolean   → boolean_value)
--   affects_doc                 → us_affects_doc                   (boolean   → boolean_value)
--   sprint                      → us_sprint_id                     (textbox   → string_value, UUID as text)
--   release                     → us_release_id                    (textbox   → string_value, UUID as text)
--   estimate_points             → us_estimate_points               (decimal   → number_value)
--   estimate_hours              → us_estimate_hours                (decimal   → number_value)
--   estimate_remaining          → us_estimate_remaining            (decimal   → number_value)
--   risk_score                  → us_risk_score                    (decimal   → number_value)
--   risk_impact                 → us_risk_impact                   (select    → string_value)
--   risk_probability            → us_risk_probability              (select    → string_value)
--   lidentifier_colour          → us_lidentifier_colour            (textbox   → string_value)
--   lidentifier_type            → us_lidentifier_type              (textbox   → string_value)
--   count_child_tasks           → us_count_child_tasks             (integer   → number_value)
--   count_child_defects         → us_count_child_defects           (integer   → number_value)
--   count_child_test_cases      → us_count_child_test_cases        (integer   → number_value)
--   test_case_status            → us_test_case_status              (textbox   → string_value)
--   defect_status               → us_defect_status                 (textbox   → string_value)
-- ============================================================

INSERT INTO artefact_field_library
    (subscription_id, scope, field_name, label, field_type, description)
VALUES
    -- Narrative / acceptance
    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_acceptance_criteria', 'Acceptance Criteria', 'richtext',
     'The conditions that must be met for this story to be accepted as done.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_notes', 'Notes', 'richtext',
     'Free-form notes attached to this user story.'),

    -- Workflow / schedule (options_json set via UPDATE below)
    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_schedule_state', 'Schedule State', 'select',
     'The scheduling phase of this story within the iteration.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_blocked', 'Blocked', 'boolean',
     'Whether this story is blocked from progressing.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_blocked_reason', 'Blocked Reason', 'textbox',
     'Explanation of why this story is blocked.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_ready', 'Ready', 'boolean',
     'Whether this story is ready to be pulled into a sprint.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_expedite', 'Expedite', 'boolean',
     'Whether this story should bypass normal queue ordering.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_affects_doc', 'Affects Documentation', 'boolean',
     'Whether this story requires documentation changes.'),

    -- Sprint / release linkage (stored as UUID strings)
    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_sprint_id', 'Sprint', 'textbox',
     'UUID of the sprint this story is assigned to.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_release_id', 'Release', 'textbox',
     'UUID of the release this story targets.'),

    -- Estimation
    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_estimate_points', 'Story Points', 'decimal',
     'Story-point estimate (Fibonacci or T-shirt converted to a number).'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_estimate_hours', 'Estimate (Hours)', 'decimal',
     'Estimated effort in hours.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_estimate_remaining', 'Remaining (Hours)', 'decimal',
     'Remaining effort in hours as of last update.'),

    -- Risk (options_json set via UPDATE below)
    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_risk_score', 'Risk Score', 'decimal',
     'Computed risk score (0.0–1.0 or project-specific range).'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_risk_impact', 'Risk Impact', 'select',
     'Categorical impact level if the story risk materialises.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_risk_probability', 'Risk Probability', 'select',
     'Categorical probability that the story risk materialises.'),

    -- Label identifier (visual tagging system)
    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_lidentifier_colour', 'Label Colour', 'textbox',
     'Hex colour code for the label identifier displayed on this story.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_lidentifier_type', 'Label Type', 'textbox',
     'Type slug for the label identifier displayed on this story.'),

    -- Rollup counts (denormalised from child records)
    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_count_child_tasks', 'Child Task Count', 'integer',
     'Denormalised count of child tasks linked to this story.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_count_child_defects', 'Child Defect Count', 'integer',
     'Denormalised count of child defects linked to this story.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_count_child_test_cases', 'Child Test Case Count', 'integer',
     'Denormalised count of child test cases linked to this story.'),

    -- Status rollups from children
    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_test_case_status', 'Test Case Status', 'textbox',
     'Rolled-up test case status label for this story.'),

    ('00000000-0000-0000-0000-000000000001', 'tenant',
     'us_defect_status', 'Defect Status', 'textbox',
     'Rolled-up defect status label for this story.')

ON CONFLICT DO NOTHING;

-- Apply options_json for select fields (schedule_state, risk_impact, risk_probability).
-- Done as separate UPDATEs so the INSERT above stays clean and idempotent.

UPDATE artefact_field_library
SET options_json = '["Defined","In-Progress","Completed","Accepted"]'::jsonb
WHERE field_name = 'us_schedule_state'
  AND subscription_id = '00000000-0000-0000-0000-000000000001'
  AND archived_at IS NULL;

UPDATE artefact_field_library
SET options_json = '["Low","Medium","High","Critical"]'::jsonb
WHERE field_name = 'us_risk_impact'
  AND subscription_id = '00000000-0000-0000-0000-000000000001'
  AND archived_at IS NULL;

UPDATE artefact_field_library
SET options_json = '["Low","Medium","High"]'::jsonb
WHERE field_name = 'us_risk_probability'
  AND subscription_id = '00000000-0000-0000-0000-000000000001'
  AND archived_at IS NULL;

COMMIT;
