-- ============================================================
-- 153_artefacts_rally_submitted_by_fk_DOWN.sql
--
-- Reverses 153 — drops the partial index, the FK, and the column.
-- ============================================================

BEGIN;
DROP INDEX IF EXISTS idx_artefacts_id_user_submitted_by;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_id_user_submitted_by_fk;
ALTER TABLE artefacts DROP COLUMN IF EXISTS artefacts_id_user_submitted_by;
COMMIT;
