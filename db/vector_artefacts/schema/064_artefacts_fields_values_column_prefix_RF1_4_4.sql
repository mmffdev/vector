-- ============================================================
-- 064_artefacts_fields_values_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (4 of N).
--
-- Applies the §2.3 column-prefix convention to artefacts_fields_values:
-- every column gains the table-name prefix; FKs to artefacts.id and
-- artefacts_fields_library.id carry the §2.4 FK shape
-- <table>_id_<target>.
--
-- Indexes + constraints + the trigger reference inside set_updated_at
-- pickup are normalised. After this migration:
--   • `artefactitemsv2` package: 6 → 0 findings → OFF the ledger.
-- ============================================================

BEGIN;

-- ---- Column renames (10 columns) ----

ALTER TABLE artefacts_fields_values RENAME COLUMN id               TO artefacts_fields_values_id;
ALTER TABLE artefacts_fields_values RENAME COLUMN artefact_id      TO artefacts_fields_values_id_artefact;
ALTER TABLE artefacts_fields_values RENAME COLUMN field_library_id TO artefacts_fields_values_id_field_library;
ALTER TABLE artefacts_fields_values RENAME COLUMN string_value     TO artefacts_fields_values_string_value;
ALTER TABLE artefacts_fields_values RENAME COLUMN text_value       TO artefacts_fields_values_text_value;
ALTER TABLE artefacts_fields_values RENAME COLUMN number_value     TO artefacts_fields_values_number_value;
ALTER TABLE artefacts_fields_values RENAME COLUMN date_value       TO artefacts_fields_values_date_value;
ALTER TABLE artefacts_fields_values RENAME COLUMN boolean_value    TO artefacts_fields_values_boolean_value;
ALTER TABLE artefacts_fields_values RENAME COLUMN created_at       TO artefacts_fields_values_created_at;
ALTER TABLE artefacts_fields_values RENAME COLUMN updated_at       TO artefacts_fields_values_updated_at;

-- ---- Index renames ----

ALTER INDEX artefact_field_values_pkey            RENAME TO artefacts_fields_values_pkey;
ALTER INDEX artefact_field_values_unique          RENAME TO artefacts_fields_values_unique;
ALTER INDEX artefact_field_values_by_field_date   RENAME TO artefacts_fields_values_by_field_date;
ALTER INDEX artefact_field_values_by_field_number RENAME TO artefacts_fields_values_by_field_number;
ALTER INDEX artefact_field_values_by_field_string RENAME TO artefacts_fields_values_by_field_string;

-- ---- Constraint renames ----

ALTER TABLE artefacts_fields_values
    RENAME CONSTRAINT artefact_field_values_one_value
                   TO artefacts_fields_values_one_value;

ALTER TABLE artefacts_fields_values
    RENAME CONSTRAINT artefact_field_values_artefact_id_fkey
                   TO artefacts_fields_values_id_artefact_fkey;

ALTER TABLE artefacts_fields_values
    RENAME CONSTRAINT artefact_field_values_field_library_id_fkey
                   TO artefacts_fields_values_id_field_library_fkey;

-- ---- Trigger rename + body update ----
-- The generic set_updated_at() trigger function references NEW.updated_at,
-- which is now NEW.artefacts_fields_values_updated_at on this table. We
-- can't share the generic function any more for this table — install a
-- table-specific trigger function.

DROP TRIGGER IF EXISTS artefact_field_values_set_updated_at ON artefacts_fields_values;

CREATE OR REPLACE FUNCTION fn_artefacts_fields_values_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.artefacts_fields_values_updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_artefacts_fields_values_touch_updated_at
BEFORE UPDATE ON artefacts_fields_values
FOR EACH ROW
EXECUTE FUNCTION fn_artefacts_fields_values_touch_updated_at();

COMMIT;
