-- ============================================================
-- 101_artefacts_types_fields_column_prefix_RF1_5_3_DOWN.sql
--
-- Reverses 101_artefacts_types_fields_column_prefix_RF1_5_3.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE artefacts_types_fields
    RENAME CONSTRAINT artefacts_types_fields_id_field_library_fkey
                  TO artefact_type_fields_field_library_id_fkey;

ALTER TABLE artefacts_types_fields
    RENAME CONSTRAINT artefacts_types_fields_id_artefact_type_fkey
                  TO artefact_type_fields_artefact_type_id_fkey;

-- ---- Index renames (reverse) ----

ALTER INDEX artefacts_types_fields_id_artefact_type_id_field_library_uniq
    RENAME TO artefact_type_fields_unique_binding;

ALTER INDEX idx_artefacts_types_fields_id_artefact_type_position
    RENAME TO artefact_type_fields_by_type_position;

ALTER INDEX idx_artefacts_types_fields_id_field_library
    RENAME TO artefact_type_fields_by_field;

ALTER INDEX artefacts_types_fields_pkey
    RENAME TO artefact_type_fields_pkey;

-- ---- Column renames (reverse) ----

ALTER TABLE artefacts_types_fields RENAME COLUMN artefacts_types_fields_updated_at        TO updated_at;
ALTER TABLE artefacts_types_fields RENAME COLUMN artefacts_types_fields_created_at        TO created_at;
ALTER TABLE artefacts_types_fields RENAME COLUMN artefacts_types_fields_default_value     TO default_value;
ALTER TABLE artefacts_types_fields RENAME COLUMN artefacts_types_fields_required          TO required;
ALTER TABLE artefacts_types_fields RENAME COLUMN artefacts_types_fields_position          TO position;
ALTER TABLE artefacts_types_fields RENAME COLUMN artefacts_types_fields_id_field_library  TO field_library_id;
ALTER TABLE artefacts_types_fields RENAME COLUMN artefacts_types_fields_id_artefact_type  TO artefact_type_id;
ALTER TABLE artefacts_types_fields RENAME COLUMN artefacts_types_fields_id                TO id;

COMMIT;
