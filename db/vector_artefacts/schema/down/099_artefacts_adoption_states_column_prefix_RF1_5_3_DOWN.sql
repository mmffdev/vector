-- ============================================================
-- 099_artefacts_adoption_states_column_prefix_RF1_5_3_DOWN.sql
--
-- Reverses 099_artefacts_adoption_states_column_prefix_RF1_5_3.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE artefacts_adoption_states
    RENAME CONSTRAINT artefacts_adoption_states_status_chk
                  TO artefact_adoption_state_status_check;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_artefacts_adoption_states_id_workspace
    RENAME TO idx_artefact_adoption_state_workspace_id;

ALTER INDEX idx_artefacts_adoption_states_id_workspace_active
    RENAME TO idx_artefact_adoption_state_workspace_active;

ALTER INDEX idx_artefacts_adoption_states_id_subscription
    RENAME TO idx_artefact_adoption_state_subscription_id;

ALTER INDEX artefacts_adoption_states_pkey
    RENAME TO artefact_adoption_state_pkey;

-- ---- Column renames (reverse) ----

ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_updated_at           TO updated_at;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_created_at           TO created_at;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_archived_at          TO archived_at;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_status               TO status;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_adopted_at           TO adopted_at;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_id_user_adopted_by   TO adopted_by_user_id;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_id_model             TO model_id;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_id_subscription      TO subscription_id;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_id_workspace         TO workspace_id;
ALTER TABLE artefacts_adoption_states RENAME COLUMN artefacts_adoption_states_id                   TO id;

COMMIT;
