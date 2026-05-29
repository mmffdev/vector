-- ============================================================
-- 151_artefacts_rally_defect_columns.sql
--
-- Rally screenshots batch — Defect-only new columns on artefacts.
-- Column-level CHECK on the two enum-shaped columns
-- (defect_resolution + defect_test_case_status). Slot gate to
-- wrk_defect enforced by mig 158's trigger function.
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.2
--
-- Booleans default to false so existing rows stay valid; the
-- trigger only fires when the value is set to TRUE.
--
-- ROLLBACK: db/vector_artefacts/schema/down/151_artefacts_rally_defect_columns_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_defect_resolution               text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_test_case_status         text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_fixed_in_build           text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_found_in_build           text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_is_release_note          boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS artefacts_defect_steps_to_reproduce       text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_steps_to_reproduce_doc   jsonb,
    ADD COLUMN IF NOT EXISTS artefacts_defect_is_regression            boolean NOT NULL DEFAULT false;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_defect_resolution_chk
        CHECK (artefacts_defect_resolution IS NULL
            OR artefacts_defect_resolution = ANY (ARRAY[
                'fixed','wontfix','duplicate','not_a_defect','cannot_reproduce','by_design'
            ]));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_defect_test_case_status_chk
        CHECK (artefacts_defect_test_case_status IS NULL
            OR artefacts_defect_test_case_status = ANY (ARRAY[
                'none','passed','failed','blocked','mixed'
            ]));

COMMIT;
