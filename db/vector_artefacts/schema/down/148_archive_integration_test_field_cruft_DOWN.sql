-- ============================================================
-- 148_archive_integration_test_field_cruft_DOWN.sql
--
-- Reverses 148 — un-archives the test_field_% / test_typechange_%
-- rows in artefacts_fields_library.
--
-- NOTE: this is mostly here for symmetry. The test cruft has no
-- legitimate downstream use; re-activating it is not a sensible
-- operational action. Only invoke during a deliberate full-stack
-- rollback of the demotion workstream.
-- ============================================================

BEGIN;

UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = NULL,
       artefacts_fields_library_updated_at  = now()
 WHERE (artefacts_fields_library_field_name LIKE 'test_field_%'
        OR artefacts_fields_library_field_name LIKE 'test_typechange_%');

COMMIT;
