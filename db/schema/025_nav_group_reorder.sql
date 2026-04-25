-- ============================================================
-- MMFFDev - Vector: Nav group reorder + account-settings sidebar removal
-- Migration 025 — applied on top of 024_backfill_portfolio_model_pin.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 025_nav_group_reorder.sql
--
-- Two changes:
--
-- 1. Tag ordering — sidebar group sequence becomes:
--      Personal (0) → Admin Settings (1) → Planning (2) → Strategic (3)
--    personal_settings stays admin-menu-only (avatar dropdown), no order change needed.
--    bookmarks tag is entity-only (no pinnable static pages), left at 0 as a tie.
--
-- 2. account-settings — avatar dropdown only.
--    Already tag_enum='personal_settings' (is_admin_menu=TRUE), so it already
--    appears in the avatar. Remove it from the sidebar by setting
--    default_pinned=FALSE and pinnable=FALSE so it cannot be re-pinned by
--    users and will not be backfilled by the nav backfill logic.
--    Existing user_nav_prefs rows for 'account-settings' are hard-deleted
--    to clear it from live sidebars immediately.
-- ============================================================

BEGIN;

-- 1. Reorder tag groups
--    Desired sidebar sequence: Personal(0) → Admin Settings(1) → Planning(2) → Strategic(3)
--    bookmarks tag is entity-only (no pinnable static pages); sits at 0 as a tie — harmless.
--    personal_settings is avatar-only (is_admin_menu=TRUE); no sidebar order needed.
UPDATE page_tags SET default_order = 0 WHERE tag_enum = 'personal';
UPDATE page_tags SET default_order = 1 WHERE tag_enum = 'admin_settings';
UPDATE page_tags SET default_order = 2 WHERE tag_enum = 'planning';
UPDATE page_tags SET default_order = 3 WHERE tag_enum = 'strategic';

-- 2. account-settings: avatar-only
UPDATE pages
SET default_pinned = FALSE,
    pinnable       = FALSE
WHERE key_enum = 'account-settings'
  AND subscription_id IS NULL
  AND created_by IS NULL;

-- Remove from every user's pinned sidebar (hard-delete; they keep it via avatar)
DELETE FROM user_nav_prefs WHERE item_key = 'account-settings';

COMMIT;
