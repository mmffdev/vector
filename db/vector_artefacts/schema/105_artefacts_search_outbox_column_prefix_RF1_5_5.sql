-- ============================================================
-- 105_artefacts_search_outbox_column_prefix_RF1_5_5.sql
--
-- RF1.5.5 — Pillar 1 wave 4, table 4/4 (vector_artefacts side).
--
-- Applies the §2.3 column-prefix convention to
-- artefacts_search_outbox (the search-indexer enqueue table —
-- one row per artefact that needs re-indexing into the search
-- corpus; rows are claim-then-delete by the search worker).
--
-- bigserial preservation note: `id` is bigserial, backed by
-- sequence `artefacts_search_outbox_id_seq` with DEFAULT
-- `nextval('artefacts_search_outbox_id_seq'::regclass)`. The
-- DEFAULT and OWNED BY linkage are kept on the renamed column
-- automatically by Postgres because ALTER TABLE RENAME COLUMN
-- preserves column attributes (including the DEFAULT expression
-- that points at the sequence). Sequence itself is NOT renamed
-- here — the sequence name follows the column name in pg_dump
-- output but functionally `artefacts_search_outbox_id_seq` still
-- maps to `artefacts_search_outbox_id` cleanly. Sequence rename
-- can be done later if cosmetic; safe to leave as-is.
--
-- Outbound FK: artefact_id → artefacts(id) ON DELETE CASCADE.
-- Auto-retargets on the source column rename. The target column
-- on `artefacts.id` stays bare here — artefacts is a different
-- wave's table.
--
-- No updated_at trigger on this table (it's an append-claim-delete
-- outbox — claimed_at is the only mutation, set explicitly by the
-- worker). No trigger-function repair needed.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE artefacts_search_outbox RENAME COLUMN id          TO artefacts_search_outbox_id;
ALTER TABLE artefacts_search_outbox RENAME COLUMN artefact_id TO artefacts_search_outbox_id_artefact;
ALTER TABLE artefacts_search_outbox RENAME COLUMN enqueued_at TO artefacts_search_outbox_enqueued_at;
ALTER TABLE artefacts_search_outbox RENAME COLUMN claimed_at  TO artefacts_search_outbox_claimed_at;
ALTER TABLE artefacts_search_outbox RENAME COLUMN attempts    TO artefacts_search_outbox_attempts;
ALTER TABLE artefacts_search_outbox RENAME COLUMN last_error  TO artefacts_search_outbox_last_error;

-- ---- Index renames ----

-- artefacts_search_outbox_pkey already matches the <table>_pkey convention.

ALTER INDEX artefacts_search_outbox_one_per_artefact
    RENAME TO artefacts_search_outbox_id_artefact_unclaimed_unique;

ALTER INDEX artefacts_search_outbox_unclaimed
    RENAME TO idx_artefacts_search_outbox_enqueued_at_unclaimed;

-- ---- Constraint renames ----

ALTER TABLE artefacts_search_outbox
    RENAME CONSTRAINT artefacts_search_outbox_artefact_id_fkey
                  TO artefacts_search_outbox_id_artefact_fkey;

COMMIT;
