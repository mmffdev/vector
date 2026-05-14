-- ============================================================
-- MMFFDev - Vector: Restore Portfolio to top-level /portfolio route
-- Migration 160
--
-- Migration 159 moved /portfolio under /planning/portfolio, but
-- Portfolio is a top-level destination (sibling of Backlog,
-- Planning, etc.) — not a nested page under Planning. Restore
-- the canonical /portfolio href.
-- ============================================================

BEGIN;

UPDATE pages
   SET href = '/portfolio'
 WHERE key_enum         = 'portfolio'
   AND subscription_id IS NULL
   AND created_by      IS NULL;

COMMIT;
