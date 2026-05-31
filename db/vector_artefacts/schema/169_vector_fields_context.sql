-- ============================================================
-- 169_vector_fields_context.sql
-- Layer 2 of the 3-layer field model (Jira "context"): binds a library
-- field to an entity TYPE with per-binding rules. Polymorphic (artefact
-- /timebox) + full tenant/workspace scope. NULL entity_type = ALL types
-- of that kind (the universal-field answer; no per-type duplication).
-- WHY: docs/superpowers/specs/2026-05-31-vector-fields-3layer-design.md
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS.
-- ROLLBACK: schema/down/169_vector_fields_context_DOWN.sql
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS vector_fields_context (
  vector_fields_context_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vector_fields_context_id_field       uuid NOT NULL
    REFERENCES vector_fields_library (vector_fields_library_id) ON DELETE CASCADE,
  vector_fields_context_entity_kind    text NOT NULL,
  vector_fields_context_id_entity_type uuid,
  vector_fields_context_id_tenant      uuid NOT NULL,
  vector_fields_context_id_workspace   uuid,
  vector_fields_context_required       boolean NOT NULL DEFAULT false,
  vector_fields_context_is_compulsory  boolean NOT NULL DEFAULT false,
  vector_fields_context_position       integer NOT NULL DEFAULT 100,
  vector_fields_context_default_value  text,
  vector_fields_context_created_at     timestamptz NOT NULL DEFAULT now(),
  vector_fields_context_updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vector_fields_context_lookup
  ON vector_fields_context
     (vector_fields_context_id_tenant,
      vector_fields_context_entity_kind,
      vector_fields_context_id_entity_type);

CREATE INDEX IF NOT EXISTS idx_vector_fields_context_field
  ON vector_fields_context (vector_fields_context_id_field);

COMMENT ON TABLE vector_fields_context IS
  'Layer 2 (context/binding) of the 3-layer field model. Binds a vector_fields_library field to an entity type with per-binding rules (required=data-entry, is_compulsory=must-be-placed, position). entity_type NULL = all types of entity_kind. Replaces artefacts_types_fields. See spec 2026-05-31.';

COMMIT;
