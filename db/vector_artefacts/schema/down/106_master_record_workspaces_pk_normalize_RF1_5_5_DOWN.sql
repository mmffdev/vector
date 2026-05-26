-- ============================================================
-- 106_master_record_workspaces_pk_normalize_RF1_5_5_DOWN.sql
--
-- Reverses 106_master_record_workspaces_pk_normalize_RF1_5_5.sql.
-- ============================================================

BEGIN;

-- ---- PK column rename (reverse) ----

ALTER TABLE master_record_workspaces
    RENAME COLUMN master_record_workspaces_id
              TO master_record_workspaces_id_workspace;

COMMIT;
