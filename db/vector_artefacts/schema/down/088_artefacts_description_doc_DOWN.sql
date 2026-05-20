-- ============================================================
-- 088_artefacts_description_doc_DOWN.sql
-- Rollback for 088_artefacts_description_doc.sql
-- NOT auto-applied.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS artefacts_description_doc_gin;
ALTER TABLE artefacts DROP COLUMN IF EXISTS description_doc;

COMMIT;
