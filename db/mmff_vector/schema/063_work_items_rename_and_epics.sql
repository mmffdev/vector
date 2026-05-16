-- ============================================================
-- MMFFDev - Vector: Work Items rename + Epics + parent hierarchy
-- Migration 063 — applied on top of 062_work_items_page.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 063_work_items_rename_and_epics.sql
--
-- Dev DB state: migrations 060/061 were not applied to dev, so the
-- four-table pattern (template_forms + template_form_fields) still exists.
-- This migration:
--   1. Applies the 060/061 pivot inline (drop template tables, create _schema,
--      reshape field_values) for user_stories only
--   2. Renames user_stories → work_items (core, schema, field_values)
--   3. Adds item_type discriminator (epic | story) + parent_id + root_feature_id
--      to o_artefacts_execution_work_items
--   4. Adds parent_id + root_feature_id to defects and tasks
--      (tasks get two nullable FKs: parent_work_item_id, parent_defect_id)
--   5. Creates o_artefacts_execution_epics + _schema + _field_values
--   6. Updates o_artefact_type_registry
-- ============================================================

BEGIN;

-- ============================================================
-- 1a. Drop the old four-table satellite tables for user_stories
-- ============================================================

DROP TABLE IF EXISTS o_artefacts_execution_user_stories_template_form_fields CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_user_stories_template_forms        CASCADE;

ALTER TABLE o_artefacts_execution_user_stories
    DROP COLUMN IF EXISTS template_form_id;

-- ============================================================
-- 1b. Reshape user_stories_field_values (060/061 inline)
-- ============================================================

ALTER TABLE o_artefacts_execution_user_stories_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_execution_user_stories_field_values
    ADD COLUMN IF NOT EXISTS string_value   TEXT,
    ADD COLUMN IF NOT EXISTS number_value   NUMERIC(19,4),
    ADD COLUMN IF NOT EXISTS text_value     TEXT,
    ADD COLUMN IF NOT EXISTS date_value     DATE;

-- ============================================================
-- 1c. Create user_stories_schema (060 inline)
-- ============================================================

