-- ============================================================
-- 105_artefacts_search_outbox_column_prefix_RF1_5_5_DOWN.sql
--
-- Reverses 105_artefacts_search_outbox_column_prefix_RF1_5_5.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE artefacts_search_outbox
    RENAME CONSTRAINT artefacts_search_outbox_id_artefact_fkey
                  TO artefacts_search_outbox_artefact_id_fkey;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_artefacts_search_outbox_enqueued_at_unclaimed
    RENAME TO artefacts_search_outbox_unclaimed;

ALTER INDEX artefacts_search_outbox_id_artefact_unclaimed_unique
    RENAME TO artefacts_search_outbox_one_per_artefact;

-- ---- Column renames (reverse) ----

ALTER TABLE artefacts_search_outbox RENAME COLUMN artefacts_search_outbox_last_error  TO last_error;
ALTER TABLE artefacts_search_outbox RENAME COLUMN artefacts_search_outbox_attempts    TO attempts;
ALTER TABLE artefacts_search_outbox RENAME COLUMN artefacts_search_outbox_claimed_at  TO claimed_at;
ALTER TABLE artefacts_search_outbox RENAME COLUMN artefacts_search_outbox_enqueued_at TO enqueued_at;
ALTER TABLE artefacts_search_outbox RENAME COLUMN artefacts_search_outbox_id_artefact TO artefact_id;
ALTER TABLE artefacts_search_outbox RENAME COLUMN artefacts_search_outbox_id          TO id;

COMMIT;
