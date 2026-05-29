-- ============================================================
-- 146_demote_core_fields_archive_catalogue_DOWN.sql
--
-- Reverses 146 — un-archive the 23 catalogue rows demoted in the
-- core-field demotion pass. Resets archived_at to NULL only for
-- the named rows; leaves updated_at touched so the change is
-- traceable.
--
-- NOTE: if 147 has been applied + ColumnSpec wiring shipped, this
-- DOWN re-creates the duplicate "core column AND catalogue row"
-- situation 146 was built to remove. Reverse 147 first if you
-- intend a full rollback.
-- ============================================================

BEGIN;

UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = NULL,
       artefacts_fields_library_updated_at  = now()
 WHERE artefacts_fields_library_field_name IN (
     'blocked',
     'blocked_reason',
     'lidentifier_colour',
     'us_estimate_points',
     'pi_strategic_item_type',
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
     'acceptance_criteria2'
   );

COMMIT;
