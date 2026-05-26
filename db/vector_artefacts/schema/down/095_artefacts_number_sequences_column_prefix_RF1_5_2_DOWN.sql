-- ============================================================
-- 095_artefacts_number_sequences_column_prefix_RF1_5_2_DOWN.sql
--
-- Reverses 095_artefacts_number_sequences_column_prefix_RF1_5_2.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE artefacts_number_sequences
    RENAME CONSTRAINT artefacts_number_sequences_id_artefact_type_fkey
                  TO artefact_number_sequence_artefact_type_id_fkey;

ALTER TABLE artefacts_number_sequences
    RENAME CONSTRAINT artefacts_number_sequences_pkey
                  TO artefact_number_sequence_pkey;

-- ---- Column renames (reverse) ----

ALTER TABLE artefacts_number_sequences RENAME COLUMN artefacts_number_sequences_next_num             TO next_num;
ALTER TABLE artefacts_number_sequences RENAME COLUMN artefacts_number_sequences_id_artefact_type     TO artefact_type_id;
ALTER TABLE artefacts_number_sequences RENAME COLUMN artefacts_number_sequences_id_subscription      TO subscription_id;

COMMIT;
