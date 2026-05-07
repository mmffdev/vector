-- ============================================================
-- DOWN: M2 (PLA-0026 / story 00477)
-- Reverse the rename + scope discriminator on artefact_field_library.
--
-- Pre-condition: every row's scope must be 'tenant' (no global / workspace
-- rows can survive a downgrade — they would have nowhere to live in the old
-- schema). The script SELECTs and aborts if violated.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts \
--        -f down/017_artefact_field_library_rename_scope_DOWN.sql
-- ============================================================

BEGIN;

DO $$
DECLARE
    bad_count INT;
BEGIN
    SELECT COUNT(*) INTO bad_count
    FROM artefact_field_library
    WHERE scope <> 'tenant';
    IF bad_count > 0 THEN
        RAISE EXCEPTION
            'cannot downgrade: % row(s) have scope <> tenant; old schema cannot represent them',
            bad_count;
    END IF;
END $$;

-- 1. Drop the CHECK constraints.
ALTER TABLE artefact_field_library
    DROP CONSTRAINT chk_afl_global_no_subscription;
ALTER TABLE artefact_field_library
    DROP CONSTRAINT chk_afl_scope_values;

-- 2. Drop the scope column.
ALTER TABLE artefact_field_library DROP COLUMN scope;

-- 3. Restore subscription_id NOT NULL (every surviving row already has a
--    non-NULL value because we proved scope='tenant' above).
ALTER TABLE artefact_field_library
    ALTER COLUMN subscription_id SET NOT NULL;

-- 4. Rename indexes back.
ALTER INDEX artefact_field_library_pkey                RENAME TO field_library_pkey;
ALTER INDEX artefact_field_library_slug_unique_live    RENAME TO field_library_slug_unique_live;
ALTER INDEX artefact_field_library_by_subscription     RENAME TO field_library_by_subscription;

-- 5. Rename trigger back.
ALTER TRIGGER artefact_field_library_set_updated_at
    ON artefact_field_library
    RENAME TO field_library_set_updated_at;

-- 6. Rename the table back.
ALTER TABLE artefact_field_library RENAME TO field_library;

-- 7. Restore the original comments.
COMMENT ON TABLE  field_library IS
    'Subscription-wide catalogue of custom field DEFINITIONS. One row = one '
    'reusable field. Bindings to artefact types live in artefact_type_fields.';

COMMIT;
