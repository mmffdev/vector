-- ============================================================
-- 158_artefacts_slot_gate_trigger.sql
--
-- Rally screenshots batch — ONE composite BEFORE INSERT/UPDATE
-- trigger function on artefacts enforcing all per-slot /
-- per-scope gates added in this batch AND retroactively
-- tightening the six mig-147 columns per Decision E.
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.9
--
-- Postgres CHECK constraints cannot subquery another table; the
-- slot/scope value lives on artefacts_types. This trigger reads
-- slot + scope once per affected row, then raises EXCEPTION with
-- ERRCODE='23514' on any out-of-slot violation.
--
-- Naming convention: trg_<table>_<purpose>_<aiu>_fn where
-- aiu = AfterInsertUpdate / Before-InsertUpdate. This trigger
-- is BEFORE/INSERT/UPDATE → suffix aiu.
--
-- Families gated:
--   DEFECT (slot=wrk_defect):
--     - mig-151 columns: defect_resolution, defect_test_case_status,
--       defect_fixed_in_build, defect_found_in_build,
--       defect_is_release_note, defect_steps_to_reproduce,
--       defect_steps_to_reproduce_doc, defect_is_regression
--     - Decision E retroactive on mig-147:
--       environment, defect_severity, defect_status, affects_doc
--   RISK (slot=wrk_risk):
--     - mig-152 columns: risk_resolution, risk_impact,
--       risk_impact_score, risk_probability, risk_probability_score,
--       risk_response, risk_exposure
--     - risk_calculated is GENERATED — auto-NULL if inputs NULL,
--       self-gates via inputs
--   TASK (slot=wrk_task):
--     - Decision E retroactive on mig-147:
--       estimate_hours, estimate_remaining
--   DEFECT+RISK shared (slot IN (wrk_defect, wrk_risk)):
--     - mig-153: id_user_submitted_by
--   STRATEGY (scope=strategy):
--     - mig-154: strategic_job_size, strategic_preliminary_estimate_value
--     - Decision E retroactive on mig-147: strategic_investment_group
--
-- ROLLBACK: db/vector_artefacts/schema/down/158_artefacts_slot_gate_trigger_DOWN.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION trg_artefacts_slot_gate_aiu_fn()
RETURNS trigger AS $$
DECLARE
    v_slot  text;
    v_scope text;
BEGIN
    -- Look up the artefact's type slot + scope once.
    SELECT artefacts_types_slot, artefacts_types_scope
      INTO v_slot, v_scope
      FROM artefacts_types
     WHERE artefacts_types_id = NEW.artefacts_id_artefact_type;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'artefact type not found (artefacts_id_artefact_type=%)',
            NEW.artefacts_id_artefact_type
            USING ERRCODE = '23502';
    END IF;

    --------------------------------------------------------------------
    -- DEFECT-ONLY family
    --   Includes the eight mig-151 defect-* columns, AND Decision E's
    --   retroactive tightening of four mig-147 columns:
    --     - artefacts_environment
    --     - artefacts_defect_severity
    --     - artefacts_defect_status
    --     - artefacts_affects_doc (true only)
    --------------------------------------------------------------------
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

    --------------------------------------------------------------------
    -- RISK-ONLY family
    --   Mig-152 risk-* columns. The GENERATED column
    --   artefacts_risk_calculated is automatically NULL when either
    --   input is NULL, so it self-gates via inputs.
    --------------------------------------------------------------------
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

    --------------------------------------------------------------------
    -- TASK-ONLY family (Decision E retroactive)
    --   mig-147 columns: estimate_hours + estimate_remaining
    --------------------------------------------------------------------
    IF v_slot IS DISTINCT FROM 'wrk_task' THEN
        IF NEW.artefacts_estimate_hours     IS NOT NULL
           OR NEW.artefacts_estimate_remaining IS NOT NULL
        THEN
            RAISE EXCEPTION
                'task-only field set on non-task artefact (slot=%)', v_slot
                USING ERRCODE = '23514';
        END IF;
    END IF;

    --------------------------------------------------------------------
    -- DEFECT+RISK SHARED
    --   submitted_by (mig 153) — gated to defect OR risk
    --------------------------------------------------------------------
    IF NEW.artefacts_id_user_submitted_by IS NOT NULL
       AND v_slot NOT IN ('wrk_defect','wrk_risk')
    THEN
        RAISE EXCEPTION
            'submitted_by only allowed on defect or risk (slot=%)', v_slot
            USING ERRCODE = '23514';
    END IF;

    --------------------------------------------------------------------
    -- STRATEGY-ONLY family
    --   Mig-154 columns + retroactive tightening of mig-147 strategic
    --   investment group. Scope check, not slot check.
    --------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS trg_artefacts_slot_gate_aiu ON artefacts;
CREATE TRIGGER trg_artefacts_slot_gate_aiu
    BEFORE INSERT OR UPDATE ON artefacts
    FOR EACH ROW EXECUTE FUNCTION trg_artefacts_slot_gate_aiu_fn();

COMMIT;
