-- ============================================================
-- 095_artefacts_number_sequences_column_prefix_RF1_5_2.sql
--
-- RF1.5.2 — Pillar 1 wave 2, table 2/5.
--
-- Applies the §2.3 column-prefix convention to artefacts_number_sequences.
-- Composite-PK table (no `id` column): the PK is (subscription_id,
-- artefact_type_id), so there is no `<table>_id` to mint — both PK
-- columns follow the §2.4 FK shape `<table>_id_<target>` instead.
--
-- Legacy `artefact_number_sequence_*` (singular) constraint names
-- get normalised to `artefacts_number_sequences_*` (plural — matches
-- the table name; mirrors the wave-1 users_tab_order precedent).
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE artefacts_number_sequences RENAME COLUMN subscription_id  TO artefacts_number_sequences_id_subscription;
ALTER TABLE artefacts_number_sequences RENAME COLUMN artefact_type_id TO artefacts_number_sequences_id_artefact_type;
ALTER TABLE artefacts_number_sequences RENAME COLUMN next_num         TO artefacts_number_sequences_next_num;

-- ---- Constraint renames (also renames the backing index for the PK) ----

ALTER TABLE artefacts_number_sequences
    RENAME CONSTRAINT artefact_number_sequence_pkey
                  TO artefacts_number_sequences_pkey;

ALTER TABLE artefacts_number_sequences
    RENAME CONSTRAINT artefact_number_sequence_artefact_type_id_fkey
                  TO artefacts_number_sequences_id_artefact_type_fkey;

COMMIT;
