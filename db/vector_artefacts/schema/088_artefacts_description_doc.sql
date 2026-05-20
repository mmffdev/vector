-- ============================================================
-- 088_artefacts_description_doc.sql
--
-- Adds `description_doc JSONB` alongside the existing `description TEXT`
-- on vector_artefacts.artefacts. Hosts the TipTap (ProseMirror) JSON
-- document used by the new RichTextField component. The legacy
-- `description TEXT` column stays as a plain-text fallback for callers
-- that haven't migrated yet (search index, read-only list cells, the
-- siteAPI summary projection, etc.).
--
-- WHY:
--   The new ArtefactInlineForm uses a TipTap-backed RichTextField to
--   edit description. Storing the editor's native JSON doc is safer
--   (no HTML round-trip / XSS surface) and lossless (schema validates
--   marks/nodes on the way in). The TEXT column becomes a read-side
--   derivative — populated by the writer on save (TipTap getText()),
--   not a primary source of truth.
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS. Re-runnable.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/088_artefacts_description_doc_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS description_doc JSONB;

COMMENT ON COLUMN artefacts.description_doc IS
    'TipTap/ProseMirror JSON document for the rich-text description. '
    'When set, takes precedence over the legacy `description TEXT` column. '
    'Schema validation is enforced application-side by the TipTap '
    'extension set used by the RichTextField component.';

-- GIN index on the doc for future jsonpath / contains queries (e.g.
-- "find every artefact that mentions @alice in its description").
-- Partial — skip null docs so the index stays small.
CREATE INDEX IF NOT EXISTS artefacts_description_doc_gin
    ON artefacts USING GIN (description_doc)
    WHERE description_doc IS NOT NULL
      AND archived_at IS NULL;

COMMIT;
