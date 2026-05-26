-- ============================================================
-- 094_artefact_priorities_column_prefix_RF1_5_2.sql
--
-- RF1.5.2 — Pillar 1 wave 2, table 1/5 (vector_artefacts side).
--
-- Applies the §2.3 column-prefix convention to artefact_priorities.
-- PK `id` becomes `artefact_priorities_id`; the soft `workspace_id`
-- (no Postgres FK — workspaces lives in mmff_vector) follows §2.4
-- shape: `artefact_priorities_id_workspace`.
--
-- Inbound FK from artefacts.priority_id → artefact_priorities(id) is
-- automatically retargeted by Postgres on PK column rename (FKs track
-- column oid, not name). The legacy `artefacts.priority_id` column
-- name itself stays bare here — `artefacts` is a different wave.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE artefact_priorities RENAME COLUMN id           TO artefact_priorities_id;
ALTER TABLE artefact_priorities RENAME COLUMN workspace_id TO artefact_priorities_id_workspace;
ALTER TABLE artefact_priorities RENAME COLUMN name         TO artefact_priorities_name;
ALTER TABLE artefact_priorities RENAME COLUMN slot         TO artefact_priorities_slot;
ALTER TABLE artefact_priorities RENAME COLUMN sort_order   TO artefact_priorities_sort_order;
ALTER TABLE artefact_priorities RENAME COLUMN colour       TO artefact_priorities_colour;
ALTER TABLE artefact_priorities RENAME COLUMN archived_at  TO artefact_priorities_archived_at;
ALTER TABLE artefact_priorities RENAME COLUMN created_at   TO artefact_priorities_created_at;
ALTER TABLE artefact_priorities RENAME COLUMN updated_at   TO artefact_priorities_updated_at;

-- ---- Index renames ----

ALTER INDEX artefact_priorities_slot_per_workspace_uniq
    RENAME TO artefact_priorities_id_workspace_slot_unique;

ALTER INDEX artefact_priorities_workspace_live_idx
    RENAME TO idx_artefact_priorities_id_workspace;

-- ---- Constraint renames ----

ALTER TABLE artefact_priorities
    RENAME CONSTRAINT artefact_priorities_slot_vocab_chk
                  TO artefact_priorities_slot_chk;

-- artefact_priorities_pkey already matches <table>_pkey convention — left untouched.

COMMIT;
