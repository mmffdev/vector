-- ============================================================
-- MMFFDev - Vector: Lock Theme to avatar menu; route product
-- bookmarks to the Strategic group.
-- Migration 033 — applied on top of 032_drop_pre_adoption_item_types.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 033_theme_unpinnable_product_strategic.sql
--
-- Two changes:
--   1. Theme remains a real page (/theme) but stops appearing in the
--      "Available" pool of nav preferences. The avatar dropdown reads
--      from page_tags.is_admin_menu, not pinnable, so Theme stays in
--      the menu while disappearing from the catalogue Available list.
--   2. Bookmarked product entities move from the Bookmarks group to
--      Strategic by default. Portfolio bookmarks are unchanged.
-- ============================================================

BEGIN;

-- 1. Theme: lock to avatar menu only.
UPDATE pages
   SET pinnable = FALSE,
       updated_at = NOW()
 WHERE key_enum = 'theme'
   AND created_by IS NULL
   AND subscription_id IS NULL;

-- 2. Existing product bookmarks: relocate to 'strategic'.
UPDATE pages
   SET tag_enum = 'strategic',
       updated_at = NOW()
 WHERE kind = 'entity'
   AND key_enum LIKE 'entity:product:%'
   AND tag_enum = 'bookmarks';

COMMIT;
