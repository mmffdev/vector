-- ============================================================
-- 098_workspaces_fields_column_prefix_RF1_5_2.sql
--
-- RF1.5.2 — Pillar 1 wave 2, table 5/5.
--
-- Applies the §2.3 column-prefix convention to workspaces_fields
-- (the per-workspace field-library admit-row table). Composite-PK
-- table (no `id` column): the PK is (workspace_id, field_library_id),
-- so both PK columns follow the §2.4 FK shape `<table>_id_<target>`
-- — mirrors the 095_artefacts_number_sequences precedent in this
-- same wave.
--
-- Legacy `artefact_workspace_fields_*` constraint + index names get
-- normalised to `workspaces_fields_*` (matches the current table
-- name; the singular `artefact_workspace_fields_*` prefix is a
-- pre-rename artefact from an earlier PLA-0048 split). Same pattern
-- as wave-1 users_tab_order (255).
--
-- The intra-DB FK `field_library_id` → `artefacts_fields_library(id)`
-- is automatically retargeted by Postgres on column rename (FKs track
-- column oid, not name). The target column `artefacts_fields_library.id`
-- itself stays bare here — `artefacts_fields_library` is a different
-- wave's table.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE workspaces_fields RENAME COLUMN workspace_id     TO workspaces_fields_id_workspace;
ALTER TABLE workspaces_fields RENAME COLUMN field_library_id TO workspaces_fields_id_field_library;
ALTER TABLE workspaces_fields RENAME COLUMN created_at       TO workspaces_fields_created_at;
ALTER TABLE workspaces_fields RENAME COLUMN created_by       TO workspaces_fields_id_user_created_by;

-- ---- Plain (non-PK) index renames ----

ALTER INDEX idx_awf_field RENAME TO idx_workspaces_fields_id_field_library;

-- ---- Constraint renames (also renames the backing index for the PK) ----

ALTER TABLE workspaces_fields
    RENAME CONSTRAINT artefact_workspace_fields_pkey
                  TO workspaces_fields_pkey;

ALTER TABLE workspaces_fields
    RENAME CONSTRAINT artefact_workspace_fields_field_library_id_fkey
                  TO workspaces_fields_id_field_library_fkey;

COMMIT;
