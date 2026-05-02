-- 081_addressables_helpable.sql
-- PLA-0006 / 00265 — DB-driven helpable toggle on page_addressables.
--
-- Adds a per-row helpable column so gadmin can hide the help icon on
-- specific addressables without touching code. Default TRUE preserves
-- the Panel/Header behaviour. Backfill sets FALSE for Table and
-- Navigation kinds where the prior adopter code hard-coded no help
-- icon — keeping post-migration UX byte-identical.

BEGIN;

ALTER TABLE page_addressables
  ADD COLUMN helpable BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE page_addressables
   SET helpable = FALSE
 WHERE kind IN ('table', 'navigation')
   AND soft_archived = FALSE;

COMMIT;
