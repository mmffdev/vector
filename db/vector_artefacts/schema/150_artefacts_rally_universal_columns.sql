-- ============================================================
-- 150_artefacts_rally_universal_columns.sql
--
-- Rally screenshots batch (Phase A) — universal-scope new columns
-- on artefacts: actuals (numeric), tags (text[]), actual_end_date.
--
-- Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.1
--
-- No scope gate at the column level (these three are universal).
-- GIN partial index on artefacts_tags mirrors mig-147 partial-index
-- discipline — narrowed on (IS NOT NULL AND archived_at IS NULL).
-- CHECK on artefacts_actuals enforces non-negative.
--
-- COLUMN-NAMING HARD RULE: every column prefixed with the full
-- table name (artefacts_*). See .claude/CLAUDE.md.
--
-- ROLLBACK: db/vector_artefacts/schema/down/150_artefacts_rally_universal_columns_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_actuals          numeric,
    ADD COLUMN IF NOT EXISTS artefacts_tags             text[],
    ADD COLUMN IF NOT EXISTS artefacts_actual_end_date  date;

-- GIN partial index for tag membership queries; mirrors mig-147 partial-index discipline.
CREATE INDEX IF NOT EXISTS idx_artefacts_tags_gin
    ON artefacts USING gin (artefacts_tags)
    WHERE artefacts_tags IS NOT NULL
      AND artefacts_archived_at IS NULL;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_actuals_nonneg_chk
        CHECK (artefacts_actuals IS NULL OR artefacts_actuals >= 0);

COMMIT;
