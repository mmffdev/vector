-- ============================================================
-- 162_artefacts_fourth_wave_core_columns_DOWN.sql
--
-- Reverses 162: drops the four new columns and restores the
-- pre-162 trigger function body (i.e. the mig-158 body).
--
-- The trigger function body restored here is taken verbatim from
-- db/vector_artefacts/schema/158_artefacts_slot_gate_trigger.sql.
-- ============================================================

BEGIN;

-- ── 1. Restore the pre-162 trigger function body (= mig-158 body) ──
CREATE OR REPLACE FUNCTION trg_artefacts_slot_gate_aiu_fn()
RETURNS trigger AS $$
DECLARE
    v_slot  text;
    v_scope text;
BEGIN
    SELECT artefacts_types_slot, artefacts_types_scope
      INTO v_slot, v_scope
      FROM artefacts_types
     WHERE artefacts_types_id = NEW.artefacts_id_artefact_type;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'artefact type not found (artefacts_id_artefact_type=%)',
            NEW.artefacts_id_artefact_type
            USING ERRCODE = '23502';
    END IF;

    IF v_slot IS DISTINCT FROM 'wrk_defect' THEN
        IF NEW.artefacts_defect_resolution            IS NOT NULL
           OR NEW.artefacts_defect_test_case_status   IS NOT NULL
           OR NEW.artefacts_defect_fixed_in_build     IS NOT NULL
           OR NEW.artefacts_defect_found_in_build     IS NOT NULL
           OR NEW.artefacts_defect_is_release_note    IS TRUE
           OR NEW.artefacts_defect_steps_to_reproduce IS NOT NULL
           OR NEW.artefacts_defect_steps_to_reproduce_doc IS NOT NULL
           OR NEW.artefacts_defect_is_regression      IS TRUE
           OR NEW.artefacts_environment               IS NOT NULL
           OR NEW.artefacts_defect_severity           IS NOT NULL
           OR NEW.artefacts_defect_status             IS NOT NULL
           OR NEW.artefacts_affects_doc               IS TRUE
        THEN
            RAISE EXCEPTION
                'defect-only field set on non-defect artefact (slot=%)', v_slot
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF v_slot IS DISTINCT FROM 'wrk_risk' THEN
        IF NEW.artefacts_risk_resolution        IS NOT NULL
           OR NEW.artefacts_risk_impact         IS NOT NULL
           OR NEW.artefacts_risk_impact_score   IS NOT NULL
           OR NEW.artefacts_risk_probability    IS NOT NULL
           OR NEW.artefacts_risk_probability_score IS NOT NULL
           OR NEW.artefacts_risk_response       IS NOT NULL
           OR NEW.artefacts_risk_exposure       IS NOT NULL
        THEN
            RAISE EXCEPTION
                'risk-only field set on non-risk artefact (slot=%)', v_slot
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF v_slot IS DISTINCT FROM 'wrk_task' THEN
        IF NEW.artefacts_estimate_hours     IS NOT NULL
           OR NEW.artefacts_estimate_remaining IS NOT NULL
        THEN
            RAISE EXCEPTION
                'task-only field set on non-task artefact (slot=%)', v_slot
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.artefacts_id_user_submitted_by IS NOT NULL
       AND v_slot NOT IN ('wrk_defect','wrk_risk')
    THEN
        RAISE EXCEPTION
            'submitted_by only allowed on defect or risk (slot=%)', v_slot
            USING ERRCODE = '23514';
    END IF;

    IF v_scope IS DISTINCT FROM 'strategy' THEN
        IF NEW.artefacts_strategic_job_size                    IS NOT NULL
           OR NEW.artefacts_strategic_preliminary_estimate_value IS NOT NULL
           OR NEW.artefacts_strategic_investment_group         IS NOT NULL
        THEN
            RAISE EXCEPTION
                'strategy-only field set on non-strategy artefact (scope=%)', v_scope
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ── 2. Drop the four new columns ──
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_defect_browser,
    DROP COLUMN IF EXISTS artefacts_work_accepted_date,
    DROP COLUMN IF EXISTS artefacts_strategic_value_stream_identifier,
    DROP COLUMN IF EXISTS artefacts_strategic_investment_weight;

COMMIT;
