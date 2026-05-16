-- ============================================================
-- MMFFDev - Vector: Rename user_project_permissions → user_workspace_permissions
-- Migration 007 — applied on top of 006_states.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 007_rename_permissions.sql
--
-- Workspace is the top customer-facing container (SPACE-XXXXXXXX).
-- The permissions table was scaffolded in 002 with a dangling
-- `project_id UUID` column and no FK. Nothing references those rows
-- yet, so this is a cheap rename + retype:
--
--   user_project_permissions   → user_workspace_permissions
--   project_id (UUID, no FK)   → workspace_id (UUID, FK to workspace)
--
-- All indexes, the unique constraint, and the updated_at trigger
-- are renamed to match. Existing data (if any) is preserved; the
-- column rename keeps row identity intact.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Rename the table
-- ============================================================
ALTER TABLE user_project_permissions
    RENAME TO user_workspace_permissions;

-- ============================================================
-- 2. Rename the column and add the FK that was deferred in 002
-- ============================================================
ALTER TABLE user_workspace_permissions
    RENAME COLUMN project_id TO workspace_id;

ALTER TABLE user_workspace_permissions
    ADD CONSTRAINT user_workspace_permissions_workspace_fk
        FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE;

-- ============================================================
-- 3. Rename the unique constraint and indexes to match
-- ============================================================
ALTER TABLE user_workspace_permissions
    RENAME CONSTRAINT user_project_permissions_user_id_project_id_key
                   TO user_workspace_permissions_user_id_workspace_id_key;

ALTER INDEX idx_upp_user_id    RENAME TO idx_uwp_user_id;
ALTER INDEX idx_upp_project_id RENAME TO idx_uwp_workspace_id;

-- ============================================================
-- 4. Rename the updated_at trigger
-- ============================================================
ALTER TRIGGER trg_upp_updated_at
    ON user_workspace_permissions
    RENAME TO trg_uwp_updated_at;

COMMIT;
