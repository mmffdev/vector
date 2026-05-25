-- ============================================================
-- MMFFDev - Vector: DOWN for migration 250 (drop UNCERTAIN cluster)
-- Restores: obj_field_template_fields, obj_field_templates,
--           obj_custom_field_lib, sprints
--
-- This DOWN is a syntactically valid rollback safety net. It has NOT
-- been production-tested. Tables are restored empty — no data recovery
-- (the original rows were confirmed dev-seed debt).
--
-- DDL sourced from:
--   obj_custom_field_lib / obj_field_templates / obj_field_template_fields
--     → mig 064_custom_field_library.sql (CREATE TABLE bodies),
--       mig 123_rename_tables_to_obj_family.sql (final names)
--   sprints → mig 065_execution_core_columns.sql
-- ============================================================

BEGIN;

-- ── 1. Restore obj_custom_field_lib ──────────────────────────────────────
CREATE TABLE obj_custom_field_lib (
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
    ON obj_custom_field_lib (subscription_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_cfl_updated_at
    BEFORE UPDATE ON obj_custom_field_lib
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. Restore obj_field_templates ───────────────────────────────────────
CREATE TABLE obj_field_templates (
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
    ON obj_field_templates (subscription_id)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_o_wit_updated_at
    BEFORE UPDATE ON obj_field_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. Restore obj_field_template_fields ─────────────────────────────────
CREATE TABLE obj_field_template_fields (
    id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id      UUID    NOT NULL REFERENCES obj_field_templates(id) ON DELETE CASCADE,
    field_library_id UUID    NOT NULL REFERENCES obj_custom_field_lib(id) ON DELETE RESTRICT,
    position         INTEGER NOT NULL DEFAULT 0,
    required         BOOLEAN NOT NULL DEFAULT FALSE,
    default_value    TEXT,

    CONSTRAINT o_witf_position_nonneg CHECK (position >= 0),
    UNIQUE (template_id, field_library_id)
);

CREATE INDEX idx_o_witf_template
    ON obj_field_template_fields (template_id, position);

-- ── 4. Restore sprints ────────────────────────────────────────────────────
CREATE TABLE sprints (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    goal            TEXT,
    start_date      DATE,
    end_date        DATE,
    status          TEXT        NOT NULL DEFAULT 'planned',
    created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT sp_name_nonempty CHECK (length(btrim(name)) > 0),
    CONSTRAINT sp_status_valid  CHECK (status IN ('planned','active','completed')),
    CONSTRAINT sp_dates_valid   CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_sp_sub
    ON sprints (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_sp_sub_status
    ON sprints (subscription_id, status)
    WHERE archived_at IS NULL;

-- ── 5. Remove the schema_migrations row ──────────────────────────────────
DELETE FROM schema_migrations WHERE filename = '250_drop_uncertain_cluster.sql';

COMMIT;
