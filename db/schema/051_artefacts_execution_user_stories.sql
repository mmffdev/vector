-- ============================================================
-- MMFFDev - Vector: Execution artefacts — User Stories
-- Migration 051 — applied on top of 050_artefact_visibility.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 051_artefacts_execution_user_stories.sql
--
-- Four-table pattern per artefact type (R010 §3). Prefix: o_
-- o_artefacts_execution_user_stories                — core row
-- o_artefacts_execution_user_stories_template_forms — template definitions
-- o_artefacts_execution_user_stories_template_form_fields — fields per template
-- o_artefacts_execution_user_stories_field_values   — per-row dynamic field data
--
-- visibility_scope_id has no FK yet — scope entity designed in Phase 2.
-- ============================================================

BEGIN;

-- ---- 1. Template forms -----------------------------------------

CREATE TABLE o_artefacts_execution_user_stories_template_forms (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    name            TEXT        NOT NULL,
    description     TEXT,
    visibility      SMALLINT    NOT NULL DEFAULT 0 REFERENCES o_artefact_visibility_levels(level),
    visibility_scope_id UUID,
    created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT o_us_tf_name_nonempty CHECK (length(btrim(name)) > 0)
);

CREATE INDEX idx_o_us_tf_sub
    ON o_artefacts_execution_user_stories_template_forms (subscription_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_us_tf_updated_at
    BEFORE UPDATE ON o_artefacts_execution_user_stories_template_forms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- 2. Core artefact table ------------------------------------

CREATE TABLE o_artefacts_execution_user_stories (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    key_num             BIGINT      NOT NULL,
    title               TEXT        NOT NULL,
    description         TEXT,
    content             JSONB,
    content_plain_text  TEXT,
    template_form_id    UUID        REFERENCES o_artefacts_execution_user_stories_template_forms(id) ON DELETE SET NULL,
    owner_id            UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by          UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by          UUID        REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at         TIMESTAMPTZ,
    visibility          SMALLINT    NOT NULL DEFAULT 0 REFERENCES o_artefact_visibility_levels(level),
    visibility_scope_id UUID,
    search_index        TSVECTOR,

    CONSTRAINT o_us_key_num_positive CHECK (key_num > 0),
    CONSTRAINT o_us_title_nonempty   CHECK (length(btrim(title)) > 0),
    UNIQUE (subscription_id, key_num)
);

CREATE INDEX idx_o_us_sub_created
    ON o_artefacts_execution_user_stories (subscription_id, created_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_us_sub_owner
    ON o_artefacts_execution_user_stories (subscription_id, owner_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_us_search
    ON o_artefacts_execution_user_stories USING gin (search_index);

CREATE TRIGGER trg_o_us_updated_at
    BEFORE UPDATE ON o_artefacts_execution_user_stories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- 3. Template form fields ------------------------------------

CREATE TABLE o_artefacts_execution_user_stories_template_form_fields (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_form_id    UUID        NOT NULL REFERENCES o_artefacts_execution_user_stories_template_forms(id) ON DELETE CASCADE,
    field_name          TEXT        NOT NULL,
    field_label         TEXT        NOT NULL,
    field_type          TEXT        NOT NULL,
    required            BOOLEAN     NOT NULL DEFAULT FALSE,
    position            INTEGER     NOT NULL,
    default_visibility  SMALLINT    NOT NULL DEFAULT 0 REFERENCES o_artefact_visibility_levels(level),
    options_json        JSONB,
    config_json         JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT o_us_tff_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_us_tff_field_type_valid CHECK (
        field_type IN ('text','number','boolean','date','select','multiselect','jsonb','richtext')
    ),
    CONSTRAINT o_us_tff_position_nonneg CHECK (position >= 0),
    UNIQUE (template_form_id, field_name)
);

CREATE INDEX idx_o_us_tff_form
    ON o_artefacts_execution_user_stories_template_form_fields (template_form_id, position);

-- ---- 4. Field values -------------------------------------------

CREATE TABLE o_artefacts_execution_user_stories_field_values (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    artefact_id         UUID        NOT NULL REFERENCES o_artefacts_execution_user_stories(id) ON DELETE CASCADE,
    template_field_id   UUID        REFERENCES o_artefacts_execution_user_stories_template_form_fields(id) ON DELETE SET NULL,
    field_name          TEXT        NOT NULL,
    value_text          TEXT,
    value_number        NUMERIC(19,4),
    value_boolean       BOOLEAN,
    value_date          DATE,
    value_jsonb         JSONB,
    visibility          SMALLINT    NOT NULL DEFAULT 0 REFERENCES o_artefact_visibility_levels(level),
    visibility_scope_id UUID,
    source_artefact_id  UUID,
    created_by          UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT o_us_fv_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    UNIQUE (artefact_id, field_name)
);

CREATE INDEX idx_o_us_fv_artefact
    ON o_artefacts_execution_user_stories_field_values (artefact_id, field_name);

CREATE INDEX idx_o_us_fv_sub
    ON o_artefacts_execution_user_stories_field_values (subscription_id);

CREATE TRIGGER trg_o_us_fv_updated_at
    BEFORE UPDATE ON o_artefacts_execution_user_stories_field_values
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
