-- ============================================================
-- 153_artefacts_rally_submitted_by_fk.sql
--
-- Rally screenshots batch — adds artefacts_id_user_submitted_by
-- UUID NULL with FK to users(users_id) ON DELETE SET NULL.
-- Per Decision F: submitter ≠ author in customer-success / triage
-- workflows. Slot gate (defect OR risk) enforced by mig 158.
--
-- Partial index narrowed on IS NOT NULL AND archived_at IS NULL —
-- supports "what did this user submit" queries.
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.4
--
-- ROLLBACK: db/vector_artefacts/schema/down/153_artefacts_rally_submitted_by_fk_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_id_user_submitted_by uuid;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_id_user_submitted_by_fk
        FOREIGN KEY (artefacts_id_user_submitted_by)
        REFERENCES users (users_id)
        ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_artefacts_id_user_submitted_by
    ON artefacts (artefacts_id_user_submitted_by)
    WHERE artefacts_id_user_submitted_by IS NOT NULL
      AND artefacts_archived_at IS NULL;

COMMIT;
