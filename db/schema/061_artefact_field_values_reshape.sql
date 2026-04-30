-- ============================================================
-- MMFFDev - Vector: Artefact field values — typed column reshape
-- Migration 061 — applied on top of 060_artefact_schema_tables.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 061_artefact_field_values_reshape.sql
--
-- Reshapes the *_field_values tables for all 5 Phase 1 artefact types.
--
-- Drops (old EAV columns):
--   value_text, value_number, value_boolean, value_date, value_jsonb
--   template_field_id (FK to _template_form_fields — table dropped in 060)
--
-- Adds (typed columns — mirrors Jira customfieldvalue pattern):
--   string_value  TEXT          — textbox, select, radio, user, url, multiselect (CSV)
--   number_value  NUMERIC(19,4) — integer, decimal
--   text_value    TEXT          — richtext (Lexical JSON state)
--   date_value    DATE          — date
--
-- Adds (schema reference):
--   schema_field_id UUID nullable FK → *_schema(id) ON DELETE SET NULL
--   field_name is kept denormalised for direct lookup without schema join.
--
-- UNIQUE(artefact_id, field_name) is preserved on all tables.
-- ============================================================

BEGIN;

-- ============================================================
-- execution_user_stories_field_values
-- ============================================================

ALTER TABLE o_artefacts_execution_user_stories_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_execution_user_stories_field_values
    ADD COLUMN string_value     TEXT,
    ADD COLUMN number_value     NUMERIC(19,4),
    ADD COLUMN text_value       TEXT,
    ADD COLUMN date_value       DATE,
    ADD COLUMN schema_field_id  UUID REFERENCES o_artefacts_execution_user_stories_schema(id) ON DELETE SET NULL;

CREATE INDEX idx_o_us_fv_schema_field
    ON o_artefacts_execution_user_stories_field_values (schema_field_id)
    WHERE schema_field_id IS NOT NULL;

-- ============================================================
-- execution_defects_field_values
-- ============================================================

ALTER TABLE o_artefacts_execution_defects_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_execution_defects_field_values
    ADD COLUMN string_value     TEXT,
    ADD COLUMN number_value     NUMERIC(19,4),
    ADD COLUMN text_value       TEXT,
    ADD COLUMN date_value       DATE,
    ADD COLUMN schema_field_id  UUID REFERENCES o_artefacts_execution_defects_schema(id) ON DELETE SET NULL;

CREATE INDEX idx_o_de_fv_schema_field
    ON o_artefacts_execution_defects_field_values (schema_field_id)
    WHERE schema_field_id IS NOT NULL;

-- ============================================================
-- execution_tasks_field_values
-- ============================================================

ALTER TABLE o_artefacts_execution_tasks_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_execution_tasks_field_values
    ADD COLUMN string_value     TEXT,
    ADD COLUMN number_value     NUMERIC(19,4),
    ADD COLUMN text_value       TEXT,
    ADD COLUMN date_value       DATE,
    ADD COLUMN schema_field_id  UUID REFERENCES o_artefacts_execution_tasks_schema(id) ON DELETE SET NULL;

CREATE INDEX idx_o_ta_fv_schema_field
    ON o_artefacts_execution_tasks_field_values (schema_field_id)
    WHERE schema_field_id IS NOT NULL;

-- ============================================================
-- execution_test_cases_field_values
-- ============================================================

ALTER TABLE o_artefacts_execution_test_cases_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_execution_test_cases_field_values
    ADD COLUMN string_value     TEXT,
    ADD COLUMN number_value     NUMERIC(19,4),
    ADD COLUMN text_value       TEXT,
    ADD COLUMN date_value       DATE,
    ADD COLUMN schema_field_id  UUID REFERENCES o_artefacts_execution_test_cases_schema(id) ON DELETE SET NULL;

CREATE INDEX idx_o_tc_fv_schema_field
    ON o_artefacts_execution_test_cases_field_values (schema_field_id)
    WHERE schema_field_id IS NOT NULL;

-- ============================================================
-- strategic_field_values
-- ============================================================

ALTER TABLE o_artefacts_strategic_field_values
    DROP COLUMN IF EXISTS template_field_id,
    DROP COLUMN IF EXISTS value_text,
    DROP COLUMN IF EXISTS value_number,
    DROP COLUMN IF EXISTS value_boolean,
    DROP COLUMN IF EXISTS value_date,
    DROP COLUMN IF EXISTS value_jsonb;

ALTER TABLE o_artefacts_strategic_field_values
    ADD COLUMN string_value     TEXT,
    ADD COLUMN number_value     NUMERIC(19,4),
    ADD COLUMN text_value       TEXT,
    ADD COLUMN date_value       DATE,
    ADD COLUMN schema_field_id  UUID REFERENCES o_artefacts_strategic_schema(id) ON DELETE SET NULL;

CREATE INDEX idx_o_st_fv_schema_field
    ON o_artefacts_strategic_field_values (schema_field_id)
    WHERE schema_field_id IS NOT NULL;

COMMIT;
