-- ============================================================
-- 084_artefacts_inline_form_columns_DOWN.sql
-- Rollback for 084_artefacts_inline_form_columns.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS artefacts_timebox_milestone;
DROP INDEX IF EXISTS artefacts_blocked;

ALTER TABLE artefacts DROP COLUMN IF EXISTS timebox_milestone_id;
ALTER TABLE artefacts DROP COLUMN IF EXISTS blocked_reason;
ALTER TABLE artefacts DROP COLUMN IF EXISTS is_blocked;

ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_colour_hex_format;
ALTER TABLE artefacts DROP COLUMN IF EXISTS colour;

COMMIT;
