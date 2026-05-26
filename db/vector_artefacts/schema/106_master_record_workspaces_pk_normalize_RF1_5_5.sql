-- ============================================================
-- 106_master_record_workspaces_pk_normalize_RF1_5_5.sql
--
-- RF1.5.5 — Pillar 1 wave 4, PK normalization on
-- vector_artefacts.master_record_workspaces.
--
-- Renames the PK column `master_record_workspaces_id_workspace`
-- → `master_record_workspaces_id` per §2.4 (canonical PK shape is
-- `<table>_id`). The `_id_workspace` form was a pre-existing
-- deviation from a Pillar-0 sweep; this brings VA's MRW PK into
-- line with the rule.
--
-- The other 16 columns on this table are already correctly
-- prefixed and are NOT touched by this migration.
--
-- Inbound FKs: none in vector_artefacts (verified 2026-05-26 via
-- pg_constraint WHERE confrelid = 'master_record_workspaces'::regclass
-- — 0 rows). The Pillar 2 fold will add new columns and copy data
-- from mmff_vector; those happen in a separate migration after
-- this PK normalize.
--
-- Trigger function `fn_master_record_workspaces_touch_updated_at`
-- already references `master_record_workspaces_updated_at` (not
-- the renamed PK column) — verified by inspecting pg_get_functiondef
-- 2026-05-26. No trigger-function repair needed.
-- ============================================================

BEGIN;

-- ---- PK column rename ----

ALTER TABLE master_record_workspaces
    RENAME COLUMN master_record_workspaces_id_workspace
              TO master_record_workspaces_id;

-- ---- Index renames ----

-- master_record_workspaces_pkey already matches the <table>_pkey
-- convention; no rename required. The PK index continues to back
-- the (renamed) column automatically.

-- ---- Constraint renames ----

-- No FK constraints reference the renamed column (verified above).
-- No CHECK constraint references it. Nothing to rename.

COMMIT;
