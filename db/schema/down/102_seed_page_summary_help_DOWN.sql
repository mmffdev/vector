-- ============================================================
-- Rollback for migration 102 (PLA-0012 / 00400)
--
-- Removes the panel.page_summary library_help_defaults seed. Any
-- page_help rows that were seeded from this default keep their
-- copy (library_ref FK is ON DELETE SET NULL) — only the canonical
-- default row is dropped.
-- ============================================================

BEGIN;

DELETE FROM library_help_defaults
 WHERE kind = 'panel'
   AND name_pattern = 'page_summary'
   AND locale = 'en';

COMMIT;
