-- ============================================================
-- MMFFDev - vector_artefacts: artefact_field_values
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 008_artefact_field_values.sql
--
-- One row per (artefact, field) pair. Typed EAV: the value lives in exactly
-- ONE of the *_value columns based on the field's type.
--
-- Why typed EAV (5 columns) instead of a single TEXT 'value'?
--   - Range queries on numbers and dates work without casting tricks.
--   - The check constraint enforces "exactly one *_value populated", so
--     wrong-type writes are caught at the DB layer.
--   - Indexes on number_value / date_value support sort and filter on
--     custom fields (e.g. "stories with story_points > 5").
--
-- The pattern matches Jira's customfieldvalue table.
-- ============================================================

BEGIN;

CREATE TABLE artefact_field_values (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    artefact_id         UUID NOT NULL REFERENCES artefacts(id)     ON DELETE CASCADE,
    field_library_id    UUID NOT NULL REFERENCES field_library(id) ON DELETE RESTRICT,

    -- Typed value columns. Exactly ONE must be non-NULL (or all NULL when
    -- the artefact has been edited to clear the field; checked below).
    string_value        TEXT,
    text_value          TEXT,        -- richtext / multiselect-as-JSON
    number_value        NUMERIC,
    date_value          DATE,
    boolean_value       BOOLEAN,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- At most one *_value populated (zero is fine - means cleared).
    CONSTRAINT artefact_field_values_one_value
        CHECK (
            (CASE WHEN string_value  IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN text_value    IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN number_value  IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN date_value    IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN boolean_value IS NOT NULL THEN 1 ELSE 0 END) <= 1
        )
);

-- One value per (artefact, field). Upsert target.
CREATE UNIQUE INDEX artefact_field_values_unique
    ON artefact_field_values (artefact_id, field_library_id);

-- Filter / sort by custom number field (e.g. story_points).
CREATE INDEX artefact_field_values_by_field_number
    ON artefact_field_values (field_library_id, number_value)
    WHERE number_value IS NOT NULL;

-- Filter / sort by custom date field (e.g. target_release_date).
CREATE INDEX artefact_field_values_by_field_date
    ON artefact_field_values (field_library_id, date_value)
    WHERE date_value IS NOT NULL;

-- Equality match on string fields (select / radio / url).
CREATE INDEX artefact_field_values_by_field_string
    ON artefact_field_values (field_library_id, string_value)
    WHERE string_value IS NOT NULL;

CREATE TRIGGER artefact_field_values_set_updated_at
    BEFORE UPDATE ON artefact_field_values
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE artefact_field_values IS
    'Per-artefact custom-field values. Typed EAV: exactly one of '
    'string_value / text_value / number_value / date_value / boolean_value '
    'is populated, chosen by the field''s type.';

COMMIT;
