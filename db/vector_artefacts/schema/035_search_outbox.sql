-- ============================================================
-- MMFFDev - vector_artefacts: Search index columns + outbox
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 035_search_outbox.sql
--
-- Rewires B7.1.1: search worker now reads from vector_artefacts
-- instead of the legacy mmff_vector DB.
--
-- Adds:
--   1. pgvector extension (enables vector column type)
--   2. search_index   (tsvector) on artefacts — fulltext
--   3. content_embedding (vector(768)) on artefacts — semantic
--   4. artefacts_search_outbox — delivery queue for the worker
--   5. Trigger: artefacts_search_enqueue fires on INSERT/UPDATE
--      of title/description/content, enqueues an outbox row,
--      and pg_notify('search_index_queue') for fast wake-up.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- Fulltext + embedding columns on artefacts.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS search_index       TSVECTOR,
    ADD COLUMN IF NOT EXISTS content_embedding  vector(768);

CREATE INDEX IF NOT EXISTS artefacts_search_gist
    ON artefacts USING GIN (search_index)
    WHERE search_index IS NOT NULL;

-- Outbox table — at-least-once delivery queue.
-- claimed_at is set while the worker holds the row; cleared on failure.
-- Rows are deleted on success.
CREATE TABLE IF NOT EXISTS artefacts_search_outbox (
    id          BIGSERIAL PRIMARY KEY,
    artefact_id UUID      NOT NULL REFERENCES artefacts(id) ON DELETE CASCADE,
    enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at  TIMESTAMPTZ,
    attempts    INT         NOT NULL DEFAULT 0,
    last_error  TEXT
);

CREATE INDEX IF NOT EXISTS artefacts_search_outbox_unclaimed
    ON artefacts_search_outbox (enqueued_at)
    WHERE claimed_at IS NULL;

-- Trigger function: upsert an outbox row and wake the worker.
-- One pending row per artefact — duplicate inserts are collapsed via
-- ON CONFLICT so a burst of rapid edits produces one indexing job.
CREATE OR REPLACE FUNCTION artefacts_search_enqueue()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO artefacts_search_outbox (artefact_id)
    VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
    PERFORM pg_notify('search_index_queue', NEW.id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE UNIQUE INDEX IF NOT EXISTS artefacts_search_outbox_one_per_artefact
    ON artefacts_search_outbox (artefact_id)
    WHERE claimed_at IS NULL;

DROP TRIGGER IF EXISTS artefacts_search_enqueue ON artefacts;
CREATE TRIGGER artefacts_search_enqueue
    AFTER INSERT OR UPDATE OF title, description
    ON artefacts
    FOR EACH ROW EXECUTE FUNCTION artefacts_search_enqueue();

COMMIT;
