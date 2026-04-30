-- ============================================================
-- MMFFDev - Vector: Artefact schema tables — three-table pivot
-- Migration 060 — applied on top of 059_artefact_type_registry_seed.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 060_artefact_schema_tables.sql
--
-- Supersedes the four-table pattern introduced in 051–055.
-- Drops: *_template_forms and *_template_form_fields tables for all 5 types.
-- Also drops the template_form_id FK column from all 5 core artefact tables.
-- Creates: *_schema tables (one per type) — workspace-scoped field definitions.
--
-- Three-table pattern (R010 §3):
--   core table          — the artefact row
--   *_schema            — field definitions per workspace (UNIQUE subscription_id + field_name)
--   *_field_values      — typed values per artefact (reshaped in migration 061)
--
-- Type CHECK constraint mirrors the Samantha SDK renderer registry:
--   textbox | richtext | integer | decimal | date | boolean
--   select | multiselect | radio | user | url
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Drop _template_form_fields tables (child of template_forms)
-- ============================================================

DROP TABLE IF EXISTS o_artefacts_execution_user_stories_template_form_fields CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_defects_template_form_fields      CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_tasks_template_form_fields         CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_test_cases_template_form_fields    CASCADE;
DROP TABLE IF EXISTS o_artefacts_strategic_template_form_fields               CASCADE;

-- ============================================================
-- 2. Drop template_form_id FK columns from core tables
--    (references _template_forms; must go before parent drop)
-- ============================================================

ALTER TABLE o_artefacts_execution_user_stories DROP COLUMN IF EXISTS template_form_id;
ALTER TABLE o_artefacts_execution_defects       DROP COLUMN IF EXISTS template_form_id;
ALTER TABLE o_artefacts_execution_tasks         DROP COLUMN IF EXISTS template_form_id;
ALTER TABLE o_artefacts_execution_test_cases    DROP COLUMN IF EXISTS template_form_id;
ALTER TABLE o_artefacts_strategic               DROP COLUMN IF EXISTS template_form_id;

-- ============================================================
-- 3. Drop _template_forms tables
-- ============================================================

DROP TABLE IF EXISTS o_artefacts_execution_user_stories_template_forms CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_defects_template_forms       CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_tasks_template_forms          CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_test_cases_template_forms     CASCADE;
DROP TABLE IF EXISTS o_artefacts_strategic_template_forms                CASCADE;

-- ============================================================
-- 4. Create _schema tables
--    One per artefact type. Rows define available custom fields
--    for a workspace (subscription). UNIQUE(subscription_id, field_name)
--    enforces workspace isolation — the same field_name can exist
--    in two workspaces as independent rows.
-- ============================================================

CREATE TABLE o_artefacts_execution_user_stories_schema (
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
    CONSTRAINT o_us_schema_position_nonneg     CHECK (position >= 0),
    UNIQUE (subscription_id, field_name)
);

CREATE INDEX idx_o_us_schema_sub
    ON o_artefacts_execution_user_stories_schema (subscription_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_us_schema_updated_at
    BEFORE UPDATE ON o_artefacts_execution_user_stories_schema
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------

CREATE TABLE o_artefacts_execution_defects_schema (
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

    CONSTRAINT o_de_schema_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_de_schema_label_nonempty      CHECK (length(btrim(label)) > 0),
    CONSTRAINT o_de_schema_type_valid CHECK (
        type IN ('textbox','richtext','integer','decimal','date','boolean',
                 'select','multiselect','radio','user','url')
    ),
    CONSTRAINT o_de_schema_position_nonneg     CHECK (position >= 0),
    UNIQUE (subscription_id, field_name)
);

CREATE INDEX idx_o_de_schema_sub
    ON o_artefacts_execution_defects_schema (subscription_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_de_schema_updated_at
    BEFORE UPDATE ON o_artefacts_execution_defects_schema
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------

CREATE TABLE o_artefacts_execution_tasks_schema (
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

    CONSTRAINT o_ta_schema_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_ta_schema_label_nonempty      CHECK (length(btrim(label)) > 0),
    CONSTRAINT o_ta_schema_type_valid CHECK (
        type IN ('textbox','richtext','integer','decimal','date','boolean',
                 'select','multiselect','radio','user','url')
    ),
    CONSTRAINT o_ta_schema_position_nonneg     CHECK (position >= 0),
    UNIQUE (subscription_id, field_name)
);

CREATE INDEX idx_o_ta_schema_sub
    ON o_artefacts_execution_tasks_schema (subscription_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_ta_schema_updated_at
    BEFORE UPDATE ON o_artefacts_execution_tasks_schema
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------

CREATE TABLE o_artefacts_execution_test_cases_schema (
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

    CONSTRAINT o_tc_schema_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_tc_schema_label_nonempty      CHECK (length(btrim(label)) > 0),
    CONSTRAINT o_tc_schema_type_valid CHECK (
        type IN ('textbox','richtext','integer','decimal','date','boolean',
                 'select','multiselect','radio','user','url')
    ),
    CONSTRAINT o_tc_schema_position_nonneg     CHECK (position >= 0),
    UNIQUE (subscription_id, field_name)
);

CREATE INDEX idx_o_tc_schema_sub
    ON o_artefacts_execution_test_cases_schema (subscription_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_tc_schema_updated_at
    BEFORE UPDATE ON o_artefacts_execution_test_cases_schema
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------

CREATE TABLE o_artefacts_strategic_schema (
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

    CONSTRAINT o_st_schema_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_st_schema_label_nonempty      CHECK (length(btrim(label)) > 0),
    CONSTRAINT o_st_schema_type_valid CHECK (
        type IN ('textbox','richtext','integer','decimal','date','boolean',
                 'select','multiselect','radio','user','url')
    ),
    CONSTRAINT o_st_schema_position_nonneg     CHECK (position >= 0),
    UNIQUE (subscription_id, field_name)
);

CREATE INDEX idx_o_st_schema_sub
    ON o_artefacts_strategic_schema (subscription_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_st_schema_updated_at
    BEFORE UPDATE ON o_artefacts_strategic_schema
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
