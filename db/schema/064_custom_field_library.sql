-- ============================================================
-- MMFFDev - Vector: Custom Field Library + Work Item Templates
-- Migration 064 — applied on top of 063_work_items_rename_and_epics.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 064_custom_field_library.sql
--
-- Replaces all _schema, _template_forms, and _template_form_fields tables
-- with a unified three-layer architecture:
--
--   Layer 1: core artefact table (unchanged — standard out-of-box fields)
--   Layer 2: _field_values — template-driven OR ad-hoc extended fields
--   Layer 3: o_execution_custom_field_library — god list of all custom fields
--             ever defined in a workspace; shared across all artefact types
--
-- New tables:
--   o_execution_custom_field_library       — workspace field catalogue
--   o_execution_work_item_templates        — named form templates (padmin-defined)
--   o_execution_work_item_template_fields  — ordered field slots per template
--
-- All _field_values tables reshaped:
--   DROP: template_field_id, value_text, value_number, value_boolean,
--         value_date, value_jsonb (old column names)
--   ADD:  field_library_id FK, template_id FK
--   KEEP: string_value, number_value, text_value, date_value
--         (work_items + epics already have these; others get them now)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Drop all surviving _template_form_fields tables
-- ============================================================

DROP TABLE IF EXISTS o_artefacts_execution_defects_template_form_fields    CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_tasks_template_form_fields       CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_test_cases_template_form_fields  CASCADE;
DROP TABLE IF EXISTS o_artefacts_strategic_template_form_fields             CASCADE;

-- ============================================================
-- 2. Drop template_form_id FK columns from core tables
--    (must go before parent _template_forms drop)
-- ============================================================

ALTER TABLE o_artefacts_execution_defects    DROP COLUMN IF EXISTS template_form_id;
ALTER TABLE o_artefacts_execution_tasks      DROP COLUMN IF EXISTS template_form_id;
ALTER TABLE o_artefacts_execution_test_cases DROP COLUMN IF EXISTS template_form_id;
ALTER TABLE o_artefacts_strategic            DROP COLUMN IF EXISTS template_form_id;

-- ============================================================
-- 3. Drop all surviving _template_forms tables
-- ============================================================

DROP TABLE IF EXISTS o_artefacts_execution_defects_template_forms    CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_tasks_template_forms       CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_test_cases_template_forms  CASCADE;
DROP TABLE IF EXISTS o_artefacts_strategic_template_forms             CASCADE;

-- ============================================================
-- 4. Drop all _schema tables (replaced by field library)
-- ============================================================

DROP TABLE IF EXISTS o_artefacts_execution_work_items_schema CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_epics_schema      CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_defects_schema    CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_tasks_schema      CASCADE;
DROP TABLE IF EXISTS o_artefacts_execution_test_cases_schema CASCADE;
DROP TABLE IF EXISTS o_artefacts_strategic_schema            CASCADE;

-- ============================================================
-- 5. Create o_execution_custom_field_library — the god list
--    Workspace-scoped catalogue of every custom field ever
--    defined. Shared across all artefact types. Padmins manage
--    this; users pick from it or add to it when extending items.
-- ============================================================

CREATE TABLE o_execution_custom_field_library (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    field_name      TEXT        NOT NULL,
    label           TEXT        NOT NULL,
    type            TEXT        NOT NULL,
    options_json    JSONB,
    config_json     JSONB,
    created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT o_cfl_field_name_nonempty CHECK (length(btrim(field_name)) > 0),
    CONSTRAINT o_cfl_label_nonempty      CHECK (length(btrim(label)) > 0),
    CONSTRAINT o_cfl_type_valid CHECK (
        type IN ('textbox','richtext','integer','decimal','date','boolean',
                 'select','multiselect','radio','user','url')
    ),
    UNIQUE (subscription_id, field_name)
);

CREATE INDEX idx_o_cfl_sub
    ON o_execution_custom_field_library (subscription_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_cfl_updated_at
    BEFORE UPDATE ON o_execution_custom_field_library
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 6. Create o_execution_work_item_templates
--    Named form templates assembled by padmins from library
--    fields. Applied to a work item at creation time to
--    pre-populate field_value rows.
-- ============================================================

CREATE TABLE o_execution_work_item_templates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    description     TEXT,
    item_type       TEXT,
    created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT o_wit_name_nonempty  CHECK (length(btrim(name)) > 0),
    CONSTRAINT o_wit_item_type_valid CHECK (
        item_type IS NULL OR item_type IN ('epic','story','defect','task','test_case','strategic')
    ),
    UNIQUE (subscription_id, name)
);

