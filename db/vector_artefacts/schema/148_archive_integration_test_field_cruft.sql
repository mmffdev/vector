-- ============================================================
-- 148_archive_integration_test_field_cruft.sql
--
-- Purges integration-test cruft from artefacts_fields_library.
-- Every row whose field_name starts with `test_field_` or
-- `test_typechange_` is a zombie left behind by
-- backend/internal/fields/bindings_integration_test.go before its
-- t.Cleanup() helper was added.
--
-- Design: docs/superpowers/specs/2026-05-29-core-field-demotion-design.md §2.6
--
-- WHY ARCHIVE (not DELETE): same project pattern as 146 — soft-
-- delete preserves audit trail + sidesteps the three RESTRICT FKs
-- pointing at this table. Values are empty for these names, so no
-- cascade concern, but the rule is "no hard DELETE on the
-- catalogue" so we stick to it.
--
-- IDEMPOTENCY: WHERE archived_at IS NULL guards re-runs.
--
-- COMPANION FIX: the test helper itself needs t.Cleanup() to stop
-- this from re-accumulating. That lives in a separate code change
-- against bindings_integration_test.go — out of scope for this
-- schema migration but required to keep the table clean.
--
-- ROLLBACK: db/vector_artefacts/schema/down/148_archive_integration_test_field_cruft_DOWN.sql
-- ============================================================

BEGIN;

UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = now(),
       artefacts_fields_library_updated_at  = now()
 WHERE artefacts_fields_library_archived_at IS NULL
   AND (artefacts_fields_library_field_name LIKE 'test_field_%'
        OR artefacts_fields_library_field_name LIKE 'test_typechange_%');

COMMIT;
