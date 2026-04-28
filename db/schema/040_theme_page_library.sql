-- ============================================================
-- MMFFDev - Vector: Move Theme page to the page library.
-- Migration 040 — applied on top of 039_user_theme_pack.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 040_theme_page_library.sql
--
-- The avatar-menu palette flyout has been removed. The Theme page
-- is now a direct link in the avatar menu AND a first-class page
-- in the library that users can pin to their sidebar if they want.
--
-- Changes:
--   1. Move theme page from personal_settings (is_admin_menu=TRUE)
--      to personal (is_admin_menu=FALSE) so it appears in the
--      Available pool in nav preferences.
--   2. Set pinnable=TRUE so users can pin it.
--   3. default_pinned remains FALSE — not pinned out of the box.
-- ============================================================

BEGIN;

UPDATE pages
   SET tag_enum      = 'personal',
       pinnable      = TRUE,
       default_order = 99,
       updated_at    = NOW()
 WHERE key_enum = 'theme'
   AND created_by IS NULL
   AND subscription_id IS NULL;

COMMIT;
