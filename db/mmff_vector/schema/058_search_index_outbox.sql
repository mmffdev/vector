-- ============================================================
-- MMFFDev - Vector: Search index outbox (async TSVECTOR + embedding worker)
-- Migration 058 — applied on top of 057_artefact_versions.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 058_search_index_outbox.sql
--
-- R010 §14.5 / R012: outbox pattern replaces bare NOTIFY/LISTEN.
-- At-least-once delivery with restart safety.
--
-- Flow:
--   1. Artefact INSERT/UPDATE trigger writes a row here.
--   2. Trigger fires pg_notify('search_index_queue', '') as wake-up.
--   3. Go worker claims with FOR UPDATE SKIP LOCKED; polls every 5s as fallback.
--   4. Worker deletes row on success; increments attempts on failure.
--
-- Dedup partial index prevents duplicate unclaimed rows for same artefact.
-- ============================================================

BEGIN;

CREATE TABLE o_search_index_outbox (
    id              BIGSERIAL   PRIMARY KEY,
    artefact_type   TEXT        NOT NULL REFERENCES o_artefact_type_registry(scope_key) ON DELETE CASCADE,
    artefact_id     UUID        NOT NULL,
    enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    attempts        INTEGER     NOT NULL DEFAULT 0,
    last_error      TEXT
);

CREATE INDEX idx_o_sio_unclaimed
    ON o_search_index_outbox (enqueued_at)
    WHERE claimed_at IS NULL;

CREATE INDEX idx_o_sio_claimed
    ON o_search_index_outbox (claimed_at)
    WHERE claimed_at IS NOT NULL;

CREATE UNIQUE INDEX idx_o_sio_dedup
    ON o_search_index_outbox (artefact_type, artefact_id)
    WHERE claimed_at IS NULL;

COMMIT;
