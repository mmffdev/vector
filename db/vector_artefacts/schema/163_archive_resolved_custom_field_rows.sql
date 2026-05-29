-- ============================================================
-- 163_archive_resolved_custom_field_rows.sql
--
-- Fourth-wave demotion follow-up — archives 19 catalogue rows in
-- artefacts_fields_library whose semantics are now provided by real
-- core columns on artefacts (added in migs 150-158 + the new mig 162).
--
-- 22 active rows pre-163. 3 remain active post-163:
--   - c_artefacts_acceptance_criteria         (legit custom — KEEP)
--   - c_artefacts_pi_flow_state_change_owner  (no core column yet — KEEP)
--   - c_artefacts_pi_strategic_investment_weight (intentionally kept
--     active even though mig 162 added artefacts_strategic_investment_weight,
--     because vocab is undefined — see TD-STRATEGIC-INVESTMENT-WEIGHT-VOCAB
--     in docs/c_tech_debt.md)
--
-- Archive policy: soft-archive only (UPDATE sets archived_at = NOW()).
-- No row deletion. No FK shuffling — artefacts_fields_values references
-- the FK on artefacts_fields_library_id (UUID), not on field_name, and
-- pre-flight inventory confirms ZERO values stored for any of these 19
-- rows (no bindings carry data — the catalogue rows were stubs).
--
-- ROLLBACK: db/vector_artefacts/schema/down/163_archive_resolved_custom_field_rows_DOWN.sql
-- ============================================================

BEGIN;

UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = NOW()
 WHERE artefacts_fields_library_archived_at IS NULL
   AND artefacts_fields_library_field_name IN (
     -- Redundant — now covered by core columns added in mig 150-158
     'c_artefacts_pi_lidentifier_labels',          -- → artefacts_tags
     'c_artefacts_pi_lidentifier_tags',            -- → artefacts_tags
     'c_artefacts_regression',                     -- → artefacts_defect_is_regression
     'c_artefacts_risk_impact',                    -- → artefacts_risk_impact
     'c_artefacts_risk_probability',               -- → artefacts_risk_probability
     'c_artefacts_risk_score',                     -- → artefacts_risk_calculated (GENERATED)
     'c_artefacts_steps_to_reproduce',             -- → artefacts_defect_steps_to_reproduce
     'c_artefacts_us_release_id',                  -- → artefacts_id_timebox_release
     'c_artefacts_us_sprint_id',                   -- → artefacts_id_timebox_sprint
     'c_artefacts_us_test_case_status',            -- → artefacts_defect_test_case_status
     -- Newly covered by mig 162
     'c_artefacts_browser',                        -- → artefacts_defect_browser
     'c_artefacts_pi_date_work_accepted',          -- → artefacts_work_accepted_date
     'c_artefacts_pi_value_stream_identifier',     -- → artefacts_strategic_value_stream_identifier
     -- Computed rollups — derive at query time, don't store
     'c_artefacts_us_count_child_defects',
     'c_artefacts_us_count_child_tasks',
     -- Rick: "not used, remove it"
     'c_artefacts_us_schedule_state',
     -- Not used / no core mapping
     'c_artefacts_lidentifier_type',
     -- Test cruft
     'c_artefacts_test_typechange_a52574a5',
     'c_artefacts_test_typechange_da93f080'
   );

-- Verify post-condition: archived count is 82 (was 63 + 19 from this mig)
-- and active count is 3 (acceptance_criteria + flow_state_change_owner +
-- pi_strategic_investment_weight).
DO $$
DECLARE
  v_active_count   INTEGER;
  v_archived_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_active_count
    FROM artefacts_fields_library
   WHERE artefacts_fields_library_archived_at IS NULL;
  SELECT COUNT(*) INTO v_archived_count
    FROM artefacts_fields_library
   WHERE artefacts_fields_library_archived_at IS NOT NULL;
  RAISE NOTICE 'mig 163: active=% archived=% (expect 3 / 82)',
    v_active_count, v_archived_count;
  IF v_active_count <> 3 THEN
    RAISE EXCEPTION 'mig 163: expected 3 active rows post-archive, got %', v_active_count;
  END IF;
END $$;

COMMIT;
