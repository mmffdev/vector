-- ============================================================
-- 167_artefacts_types_fields_is_compulsory_DOWN.sql
-- Rollback for 167_artefacts_types_fields_is_compulsory.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
-- ============================================================

BEGIN;

ALTER TABLE artefacts_types_fields
  DROP COLUMN IF EXISTS artefacts_types_fields_is_compulsory;

COMMIT;
