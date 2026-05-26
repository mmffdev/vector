-- ============================================================
-- 099_artefacts_adoption_states_column_prefix_RF1_5_3.sql
--
-- RF1.5.3 — Pillar 1 wave 3, table 1/5 (vector_artefacts side).
--
-- Applies the §2.3 column-prefix convention to artefacts_adoption_states.
-- PK `id` becomes `artefacts_adoption_states_id`. All FK-shaped columns
-- (workspace_id / subscription_id / model_id / adopted_by_user_id) are
-- app-soft references — Postgres can't enforce FKs across DBs, and
-- `model_id` references `artefacts_types(artefacts_types_id)` natively
-- but is declared without a hard FK on this table. All follow §2.4 FK
-- shape `<table>_id_<target>[_<role>]`:
--   workspace_id        → artefacts_adoption_states_id_workspace
--   subscription_id     → artefacts_adoption_states_id_subscription
--   model_id            → artefacts_adoption_states_id_model
--   adopted_by_user_id  → artefacts_adoption_states_id_user_adopted_by
--     (target = users, role = adopted_by)
--
-- Trigger `trg_artefact_adoption_state_updated_at` calls the bespoke
-- function `artefact_adoption_state_set_updated_at()` which still
-- references `NEW.updated_at` — wave 1 precedent leaves trigger function
-- bodies alone (same caveat applies to `set_updated_at()` shared across
-- many tables). Function-body sweep is tracked separately.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE artefacts_adoption_states RENAME COLUMN id                 TO artefacts_adoption_states_id;
ALTER TABLE artefacts_adoption_states RENAME COLUMN workspace_id       TO artefacts_adoption_states_id_workspace;
ALTER TABLE artefacts_adoption_states RENAME COLUMN subscription_id    TO artefacts_adoption_states_id_subscription;
ALTER TABLE artefacts_adoption_states RENAME COLUMN model_id           TO artefacts_adoption_states_id_model;
ALTER TABLE artefacts_adoption_states RENAME COLUMN adopted_by_user_id TO artefacts_adoption_states_id_user_adopted_by;
ALTER TABLE artefacts_adoption_states RENAME COLUMN adopted_at         TO artefacts_adoption_states_adopted_at;
ALTER TABLE artefacts_adoption_states RENAME COLUMN status             TO artefacts_adoption_states_status;
ALTER TABLE artefacts_adoption_states RENAME COLUMN archived_at        TO artefacts_adoption_states_archived_at;
ALTER TABLE artefacts_adoption_states RENAME COLUMN created_at         TO artefacts_adoption_states_created_at;
ALTER TABLE artefacts_adoption_states RENAME COLUMN updated_at         TO artefacts_adoption_states_updated_at;

-- ---- Index renames ----

ALTER INDEX artefact_adoption_state_pkey
    RENAME TO artefacts_adoption_states_pkey;

ALTER INDEX idx_artefact_adoption_state_subscription_id
    RENAME TO idx_artefacts_adoption_states_id_subscription;

ALTER INDEX idx_artefact_adoption_state_workspace_active
    RENAME TO idx_artefacts_adoption_states_id_workspace_active;

ALTER INDEX idx_artefact_adoption_state_workspace_id
    RENAME TO idx_artefacts_adoption_states_id_workspace;

-- ---- Constraint renames ----

ALTER TABLE artefacts_adoption_states
    RENAME CONSTRAINT artefact_adoption_state_status_check
                  TO artefacts_adoption_states_status_chk;

COMMIT;
