-- ============================================================
-- MMFFDev - Vector: Artefact type registry — Phase 1 seed data
-- Migration 059 — applied on top of 058_search_index_outbox.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 059_artefact_type_registry_seed.sql
--
-- Seeds the five Phase 1 artefact types into o_artefact_type_registry.
-- scope_key is permanent — never change these values.
-- artefact_table reflects the o_ prefixed table names.
-- ============================================================

BEGIN;

INSERT INTO o_artefact_type_registry
    (scope_key, artefact_table, default_prefix, display_label, display_label_plural, description, phase)
VALUES
    (
        'execution_user_stories',
        'o_artefacts_execution_user_stories',
        'US',
        'User Story',
        'User Stories',
        'A unit of work expressed from the perspective of a user. Describes what a user wants to achieve and why.',
        'PH-0005'
    ),
    (
        'execution_defects',
        'o_artefacts_execution_defects',
        'DE',
        'Defect',
        'Defects',
        'A reported bug, regression, or quality issue. Tracks the problem, steps to reproduce, and resolution.',
        'PH-0005'
    ),
    (
        'execution_tasks',
        'o_artefacts_execution_tasks',
        'TA',
        'Task',
        'Tasks',
        'A discrete unit of technical or non-technical work. Typically owned by one person with a clear done state.',
        'PH-0005'
    ),
    (
        'execution_test_cases',
        'o_artefacts_execution_test_cases',
        'TC',
        'Test Case',
        'Test Cases',
        'A documented test scenario with steps and expected outcomes. Linked to user stories or defects.',
        'PH-0005'
    ),
    (
        'strategic',
        'o_artefacts_strategic',
        'PI',
        'Portfolio Item',
        'Portfolio Items',
        'A strategic planning artefact. Template forms express sub-types (Feature, Epic, Initiative, Theme).',
        'PH-0005'
    );

COMMIT;