CREATE INDEX idx_o_wit_sub
    ON o_execution_work_item_templates (subscription_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_wit_updated_at
    BEFORE UPDATE ON o_execution_work_item_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 7. Create o_execution_work_item_template_fields
--    Ordered field slots within a template. Each slot points
--    to a library entry and carries position + required +
--    default_value overrides.
-- ============================================================

CREATE TABLE o_execution_work_item_template_fields (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     UUID        NOT NULL REFERENCES o_execution_work_item_templates(id) ON DELETE CASCADE,
    field_library_id UUID       NOT NULL REFERENCES o_execution_custom_field_library(id) ON DELETE RESTRICT,
    position        INTEGER     NOT NULL DEFAULT 0,
    required        BOOLEAN     NOT NULL DEFAULT FALSE,
    default_value   TEXT,

    CONSTRAINT o_witf_position_nonneg CHECK (position >= 0),
    UNIQUE (template_id, field_library_id)
);

CREATE INDEX idx_o_witf_template
    ON o_execution_work_item_template_fields (template_id, position);

-- ============================================================
-- 8. Reshape _field_values tables
--    For work_items + epics: already have string/number/text/date
--    columns; just drop schema_field_id, add field_library_id + template_id.
--    For defects/tasks/test_cases/strategic: still have old
--    value_* column names; rename + add new FKs.
-- ============================================================

-- ---- 8a. work_items_field_values ----

ALTER TABLE o_artefacts_execution_work_items_field_values
    DROP COLUMN IF EXISTS schema_field_id;

ALTER TABLE o_artefacts_execution_work_items_field_values
    ADD COLUMN IF NOT EXISTS field_library_id UUID
        REFERENCES o_execution_custom_field_library(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS template_id UUID
        REFERENCES o_execution_work_item_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_o_wi_fv_library
    ON o_artefacts_execution_work_items_field_values (field_library_id)
    WHERE field_library_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_o_wi_fv_template
    ON o_artefacts_execution_work_items_field_values (template_id)
    WHERE template_id IS NOT NULL;

-- ---- 8b. epics_field_values ----

ALTER TABLE o_artefacts_execution_epics_field_values
    DROP COLUMN IF EXISTS schema_field_id;

ALTER TABLE o_artefacts_execution_epics_field_values
    ADD COLUMN IF NOT EXISTS field_library_id UUID
        REFERENCES o_execution_custom_field_library(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS template_id UUID
        REFERENCES o_execution_work_item_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_o_ep_fv_library
    ON o_artefacts_execution_epics_field_values (field_library_id)
    WHERE field_library_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_o_ep_fv_template
    ON o_artefacts_execution_epics_field_values (template_id)
    WHERE template_id IS NOT NULL;

-- ---- 8c. defects_field_values ----

ALTER TABLE o_artefacts_execution_defects_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_execution_defects_field_values
    ADD COLUMN IF NOT EXISTS string_value    TEXT,
    ADD COLUMN IF NOT EXISTS number_value    NUMERIC(19,4),
    ADD COLUMN IF NOT EXISTS text_value      TEXT,
    ADD COLUMN IF NOT EXISTS date_value      DATE,
    ADD COLUMN IF NOT EXISTS field_library_id UUID
        REFERENCES o_execution_custom_field_library(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS template_id UUID
        REFERENCES o_execution_work_item_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_o_de_fv_library
    ON o_artefacts_execution_defects_field_values (field_library_id)
    WHERE field_library_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_o_de_fv_template
    ON o_artefacts_execution_defects_field_values (template_id)
    WHERE template_id IS NOT NULL;

-- ---- 8d. tasks_field_values ----

ALTER TABLE o_artefacts_execution_tasks_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_execution_tasks_field_values
    ADD COLUMN IF NOT EXISTS string_value    TEXT,
    ADD COLUMN IF NOT EXISTS number_value    NUMERIC(19,4),
    ADD COLUMN IF NOT EXISTS text_value      TEXT,
    ADD COLUMN IF NOT EXISTS date_value      DATE,
    ADD COLUMN IF NOT EXISTS field_library_id UUID
        REFERENCES o_execution_custom_field_library(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS template_id UUID
        REFERENCES o_execution_work_item_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_o_ta_fv_library
    ON o_artefacts_execution_tasks_field_values (field_library_id)
    WHERE field_library_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_o_ta_fv_template
    ON o_artefacts_execution_tasks_field_values (template_id)
    WHERE template_id IS NOT NULL;

-- ---- 8e. test_cases_field_values ----

ALTER TABLE o_artefacts_execution_test_cases_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_execution_test_cases_field_values
    ADD COLUMN IF NOT EXISTS string_value    TEXT,
    ADD COLUMN IF NOT EXISTS number_value    NUMERIC(19,4),
    ADD COLUMN IF NOT EXISTS text_value      TEXT,
    ADD COLUMN IF NOT EXISTS date_value      DATE,
    ADD COLUMN IF NOT EXISTS field_library_id UUID
        REFERENCES o_execution_custom_field_library(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS template_id UUID
        REFERENCES o_execution_work_item_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_o_tc_fv_library
    ON o_artefacts_execution_test_cases_field_values (field_library_id)
    WHERE field_library_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_o_tc_fv_template
    ON o_artefacts_execution_test_cases_field_values (template_id)
    WHERE template_id IS NOT NULL;

-- ---- 8f. strategic_field_values ----

ALTER TABLE o_artefacts_strategic_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_strategic_field_values
    ADD COLUMN IF NOT EXISTS string_value    TEXT,
    ADD COLUMN IF NOT EXISTS number_value    NUMERIC(19,4),
    ADD COLUMN IF NOT EXISTS text_value      TEXT,
    ADD COLUMN IF NOT EXISTS date_value      DATE,
    ADD COLUMN IF NOT EXISTS field_library_id UUID
        REFERENCES o_execution_custom_field_library(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS template_id UUID
        REFERENCES o_execution_work_item_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_o_st_fv_library
    ON o_artefacts_strategic_field_values (field_library_id)
    WHERE field_library_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_o_st_fv_template
    ON o_artefacts_strategic_field_values (template_id)
    WHERE template_id IS NOT NULL;

COMMIT;
