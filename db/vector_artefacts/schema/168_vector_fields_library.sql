-- ============================================================
-- 168_vector_fields_library.sql
-- Layer 1 of the 3-layer field model (Jira "customfield"): the field
-- DEFINITION, defined ONCE, Vector-wide (artefacts + timeboxes + future).
-- WHY: docs/superpowers/specs/2026-05-31-vector-fields-3layer-design.md
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS. Re-run is a no-op.
-- ROLLBACK: schema/down/168_vector_fields_library_DOWN.sql
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS vector_fields_library (
  vector_fields_library_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vector_fields_library_id_tenant    uuid,
  vector_fields_library_id_workspace uuid,
  vector_fields_library_name         text NOT NULL,
  vector_fields_library_label        text NOT NULL DEFAULT '',
  vector_fields_library_description  text NOT NULL DEFAULT '',
  vector_fields_library_type         text NOT NULL,
  vector_fields_library_kind         text NOT NULL,
  vector_fields_library_created_by   text NOT NULL DEFAULT 'Core',
  vector_fields_library_options_json jsonb,
  vector_fields_library_created_at   timestamptz NOT NULL DEFAULT now(),
  vector_fields_library_updated_at   timestamptz NOT NULL DEFAULT now(),
  vector_fields_library_archived_at  timestamptz,
  CONSTRAINT vector_fields_library_kind_chk
    CHECK (vector_fields_library_kind IN ('core','custom'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vector_fields_library_tenant_name
  ON vector_fields_library (vector_fields_library_id_tenant, vector_fields_library_name)
  WHERE vector_fields_library_archived_at IS NULL;

COMMENT ON TABLE vector_fields_library IS
  'Layer 1 (definition) of the 3-layer field model. One row per field, Vector-wide. kind=core (Vector-shipped, value in typed artefacts column) or custom (tenant-made, value in vector_fields_values EAV). Binding to entity types lives in vector_fields_context. See spec 2026-05-31.';

COMMIT;
