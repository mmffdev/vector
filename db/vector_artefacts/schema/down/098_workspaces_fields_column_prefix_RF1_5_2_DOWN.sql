-- ============================================================
-- 098_workspaces_fields_column_prefix_RF1_5_2_DOWN.sql
--
-- Reverses 098_workspaces_fields_column_prefix_RF1_5_2.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE workspaces_fields
    RENAME CONSTRAINT workspaces_fields_id_field_library_fkey
                  TO artefact_workspace_fields_field_library_id_fkey;

ALTER TABLE workspaces_fields
    RENAME CONSTRAINT workspaces_fields_pkey
                  TO artefact_workspace_fields_pkey;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_workspaces_fields_id_field_library RENAME TO idx_awf_field;

-- ---- Column renames (reverse) ----

ALTER TABLE workspaces_fields RENAME COLUMN workspaces_fields_id_user_created_by   TO created_by;
ALTER TABLE workspaces_fields RENAME COLUMN workspaces_fields_created_at           TO created_at;
ALTER TABLE workspaces_fields RENAME COLUMN workspaces_fields_id_field_library     TO field_library_id;
ALTER TABLE workspaces_fields RENAME COLUMN workspaces_fields_id_workspace         TO workspace_id;

COMMIT;
