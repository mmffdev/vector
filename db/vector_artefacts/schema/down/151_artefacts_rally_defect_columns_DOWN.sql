-- ============================================================
-- 151_artefacts_rally_defect_columns_DOWN.sql
--
-- Reverses 151 — drops the two CHECK constraints and the 8
-- defect-* columns.
--
-- DESTRUCTIVE: dropping the columns loses any defect data written.
-- ============================================================

BEGIN;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_defect_resolution_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_defect_test_case_status_chk;
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_defect_resolution,
    DROP COLUMN IF EXISTS artefacts_defect_test_case_status,
    DROP COLUMN IF EXISTS artefacts_defect_fixed_in_build,
    DROP COLUMN IF EXISTS artefacts_defect_found_in_build,
    DROP COLUMN IF EXISTS artefacts_defect_is_release_note,
    DROP COLUMN IF EXISTS artefacts_defect_steps_to_reproduce,
    DROP COLUMN IF EXISTS artefacts_defect_steps_to_reproduce_doc,
    DROP COLUMN IF EXISTS artefacts_defect_is_regression;
COMMIT;
