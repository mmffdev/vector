-- ============================================================
-- 101_artefacts_types_fields_column_prefix_RF1_5_3.sql
--
-- RF1.5.3 — Pillar 1 wave 3, table 3/5.
--
-- Applies the §2.3 column-prefix convention to artefacts_types_fields.
-- PK `id` becomes `artefacts_types_fields_id`. Two real Postgres FKs:
--   artefact_type_id → artefacts_types(artefacts_types_id)
--   field_library_id → artefacts_fields_library(id)
-- Both follow §2.4 FK shape `<table>_id_<target>`:
--   artefact_type_id  → artefacts_types_fields_id_artefact_type
--   field_library_id  → artefacts_types_fields_id_field_library
--
-- The intra-DB FK `field_library_id` → `artefacts_fields_library(id)`
-- automatically retargets to the just-renamed
-- `artefacts_fields_library_id` because the migration order is 100
-- (artefacts_fields_library swept) → 101 (this) — Postgres tracks FK
-- target by column oid.
--
-- Legacy singular-prefix constraint/index names (`artefact_type_fields_*`)
-- get normalised to the plural `artefacts_types_fields_*`.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE artefacts_types_fields RENAME COLUMN id               TO artefacts_types_fields_id;
ALTER TABLE artefacts_types_fields RENAME COLUMN artefact_type_id TO artefacts_types_fields_id_artefact_type;
ALTER TABLE artefacts_types_fields RENAME COLUMN field_library_id TO artefacts_types_fields_id_field_library;
ALTER TABLE artefacts_types_fields RENAME COLUMN position         TO artefacts_types_fields_position;
ALTER TABLE artefacts_types_fields RENAME COLUMN required         TO artefacts_types_fields_required;
ALTER TABLE artefacts_types_fields RENAME COLUMN default_value    TO artefacts_types_fields_default_value;
ALTER TABLE artefacts_types_fields RENAME COLUMN created_at       TO artefacts_types_fields_created_at;
ALTER TABLE artefacts_types_fields RENAME COLUMN updated_at       TO artefacts_types_fields_updated_at;

-- ---- Index renames ----

ALTER INDEX artefact_type_fields_pkey
    RENAME TO artefacts_types_fields_pkey;

ALTER INDEX artefact_type_fields_by_field
    RENAME TO idx_artefacts_types_fields_id_field_library;

ALTER INDEX artefact_type_fields_by_type_position
    RENAME TO idx_artefacts_types_fields_id_artefact_type_position;

ALTER INDEX artefact_type_fields_unique_binding
    RENAME TO artefacts_types_fields_id_artefact_type_id_field_library_uniq;

-- ---- Constraint renames ----

ALTER TABLE artefacts_types_fields
    RENAME CONSTRAINT artefact_type_fields_artefact_type_id_fkey
                  TO artefacts_types_fields_id_artefact_type_fkey;

ALTER TABLE artefacts_types_fields
    RENAME CONSTRAINT artefact_type_fields_field_library_id_fkey
                  TO artefacts_types_fields_id_field_library_fkey;

COMMIT;
