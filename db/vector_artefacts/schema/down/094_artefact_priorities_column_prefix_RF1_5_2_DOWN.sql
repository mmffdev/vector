-- ============================================================
-- 094_artefact_priorities_column_prefix_RF1_5_2_DOWN.sql
--
-- Reverses 094_artefact_priorities_column_prefix_RF1_5_2.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE artefact_priorities
    RENAME CONSTRAINT artefact_priorities_slot_chk
                  TO artefact_priorities_slot_vocab_chk;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_artefact_priorities_id_workspace
    RENAME TO artefact_priorities_workspace_live_idx;

ALTER INDEX artefact_priorities_id_workspace_slot_unique
    RENAME TO artefact_priorities_slot_per_workspace_uniq;

-- ---- Column renames (reverse) ----

ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_updated_at      TO updated_at;
ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_created_at      TO created_at;
ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_archived_at     TO archived_at;
ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_colour          TO colour;
ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_sort_order      TO sort_order;
ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_slot            TO slot;
ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_name            TO name;
ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_id_workspace    TO workspace_id;
ALTER TABLE artefact_priorities RENAME COLUMN artefact_priorities_id              TO id;

COMMIT;
