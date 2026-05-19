-- PLA-0006 / 00312 — tighten org_nodes.description.
--
-- The column was created in 082 as nullable TEXT. The flyout's
-- write-through edit path treats description as a first-class
-- editable field, so:
--   - DEFAULT ''  so newly-spawned nodes don't have a NULL slot
--                 the UI has to special-case.
--   - NOT NULL    so client + server agree on the empty-string
--                 representation; the UI renders '' as "no
--                 description yet" without a null-vs-empty branch.
--
-- Backfill any pre-existing NULLs to '' before the constraint flip.

BEGIN;

UPDATE org_nodes SET description = '' WHERE description IS NULL;

ALTER TABLE org_nodes
    ALTER COLUMN description SET DEFAULT '',
    ALTER COLUMN description SET NOT NULL;

COMMIT;
