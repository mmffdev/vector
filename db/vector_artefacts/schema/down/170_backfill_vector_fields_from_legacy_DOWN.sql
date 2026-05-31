-- 170_backfill_vector_fields_from_legacy_DOWN.sql — manual psql only.
-- Removes ONLY backfilled rows (created_by='Migrated' / entity_kind='artefact').
BEGIN;
DELETE FROM vector_fields_context WHERE vector_fields_context_entity_kind = 'artefact';
DELETE FROM vector_fields_library WHERE vector_fields_library_created_by = 'Migrated';
COMMIT;
