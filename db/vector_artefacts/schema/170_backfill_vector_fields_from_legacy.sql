-- ============================================================
-- 170_backfill_vector_fields_from_legacy.sql
-- Backfill the 3-layer tables from the legacy field tables. CUSTOM fields
-- only (core fields are seeded from columns.go later). Legacy tables remain
-- authoritative until consumers are repointed — this is additive shadow data.
-- The library id is reused AS the new library id so context FKs line up and
-- re-runs are no-ops.
-- WHY: docs/superpowers/specs/2026-05-31-vector-fields-3layer-design.md
-- IDEMPOTENCY: ON CONFLICT DO NOTHING (library) + NOT EXISTS guard (context).
-- ROLLBACK: schema/down/170_backfill_vector_fields_from_legacy_DOWN.sql
-- ============================================================
BEGIN;

INSERT INTO vector_fields_library (
  vector_fields_library_id, vector_fields_library_id_tenant,
  vector_fields_library_name, vector_fields_library_label,
  vector_fields_library_description, vector_fields_library_type,
  vector_fields_library_kind, vector_fields_library_created_by,
  vector_fields_library_options_json, vector_fields_library_archived_at)
SELECT DISTINCT ON (fl.artefacts_fields_library_id)
  fl.artefacts_fields_library_id,
  at.artefacts_types_id_subscription,
  fl.artefacts_fields_library_field_name,
  fl.artefacts_fields_library_label,
  COALESCE(fl.artefacts_fields_library_description,''),
  fl.artefacts_fields_library_field_type,
  'custom',
  'Migrated',
  fl.artefacts_fields_library_config_json,
  fl.artefacts_fields_library_archived_at
FROM artefacts_fields_library fl
JOIN artefacts_types_fields tf
  ON tf.artefacts_types_fields_id_field_library = fl.artefacts_fields_library_id
JOIN artefacts_types at
  ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
ON CONFLICT (vector_fields_library_id) DO NOTHING;

INSERT INTO vector_fields_context (
  vector_fields_context_id_field, vector_fields_context_entity_kind,
  vector_fields_context_id_entity_type, vector_fields_context_id_tenant,
  vector_fields_context_required, vector_fields_context_is_compulsory,
  vector_fields_context_position, vector_fields_context_default_value)
SELECT
  tf.artefacts_types_fields_id_field_library,
  'artefact',
  tf.artefacts_types_fields_id_artefact_type,
  at.artefacts_types_id_subscription,
  tf.artefacts_types_fields_required,
  tf.artefacts_types_fields_is_compulsory,
  tf.artefacts_types_fields_position,
  tf.artefacts_types_fields_default_value
FROM artefacts_types_fields tf
JOIN artefacts_types at
  ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
WHERE NOT EXISTS (
  SELECT 1 FROM vector_fields_context c
  WHERE c.vector_fields_context_id_field = tf.artefacts_types_fields_id_field_library
    AND c.vector_fields_context_id_entity_type = tf.artefacts_types_fields_id_artefact_type
    AND c.vector_fields_context_entity_kind = 'artefact'
);

COMMIT;
