-- ============================================================
-- 146_demote_core_fields_archive_catalogue.sql
--
-- Core-field demotion (Phase A) — archive (soft-delete) the
-- catalogue rows in artefacts_fields_library that are actually
-- CORE artefact fields drifted into the custom-field surface.
--
-- Design: docs/superpowers/specs/2026-05-29-core-field-demotion-design.md
--
-- THREE CLASSES OF ROW ARCHIVED (23 total):
--   * DEMOTE-EXISTING (5) — a matching core column already exists
--     on artefacts; the catalogue row is redundant.
--   * DEMOTE-NEW-COL (17) — a new core column is added by 147; the
--     catalogue row is being replaced by the column.
--   * DROP (1) — acceptance_criteria2 (textbox duplicate of the
--     richtext acceptance_criteria); not core, just dead.
--
-- WHY SOFT-DELETE: project pattern is archived_at = now() so the
-- row stays referenceable for audit + the partial unique index on
-- field_name only constrains live rows. Hard DELETE would also
-- collide with the RESTRICT FK from artefacts_fields_values + the
-- two RESTRICT FKs from artefacts_types_fields / workspaces_fields.
--
-- WHY NO VALUE BACKFILL: pre-flight values_count per row was zero
-- on every name in this list. Nothing to migrate to columns.
--
-- IDEMPOTENCY: WHERE archived_at IS NULL guards re-runs.
--
-- ROLLBACK: db/vector_artefacts/schema/down/146_demote_core_fields_archive_catalogue_DOWN.sql
-- ============================================================

BEGIN;

UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = now(),
       artefacts_fields_library_updated_at  = now()
 WHERE artefacts_fields_library_archived_at IS NULL
   AND artefacts_fields_library_field_name IN (
     -- DEMOTE-EXISTING (5) — matching column already on artefacts
     'blocked',
     'blocked_reason',
     'lidentifier_colour',
     'us_estimate_points',
     'pi_strategic_item_type',
     -- DEMOTE-NEW-COL (17) — replaced by columns added in 147
     'defect_severity',
     'environment',
     'estimate_hours',
     'estimate_remaining',
     'expedite',
     'notes',
     'pi_date_work_planned_finish',
     'pi_date_work_planned_start',
     'pi_date_work_started',
     'pi_estimate_initial',
     'pi_estimate_updated',
     'pi_flow_state_change_date',
     'pi_strategic_investment_group',
     'ready',
     'us_affects_doc',
     'us_count_child_test_cases',
     'us_defect_status',
     -- DROP (1) — textbox duplicate of the richtext acceptance_criteria
     'acceptance_criteria2'
   );

COMMIT;
