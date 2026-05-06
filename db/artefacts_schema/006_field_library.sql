-- ============================================================
-- MMFFDev - vector_artefacts: field_library
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 006_field_library.sql
--
-- Subscription-wide catalogue of custom field DEFINITIONS. A row here
-- describes "this is a field called Environment of type select with options
-- [Dev, Staging, Prod]". It does NOT bind the field to any artefact type -
-- that binding lives in artefact_type_fields (next migration).
--
-- This is the workspace-wide library; the same field definition can be
-- attached to multiple artefact types.
-- ============================================================

BEGIN;

CREATE TABLE field_library (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Soft FK -> mmff_vector.subscriptions(id). App enforced.
    subscription_id UUID NOT NULL,

    -- Slug used in API payloads (lower_snake_case). Stable identity.
    field_name      TEXT NOT NULL,
    -- Human label shown in the UI.
    label           TEXT NOT NULL,

    -- Storage / input type. Matches artefact_field_values *_value column choice.
    field_type      TEXT NOT NULL CHECK (field_type IN (
        'textbox',      -- string_value
        'richtext',     -- text_value
        'integer',      -- number_value (whole)
        'decimal',      -- number_value (fractional)
        'date',         -- date_value
        'boolean',      -- boolean_value
        'select',       -- string_value (one option)
        'multiselect',  -- text_value as JSON array
        'radio',        -- string_value (one option)
        'user',         -- string_value (UUID of user, app-enforced)
        'url'           -- string_value
    )),

    -- For select / multiselect / radio: JSON array of option labels (or
    -- objects {value, label}). NULL for other types.
    options_json    JSONB,

    -- Optional free-form config (placeholder text, regex, min/max for
    -- numerics, etc.) - reserved for future use.
    config_json     JSONB,

    -- Optional helper text shown beneath the input.
    description     TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);

-- Slug is unique within a subscription among live rows.
CREATE UNIQUE INDEX field_library_slug_unique_live
    ON field_library (subscription_id, field_name)
    WHERE archived_at IS NULL;

-- List view (settings page) - one fetch per subscription.
CREATE INDEX field_library_by_subscription
    ON field_library (subscription_id, label)
    WHERE archived_at IS NULL;

CREATE TRIGGER field_library_set_updated_at
    BEFORE UPDATE ON field_library
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  field_library IS
    'Subscription-wide catalogue of custom field DEFINITIONS. One row = one '
    'reusable field. Bindings to artefact types live in artefact_type_fields.';
COMMENT ON COLUMN field_library.field_name IS
    'Slug (lower_snake_case). Stable identity used in API payloads.';
COMMENT ON COLUMN field_library.field_type IS
    'Storage / input type. Determines which *_value column in '
    'artefact_field_values is populated.';

COMMIT;
