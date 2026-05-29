-- ============================================================
-- 160_custom_fields_c_prefix_rule2_DOWN.sql
--
-- Reverse mig 160:
--   1. Drop the CHECK constraint.
--   2. Strip the `c_artefacts_` prefix from every row.
--
-- See db/vector_artefacts/schema/160_custom_fields_c_prefix_rule2.sql
-- for context.
-- ============================================================

BEGIN;

ALTER TABLE artefacts_fields_library
  DROP CONSTRAINT IF EXISTS artefacts_fields_library_field_name_c_prefix_check;

UPDATE artefacts_fields_library
   SET artefacts_fields_library_field_name =
         REGEXP_REPLACE(artefacts_fields_library_field_name, '^c_artefacts_', '')
 WHERE artefacts_fields_library_field_name LIKE 'c\_artefacts\_%' ESCAPE '\';

COMMIT;
