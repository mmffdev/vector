-- ============================================================
-- 163_archive_resolved_custom_field_rows_DOWN.sql
--
-- Reverses 163: un-archives the same 19 catalogue rows by setting
-- artefacts_fields_library_archived_at = NULL.
--
-- DOWN is non-destructive — the rows were never deleted, just soft-
-- archived in mig 163. Restoring them to active state recovers the
-- pre-163 22-active / 63-archived inventory.
-- ============================================================

BEGIN;

UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = NULL
 WHERE artefacts_fields_library_field_name IN (
     'c_artefacts_pi_lidentifier_labels',
     'c_artefacts_pi_lidentifier_tags',
     'c_artefacts_regression',
     'c_artefacts_risk_impact',
     'c_artefacts_risk_probability',
     'c_artefacts_risk_score',
     'c_artefacts_steps_to_reproduce',
     'c_artefacts_us_release_id',
     'c_artefacts_us_sprint_id',
     'c_artefacts_us_test_case_status',
     'c_artefacts_browser',
     'c_artefacts_pi_date_work_accepted',
     'c_artefacts_pi_value_stream_identifier',
     'c_artefacts_us_count_child_defects',
     'c_artefacts_us_count_child_tasks',
     'c_artefacts_us_schedule_state',
     'c_artefacts_lidentifier_type',
     'c_artefacts_test_typechange_a52574a5',
     'c_artefacts_test_typechange_da93f080'
   );

COMMIT;