CREATE TABLE IF NOT EXISTS o_artefacts_execution_user_stories_schema (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    field_name      TEXT        NOT NULL,
    label           TEXT        NOT NULL,
    type            TEXT        NOT NULL,
    required        BOOLEAN     NOT NULL DEFAULT FALSE,
    position        INTEGER     NOT NULL DEFAULT 0,
    default_value   TEXT,
    options_json    JSONB,
    config_json     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT o_us_schema_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_us_schema_label_nonempty      CHECK (length(btrim(label)) > 0),
    CONSTRAINT o_us_schema_type_valid CHECK (
        type IN ('textbox','richtext','integer','decimal','date','boolean',
                 'select','multiselect','radio','user','url')
    ),
    CONSTRAINT o_us_schema_position_nonneg CHECK (position >= 0),
    UNIQUE (subscription_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_o_us_schema_sub
    ON o_artefacts_execution_user_stories_schema (subscription_id, position)
    WHERE archived_at IS NULL;

CREATE OR REPLACE TRIGGER trg_o_us_schema_updated_at
    BEFORE UPDATE ON o_artefacts_execution_user_stories_schema
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Add schema_field_id FK to field_values now that schema table exists
ALTER TABLE o_artefacts_execution_user_stories_field_values
    ADD COLUMN IF NOT EXISTS schema_field_id UUID
        REFERENCES o_artefacts_execution_user_stories_schema(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_o_us_fv_schema_field
    ON o_artefacts_execution_user_stories_field_values (schema_field_id)
    WHERE schema_field_id IS NOT NULL;

-- ============================================================
-- 2. Rename user_stories → work_items
-- ============================================================

ALTER TABLE o_artefacts_execution_user_stories
    RENAME TO o_artefacts_execution_work_items;

ALTER TABLE o_artefacts_execution_user_stories_schema
    RENAME TO o_artefacts_execution_work_items_schema;

ALTER TABLE o_artefacts_execution_user_stories_field_values
    RENAME TO o_artefacts_execution_work_items_field_values;

-- Rename indexes
ALTER INDEX IF EXISTS idx_o_us_sub_created     RENAME TO idx_o_wi_sub_created;
ALTER INDEX IF EXISTS idx_o_us_sub_owner       RENAME TO idx_o_wi_sub_owner;
ALTER INDEX IF EXISTS idx_o_us_search          RENAME TO idx_o_wi_search;
ALTER INDEX IF EXISTS idx_o_us_schema_sub      RENAME TO idx_o_wi_schema_sub;
ALTER INDEX IF EXISTS idx_o_us_fv_artefact     RENAME TO idx_o_wi_fv_artefact;
ALTER INDEX IF EXISTS idx_o_us_fv_sub          RENAME TO idx_o_wi_fv_sub;
ALTER INDEX IF EXISTS idx_o_us_fv_schema_field RENAME TO idx_o_wi_fv_schema_field;

-- Rename triggers
ALTER TRIGGER trg_o_us_updated_at
    ON o_artefacts_execution_work_items
    RENAME TO trg_o_wi_updated_at;

ALTER TRIGGER trg_o_us_schema_updated_at
    ON o_artefacts_execution_work_items_schema
    RENAME TO trg_o_wi_schema_updated_at;

ALTER TRIGGER trg_o_us_fv_updated_at
    ON o_artefacts_execution_work_items_field_values
    RENAME TO trg_o_wi_fv_updated_at;

-- Rename constraints
ALTER TABLE o_artefacts_execution_work_items
    RENAME CONSTRAINT o_us_key_num_positive TO o_wi_key_num_positive;

ALTER TABLE o_artefacts_execution_work_items
    RENAME CONSTRAINT o_us_title_nonempty TO o_wi_title_nonempty;

ALTER TABLE o_artefacts_execution_work_items_schema
    RENAME CONSTRAINT o_us_schema_field_name_nonempty TO o_wi_schema_field_name_nonempty;

ALTER TABLE o_artefacts_execution_work_items_schema
    RENAME CONSTRAINT o_us_schema_label_nonempty TO o_wi_schema_label_nonempty;

ALTER TABLE o_artefacts_execution_work_items_schema
    RENAME CONSTRAINT o_us_schema_type_valid TO o_wi_schema_type_valid;

ALTER TABLE o_artefacts_execution_work_items_schema
    RENAME CONSTRAINT o_us_schema_position_nonneg TO o_wi_schema_position_nonneg;

ALTER TABLE o_artefacts_execution_work_items_field_values
    RENAME CONSTRAINT o_us_fv_field_name_nonempty TO o_wi_fv_field_name_nonempty;

-- ============================================================
-- 3. Add item_type + parent_id + root_feature_id to work_items
-- ============================================================

ALTER TABLE o_artefacts_execution_work_items
    ADD COLUMN item_type       TEXT NOT NULL DEFAULT 'story',
    ADD COLUMN parent_id       UUID REFERENCES o_artefacts_execution_work_items(id) ON DELETE SET NULL,
    ADD COLUMN root_feature_id UUID;

ALTER TABLE o_artefacts_execution_work_items
    ADD CONSTRAINT o_wi_item_type_valid
        CHECK (item_type IN ('epic', 'story'));

CREATE INDEX idx_o_wi_parent
    ON o_artefacts_execution_work_items (parent_id)
    WHERE parent_id IS NOT NULL;

CREATE INDEX idx_o_wi_root_feature
    ON o_artefacts_execution_work_items (root_feature_id)
    WHERE root_feature_id IS NOT NULL;

CREATE INDEX idx_o_wi_type
    ON o_artefacts_execution_work_items (subscription_id, item_type)
    WHERE archived_at IS NULL;

-- ============================================================
-- 4a. Add parent_id + root_feature_id to defects
-- ============================================================

ALTER TABLE o_artefacts_execution_defects
    ADD COLUMN parent_id       UUID REFERENCES o_artefacts_execution_work_items(id) ON DELETE SET NULL,
    ADD COLUMN root_feature_id UUID;

CREATE INDEX idx_o_de_parent
    ON o_artefacts_execution_defects (parent_id)
    WHERE parent_id IS NOT NULL;

CREATE INDEX idx_o_de_root_feature
    ON o_artefacts_execution_defects (root_feature_id)
    WHERE root_feature_id IS NOT NULL;

-- ============================================================
-- 4b. Add parent FKs + root_feature_id to tasks
--     XOR constraint: a task may have a work_item parent OR a
--     defect parent OR no parent — never both simultaneously.
-- ============================================================

ALTER TABLE o_artefacts_execution_tasks
    ADD COLUMN parent_work_item_id UUID REFERENCES o_artefacts_execution_work_items(id) ON DELETE SET NULL,
    ADD COLUMN parent_defect_id    UUID REFERENCES o_artefacts_execution_defects(id)    ON DELETE SET NULL,
    ADD COLUMN root_feature_id     UUID;

ALTER TABLE o_artefacts_execution_tasks
    ADD CONSTRAINT o_ta_parent_xor CHECK (
        NOT (parent_work_item_id IS NOT NULL AND parent_defect_id IS NOT NULL)
    );

CREATE INDEX idx_o_ta_parent_wi
    ON o_artefacts_execution_tasks (parent_work_item_id)
    WHERE parent_work_item_id IS NOT NULL;

CREATE INDEX idx_o_ta_parent_de
    ON o_artefacts_execution_tasks (parent_defect_id)
    WHERE parent_defect_id IS NOT NULL;

CREATE INDEX idx_o_ta_root_feature
    ON o_artefacts_execution_tasks (root_feature_id)
    WHERE root_feature_id IS NOT NULL;

-- ============================================================
-- 5. Create o_artefacts_execution_epics (core)
-- ============================================================

CREATE TABLE o_artefacts_execution_epics (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    key_num             BIGINT      NOT NULL,
    title               TEXT        NOT NULL,
    description         TEXT,
    content             JSONB,
    content_plain_text  TEXT,
    owner_id            UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by          UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by          UUID        REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at         TIMESTAMPTZ,
    visibility          SMALLINT    NOT NULL DEFAULT 0 REFERENCES o_artefact_visibility_levels(level),
    visibility_scope_id UUID,
    search_index        TSVECTOR,
    root_feature_id     UUID,

    CONSTRAINT o_ep_key_num_positive CHECK (key_num > 0),
    CONSTRAINT o_ep_title_nonempty   CHECK (length(btrim(title)) > 0),
    UNIQUE (subscription_id, key_num)
);

CREATE INDEX idx_o_ep_sub_created
    ON o_artefacts_execution_epics (subscription_id, created_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_ep_sub_owner
    ON o_artefacts_execution_epics (subscription_id, owner_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_ep_search
    ON o_artefacts_execution_epics USING gin (search_index);

CREATE INDEX idx_o_ep_root_feature
    ON o_artefacts_execution_epics (root_feature_id)
    WHERE root_feature_id IS NOT NULL;

CREATE TRIGGER trg_o_ep_updated_at
    BEFORE UPDATE ON o_artefacts_execution_epics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 6. Create o_artefacts_execution_epics_schema
-- ============================================================

CREATE TABLE o_artefacts_execution_epics_schema (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    field_name      TEXT        NOT NULL,
    label           TEXT        NOT NULL,
    type            TEXT        NOT NULL,
    required        BOOLEAN     NOT NULL DEFAULT FALSE,
    position        INTEGER     NOT NULL DEFAULT 0,
    default_value   TEXT,
    options_json    JSONB,
    config_json     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT o_ep_schema_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_ep_schema_label_nonempty      CHECK (length(btrim(label)) > 0),
    CONSTRAINT o_ep_schema_type_valid CHECK (
        type IN ('textbox','richtext','integer','decimal','date','boolean',
                 'select','multiselect','radio','user','url')
    ),
    CONSTRAINT o_ep_schema_position_nonneg CHECK (position >= 0),
    UNIQUE (subscription_id, field_name)
);

CREATE INDEX idx_o_ep_schema_sub
    ON o_artefacts_execution_epics_schema (subscription_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_ep_schema_updated_at
    BEFORE UPDATE ON o_artefacts_execution_epics_schema
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 7. Create o_artefacts_execution_epics_field_values
-- ============================================================

CREATE TABLE o_artefacts_execution_epics_field_values (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    artefact_id     UUID        NOT NULL REFERENCES o_artefacts_execution_epics(id) ON DELETE CASCADE,
    schema_field_id UUID        REFERENCES o_artefacts_execution_epics_schema(id) ON DELETE SET NULL,
    field_name      TEXT        NOT NULL,
    string_value    TEXT,
    number_value    NUMERIC(19,4),
    text_value      TEXT,
    date_value      DATE,
    visibility      SMALLINT    NOT NULL DEFAULT 0 REFERENCES o_artefact_visibility_levels(level),
    visibility_scope_id UUID,
    source_artefact_id  UUID,
    created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT o_ep_fv_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    UNIQUE (artefact_id, field_name)
);

CREATE INDEX idx_o_ep_fv_artefact
    ON o_artefacts_execution_epics_field_values (artefact_id, field_name);

CREATE INDEX idx_o_ep_fv_sub
    ON o_artefacts_execution_epics_field_values (subscription_id);

CREATE INDEX idx_o_ep_fv_schema_field
    ON o_artefacts_execution_epics_field_values (schema_field_id)
    WHERE schema_field_id IS NOT NULL;

CREATE TRIGGER trg_o_ep_fv_updated_at
    BEFORE UPDATE ON o_artefacts_execution_epics_field_values
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 8. Update o_artefact_type_registry
-- ============================================================

UPDATE o_artefact_type_registry
SET
    scope_key            = 'execution_work_items',
    artefact_table       = 'o_artefacts_execution_work_items',
    display_label        = 'Work Item',
    display_label_plural = 'Work Items',
    description          = 'An execution-layer work item: a user story or epic. Stories describe work from a user perspective; epics group related stories too large to fit a single iteration.'
WHERE scope_key = 'execution_user_stories';

INSERT INTO o_artefact_type_registry
    (scope_key, artefact_table, default_prefix, display_label, display_label_plural, description, phase)
VALUES
    (
        'execution_epics',
        'o_artefacts_execution_epics',
        'EP',
        'Epic',
        'Epics',
        'An execution-layer container for related user stories. Sits between a Feature and its child stories. Created directly or promoted from a story split.',
        'PH-0005'
    )
ON CONFLICT (scope_key) DO NOTHING;

COMMIT;
