-- ============================================================
-- 100_artefacts_fields_library_column_prefix_RF1_5_3.sql
--
-- RF1.5.3 — Pillar 1 wave 3, table 2/5.
--
-- Applies the §2.3 column-prefix convention to artefacts_fields_library.
-- PK `id` becomes `artefacts_fields_library_id`. `subscription_id` is
-- an app-soft reference (subscriptions lives in mmff_vector); follows
-- §2.4 shape `<table>_id_<target>`:
--   subscription_id → artefacts_fields_library_id_subscription
--
-- Inbound FKs from artefacts_types_fields, artefacts_fields_values,
-- and workspaces_fields are automatically retargeted by Postgres on
-- the PK column rename (FKs track column oid, not name). artefacts_fields_values
-- + workspaces_fields already use the prefixed FK column names; the
-- artefacts_types_fields side gets swept in migration 101.
--
-- Legacy index/constraint names with the singular `artefact_field_library_*`
-- prefix get normalised to the plural `artefacts_fields_library_*` (the
-- table is plural; the singular prefix is a pre-rename artefact).
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE artefacts_fields_library RENAME COLUMN id              TO artefacts_fields_library_id;
ALTER TABLE artefacts_fields_library RENAME COLUMN subscription_id TO artefacts_fields_library_id_subscription;
ALTER TABLE artefacts_fields_library RENAME COLUMN field_name      TO artefacts_fields_library_field_name;
ALTER TABLE artefacts_fields_library RENAME COLUMN label           TO artefacts_fields_library_label;
ALTER TABLE artefacts_fields_library RENAME COLUMN field_type      TO artefacts_fields_library_field_type;
ALTER TABLE artefacts_fields_library RENAME COLUMN options_json    TO artefacts_fields_library_options_json;
ALTER TABLE artefacts_fields_library RENAME COLUMN config_json     TO artefacts_fields_library_config_json;
ALTER TABLE artefacts_fields_library RENAME COLUMN description     TO artefacts_fields_library_description;
ALTER TABLE artefacts_fields_library RENAME COLUMN created_at      TO artefacts_fields_library_created_at;
ALTER TABLE artefacts_fields_library RENAME COLUMN updated_at      TO artefacts_fields_library_updated_at;
ALTER TABLE artefacts_fields_library RENAME COLUMN archived_at     TO artefacts_fields_library_archived_at;
ALTER TABLE artefacts_fields_library RENAME COLUMN scope           TO artefacts_fields_library_scope;

-- ---- Index renames ----

ALTER INDEX artefact_field_library_pkey
    RENAME TO artefacts_fields_library_pkey;

ALTER INDEX artefact_field_library_by_subscription
    RENAME TO idx_artefacts_fields_library_id_subscription_label;

ALTER INDEX artefact_field_library_label_type_unique_live_tenant
    RENAME TO artefacts_fields_library_id_subscription_label_field_type_uniq;

ALTER INDEX artefact_field_library_slug_unique_live
    RENAME TO artefacts_fields_library_id_subscription_field_name_unique;

-- ---- Constraint renames ----

ALTER TABLE artefacts_fields_library
    RENAME CONSTRAINT chk_afl_global_no_subscription
                  TO artefacts_fields_library_scope_subscription_chk;

ALTER TABLE artefacts_fields_library
    RENAME CONSTRAINT chk_afl_scope_values
                  TO artefacts_fields_library_scope_chk;

ALTER TABLE artefacts_fields_library
    RENAME CONSTRAINT field_library_field_type_check
                  TO artefacts_fields_library_field_type_chk;

COMMIT;
