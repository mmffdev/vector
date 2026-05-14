-- ============================================================
-- MMFFDev - Vector: Move Portfolio page under Planning
-- Migration 159
--
-- The Portfolio page (key_enum = 'portfolio') was seeded with href
-- '/portfolio' but no top-level /portfolio route ever existed,
-- producing a 404 on click. Move it under Planning where it
-- logically belongs: /planning/portfolio.
-- ============================================================

BEGIN;

UPDATE pages
   SET href = '/planning/portfolio'
 WHERE key_enum         = 'portfolio'
   AND subscription_id IS NULL
   AND created_by      IS NULL;

COMMIT;
