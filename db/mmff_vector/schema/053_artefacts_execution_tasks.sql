-- ============================================================
-- MMFFDev - Vector: Execution artefacts — Tasks
-- Migration 053 — applied on top of 052_artefacts_execution_defects.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 053_artefacts_execution_tasks.sql
--
-- Same four-table pattern as 051–052. Prefix: o_  Tag prefix: TA.
-- ============================================================

BEGIN;

CREATE TABLE o_artefacts_execution_tasks_template_forms (
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

    CONSTRAINT o_ta_tf_name_nonempty CHECK (length(btrim(name)) > 0)
);

CREATE INDEX idx_o_ta_tf_sub
    ON o_artefacts_execution_tasks_template_forms (subscription_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_ta_tf_updated_at
    BEFORE UPDATE ON o_artefacts_execution_tasks_template_forms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE o_artefacts_execution_tasks (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    key_num             BIGINT      NOT NULL,
    title               TEXT        NOT NULL,
    description         TEXT,
    content             JSONB,
    content_plain_text  TEXT,
    template_form_id    UUID        REFERENCES o_artefacts_execution_tasks_template_forms(id) ON DELETE SET NULL,
    owner_id            UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by          UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by          UUID        REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at         TIMESTAMPTZ,
    visibility          SMALLINT    NOT NULL DEFAULT 0 REFERENCES o_artefact_visibility_levels(level),
    visibility_scope_id UUID,
    search_index        TSVECTOR,

    CONSTRAINT o_ta_key_num_positive CHECK (key_num > 0),
    CONSTRAINT o_ta_title_nonempty   CHECK (length(btrim(title)) > 0),
    UNIQUE (subscription_id, key_num)
);

CREATE INDEX idx_o_ta_sub_created
    ON o_artefacts_execution_tasks (subscription_id, created_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_ta_sub_owner
    ON o_artefacts_execution_tasks (subscription_id, owner_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_ta_search
    ON o_artefacts_execution_tasks USING gin (search_index);

CREATE TRIGGER trg_o_ta_updated_at
    BEFORE UPDATE ON o_artefacts_execution_tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE o_artefacts_execution_tasks_template_form_fields (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_form_id    UUID        NOT NULL REFERENCES o_artefacts_execution_tasks_template_forms(id) ON DELETE CASCADE,
    field_name          TEXT        NOT NULL,
    field_label         TEXT        NOT NULL,
    field_type          TEXT        NOT NULL,
    required            BOOLEAN     NOT NULL DEFAULT FALSE,
    position            INTEGER     NOT NULL,
    default_visibility  SMALLINT    NOT NULL DEFAULT 0 REFERENCES o_artefact_visibility_levels(level),
    options_json        JSONB,
    config_json         JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT o_ta_tff_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_ta_tff_field_type_valid CHECK (
        field_type IN ('text','number','boolean','date','select','multiselect','jsonb','richtext')
    ),
    CONSTRAINT o_ta_tff_position_nonneg CHECK (position >= 0),
    UNIQUE (template_form_id, field_name)
);

CREATE INDEX idx_o_ta_tff_form
    ON o_artefacts_execution_tasks_template_form_fields (template_form_id, position);

CREATE TABLE o_artefacts_execution_tasks_field_values (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    artefact_id         UUID        NOT NULL REFERENCES o_artefacts_execution_tasks(id) ON DELETE CASCADE,
    template_field_id   UUID        REFERENCES o_artefacts_execution_tasks_template_form_fields(id) ON DELETE SET NULL,
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

    CONSTRAINT o_ta_fv_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    UNIQUE (artefact_id, field_name)
);

CREATE INDEX idx_o_ta_fv_artefact
    ON o_artefacts_execution_tasks_field_values (artefact_id, field_name);

CREATE INDEX idx_o_ta_fv_sub
    ON o_artefacts_execution_tasks_field_values (subscription_id);

CREATE TRIGGER trg_o_ta_fv_updated_at
    BEFORE UPDATE ON o_artefacts_execution_tasks_field_values
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
