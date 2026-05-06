-- ============================================================
-- MMFFDev - vector_artefacts: artefact_type_fields
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 007_artefact_type_fields.sql
--
-- The binding table between artefact_types and field_library:
--   "Show field X on every artefact of type Y, in position Z, required=true."
--
-- Each row = one slot on one type's form. The same field_library row can be
-- bound to many types; binding-level state (required, position, default
-- value) lives here, not in field_library.
-- ============================================================

BEGIN;

CREATE TABLE artefact_type_fields (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    artefact_type_id    UUID NOT NULL REFERENCES artefact_types(id) ON DELETE CASCADE,
    field_library_id    UUID NOT NULL REFERENCES field_library(id) ON DELETE RESTRICT,

    -- Display order within the type's form.
    position            INTEGER NOT NULL DEFAULT 100,

    -- Per-binding state.
    required            BOOLEAN NOT NULL DEFAULT FALSE,
    -- Default value (string-encoded; app interprets per the field's type).
    default_value       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A field appears at most once on a given type.
CREATE UNIQUE INDEX artefact_type_fields_unique_binding
    ON artefact_type_fields (artefact_type_id, field_library_id);

-- Form render order.
CREATE INDEX artefact_type_fields_by_type_position
    ON artefact_type_fields (artefact_type_id, position);

-- Reverse lookup: "which types use this field?" (e.g. when archiving a
-- field_library entry the app must check there are no live bindings).
CREATE INDEX artefact_type_fields_by_field
    ON artefact_type_fields (field_library_id);

CREATE TRIGGER artefact_type_fields_set_updated_at
    BEFORE UPDATE ON artefact_type_fields
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE artefact_type_fields IS
    'Bindings between artefact types and field_library entries. Each row '
    'attaches a field to a type''s form, with per-binding required flag, '
    'position, and default value.';

COMMIT;
