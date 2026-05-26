-- ============================================================
-- 100_artefacts_fields_library_column_prefix_RF1_5_3_DOWN.sql
--
-- Reverses 100_artefacts_fields_library_column_prefix_RF1_5_3.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE artefacts_fields_library
    RENAME CONSTRAINT artefacts_fields_library_field_type_chk
                  TO field_library_field_type_check;

ALTER TABLE artefacts_fields_library
    RENAME CONSTRAINT artefacts_fields_library_scope_chk
                  TO chk_afl_scope_values;

ALTER TABLE artefacts_fields_library
    RENAME CONSTRAINT artefacts_fields_library_scope_subscription_chk
                  TO chk_afl_global_no_subscription;

-- ---- Index renames (reverse) ----

ALTER INDEX artefacts_fields_library_id_subscription_field_name_unique
    RENAME TO artefact_field_library_slug_unique_live;

ALTER INDEX artefacts_fields_library_id_subscription_label_field_type_uniq
    RENAME TO artefact_field_library_label_type_unique_live_tenant;

ALTER INDEX idx_artefacts_fields_library_id_subscription_label
    RENAME TO artefact_field_library_by_subscription;

ALTER INDEX artefacts_fields_library_pkey
    RENAME TO artefact_field_library_pkey;

-- ---- Column renames (reverse) ----

ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_scope            TO scope;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_archived_at      TO archived_at;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_updated_at       TO updated_at;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_created_at       TO created_at;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_description      TO description;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_config_json      TO config_json;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_options_json     TO options_json;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_field_type       TO field_type;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_label            TO label;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_field_name       TO field_name;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_id_subscription  TO subscription_id;
ALTER TABLE artefacts_fields_library RENAME COLUMN artefacts_fields_library_id               TO id;

COMMIT;
