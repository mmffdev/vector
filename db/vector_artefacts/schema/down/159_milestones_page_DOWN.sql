-- ============================================================
-- 159_milestones_page_DOWN.sql
--
-- Reverse of 159_milestones_page.sql. Deletes inner-most first so
-- the page row drops cleanly at the end.
-- ============================================================

BEGIN;

-- ── 1. Remove pinned rows for this page key. ────────────────────
DELETE FROM users_nav_pinned
 WHERE users_nav_pinned_item_key = 'milestones';

-- ── 2. Remove role grants for the system 'milestones' page. ─────
DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
    SELECT pages_id FROM pages
     WHERE pages_key_enum        = 'milestones'
       AND pages_id_subscription IS NULL
       AND pages_id_user_creator IS NULL
 );

-- ── 3. Remove the page row. ─────────────────────────────────────
DELETE FROM pages
 WHERE pages_key_enum        = 'milestones'
   AND pages_id_subscription IS NULL
   AND pages_id_user_creator IS NULL;

COMMIT;
