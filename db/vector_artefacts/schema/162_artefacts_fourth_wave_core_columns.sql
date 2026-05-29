-- ============================================================
-- 162_artefacts_fourth_wave_core_columns.sql
--
-- Fourth-wave core-field demotion (2026-05-29). The Rally-screenshots
-- batch (migs 150-158) added 24 new core columns; mig 160 enforced
-- the `c_artefacts_` prefix on every catalogue row — but never
-- archived the catalogue rows whose semantics those core columns now
-- provide. Rick caught the duplication on a screenshot: 22 active
-- "custom" rows, 18 of them redundant duplicates of real core columns
-- (e.g. `c_artefacts_us_release_id` next to `artefacts_id_timebox_release`).
--
-- This migration adds the FOUR remaining core columns the audit
-- showed need a real first-class home. Mig 163 then archives the 19
-- redundant catalogue rows (the 18 duplicates + `lidentifier_type`
-- which has no mapping + 2 test-cruft rows + 1 explicit "not used").
--
-- COLUMNS ADDED (all idempotent ADD COLUMN IF NOT EXISTS):
--   1. artefacts_defect_browser TEXT — defect-only; gated to wrk_defect
--      via the slot trigger below. Replaces c_artefacts_browser.
--   2. artefacts_work_accepted_date DATE — universal; no gate. Replaces
--      c_artefacts_pi_date_work_accepted.
--   3. artefacts_strategic_value_stream_identifier TEXT — strategy-only;
--      gated to scope='strategy'. Replaces c_artefacts_pi_value_stream_identifier.
--   4. artefacts_strategic_investment_weight TEXT — strategy-only;
--      gated to scope='strategy'. NEW core column added per Rick's
--      decision (2026-05-29). The catalogue row
--      `c_artefacts_pi_strategic_investment_weight` is INTENTIONALLY
--      kept ACTIVE in mig 163 because the vocab + value-store
--      mechanism are NOT YET DEFINED. The column accepts ANY non-empty
--      TEXT for now; a CHECK constraint listing the locked vocab will
--      be added in a follow-up migration. See
--      TD-STRATEGIC-INVESTMENT-WEIGHT-VOCAB in docs/c_tech_debt.md.
--
-- COLUMN-NAMING HARD RULE: every column on artefacts is prefixed with
-- the full table name (artefacts_*). The four new columns comply. See
-- .claude/CLAUDE.md HARD RULE on column prefixing.
--
-- SLOT-GATE TRIGGER UPDATE: extends trg_artefacts_slot_gate_aiu_fn
-- (from mig 158) to gate the three NEW non-universal columns:
--   - artefacts_defect_browser → wrk_defect slot only
--   - artefacts_strategic_value_stream_identifier → strategy scope only
--   - artefacts_strategic_investment_weight → strategy scope only
-- artefacts_work_accepted_date is universal (no gate added).
--
-- The trigger function is CREATE OR REPLACE — every existing gate is
-- preserved verbatim; the new gates are appended into the right
-- DEFECT-ONLY / STRATEGY-ONLY blocks alongside their family-peers.
--
-- ROLLBACK: db/vector_artefacts/schema/down/162_artefacts_fourth_wave_core_columns_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_defect_browser                    text,
    ADD COLUMN IF NOT EXISTS artefacts_work_accepted_date                date,
    ADD COLUMN IF NOT EXISTS artefacts_strategic_value_stream_identifier text,
    ADD COLUMN IF NOT EXISTS artefacts_strategic_investment_weight       text;

-- artefacts_strategic_investment_weight is a dropdown enum per Rick's
-- decision (2026-05-29). Vocab is NOT YET DEFINED — Rick will lock it
-- in a later session along with the value-store mechanism. For now,
-- the column accepts ANY non-empty TEXT; a CHECK constraint will be
-- added in a follow-up migration once vocab is locked.
-- See TD-STRATEGIC-INVESTMENT-WEIGHT-VOCAB in docs/c_tech_debt.md.

-- ── Slot-gate trigger extension ───────────────────────────────────
-- CREATE OR REPLACE the full function body with the existing gates
-- preserved verbatim plus the three new gates appended into their
-- family blocks. Every IS DISTINCT FROM / IF block from mig 158
-- stays exactly as-is. The DOWN script reverts to the pre-162 body
-- via mig 158's body.

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
    --   Includes the eight mig-151 defect-* columns, Decision E's
    --   retroactive tightening of four mig-147 columns, AND the new
    --   mig-162 column:
    --     - artefacts_defect_browser (new in mig 162)
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
           OR NEW.artefacts_defect_browser            IS NOT NULL
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
    --   investment group + new mig-162 columns:
    --     - artefacts_strategic_value_stream_identifier (new in mig 162)
    --     - artefacts_strategic_investment_weight       (new in mig 162)
    --   Scope check, not slot check.
    --------------------------------------------------------------------
    IF v_scope IS DISTINCT FROM 'strategy' THEN
        IF NEW.artefacts_strategic_job_size                       IS NOT NULL
           OR NEW.artefacts_strategic_preliminary_estimate_value  IS NOT NULL
           OR NEW.artefacts_strategic_investment_group            IS NOT NULL
           OR NEW.artefacts_strategic_value_stream_identifier     IS NOT NULL
           OR NEW.artefacts_strategic_investment_weight           IS NOT NULL
        THEN
            RAISE EXCEPTION
                'strategy-only field set on non-strategy artefact (scope=%)', v_scope
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Trigger object itself is unchanged (still BEFORE INSERT OR UPDATE
-- on artefacts, FOR EACH ROW). No DROP/CREATE needed — replacing the
-- function body is enough since the trigger references it by name.

COMMIT;
