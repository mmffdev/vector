-- ============================================================
-- 259_master_record_workspaces_column_prefix_RF1_5_5.sql
--
-- RF1.5.5 — Pillar 1 wave 4, table 3/4 (mmff_vector side).
--
-- Applies the §2.3 column-prefix convention to
-- mmff_vector.master_record_workspaces (the workspace registry —
-- holds 30 live rows; FK target for users_roles_workspaces).
--
-- SPECIAL CASE: column names land EXACTLY on the Pillar-2 fold
-- target shape so the eventual cross-DB UPDATE/INSERT into
-- vector_artefacts.master_record_workspaces (the 17-column
-- settings sidecar) is a name-for-name match. The fold target
-- column names are locked in handovers/refactorDB.md §"Master
-- Record Workspaces fold" (2026-05-26). Specifically:
--   created_by  → master_record_workspaces_id_user_created_by
--   archived_by → master_record_workspaces_id_user_archived_by
-- (NOT `_created_by_user` or `_creator_id` — the role suffix
--  goes after the target table; this matches §2.4 + the
--  cost_centres precedent in migration 251.)
--
-- Inbound FK: users_roles_workspaces.users_roles_workspaces_id_workspace
-- → master_record_workspaces(id) — auto-retargets on PK column
-- rename (FKs track column oid, not name).
--
-- Outbound: subscription_id → subscriptions(id),
-- created_by + archived_by → users(id). All auto-retarget on the
-- source column rename here. Target column names on parent tables
-- stay bare — those are different waves.
--
-- Trigger `trg_master_record_workspaces_updated_at` currently
-- calls the shared `set_updated_at()` function; trigger-function
-- repair happens in migration 260 in this same wave.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE master_record_workspaces RENAME COLUMN id              TO master_record_workspaces_id;
ALTER TABLE master_record_workspaces RENAME COLUMN subscription_id TO master_record_workspaces_id_subscription;
ALTER TABLE master_record_workspaces RENAME COLUMN name            TO master_record_workspaces_name;
ALTER TABLE master_record_workspaces RENAME COLUMN slug            TO master_record_workspaces_slug;
ALTER TABLE master_record_workspaces RENAME COLUMN description     TO master_record_workspaces_description;
ALTER TABLE master_record_workspaces RENAME COLUMN created_by      TO master_record_workspaces_id_user_created_by;
ALTER TABLE master_record_workspaces RENAME COLUMN created_at      TO master_record_workspaces_created_at;
ALTER TABLE master_record_workspaces RENAME COLUMN updated_at      TO master_record_workspaces_updated_at;
ALTER TABLE master_record_workspaces RENAME COLUMN archived_at     TO master_record_workspaces_archived_at;
ALTER TABLE master_record_workspaces RENAME COLUMN archived_by     TO master_record_workspaces_id_user_archived_by;

-- ---- Index renames ----

-- master_record_workspaces_pkey already matches the <table>_pkey convention.
ALTER INDEX master_record_workspaces_subscription_idx
    RENAME TO idx_master_record_workspaces_id_subscription;

ALTER INDEX master_record_workspaces_subscription_slug_live
    RENAME TO master_record_workspaces_id_subscription_slug_live_unique;

-- ---- Constraint renames ----

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT master_record_workspaces_archived_pair
                  TO master_record_workspaces_archived_pair_chk;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT workspaces_name_check
                  TO master_record_workspaces_name_chk;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT workspaces_slug_check
                  TO master_record_workspaces_slug_chk;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT workspaces_archived_by_fkey
                  TO master_record_workspaces_id_user_archived_by_fkey;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT workspaces_created_by_fkey
                  TO master_record_workspaces_id_user_created_by_fkey;

ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT workspaces_subscription_id_fkey
                  TO master_record_workspaces_id_subscription_fkey;

COMMIT;
