-- ============================================================
-- 147_artefacts_core_fields_from_demotion_DOWN.sql
--
-- Reverses 147 — drops the two partial indexes, both CHECK
-- constraints, then all 18 new columns added to artefacts.
--
-- DESTRUCTIVE: dropping the columns loses any data written into
-- them. Only run this if either (a) the columns are still empty
-- (nothing has shipped that writes to them) or (b) the data has
-- already been exported / preserved elsewhere.
--
-- Order: indexes + constraints first (no objects depending on
-- the columns), then the columns themselves.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_artefacts_id_subscription_expedite;
DROP INDEX IF EXISTS idx_artefacts_id_subscription_ready;

ALTER TABLE artefacts
    DROP CONSTRAINT IF EXISTS artefacts_defect_severity_chk;
ALTER TABLE artefacts
    DROP CONSTRAINT IF EXISTS artefacts_defect_status_chk;

ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_defect_severity,
    DROP COLUMN IF EXISTS artefacts_environment,
    DROP COLUMN IF EXISTS artefacts_estimate_hours,
    DROP COLUMN IF EXISTS artefacts_estimate_remaining,
    DROP COLUMN IF EXISTS artefacts_is_expedite,
    DROP COLUMN IF EXISTS artefacts_notes,
    DROP COLUMN IF EXISTS artefacts_notes_doc,
    DROP COLUMN IF EXISTS artefacts_planned_finish_date,
    DROP COLUMN IF EXISTS artefacts_planned_start_date,
    DROP COLUMN IF EXISTS artefacts_actual_start_date,
    DROP COLUMN IF EXISTS artefacts_estimate_initial,
    DROP COLUMN IF EXISTS artefacts_estimate_updated,
    DROP COLUMN IF EXISTS artefacts_flow_state_changed_at,
    DROP COLUMN IF EXISTS artefacts_strategic_investment_group,
    DROP COLUMN IF EXISTS artefacts_is_ready,
    DROP COLUMN IF EXISTS artefacts_affects_doc,
    DROP COLUMN IF EXISTS artefacts_count_child_test_cases,
    DROP COLUMN IF EXISTS artefacts_defect_status;

COMMIT;
