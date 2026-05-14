-- ============================================================
-- MMFFDev - Vector: Suppress admin_settings tag from rail
-- Migration 156
--
-- All pages tagged admin_settings live in named nav groups
-- (Workspace Admin, User Management, Vector Admin). The tag
-- bucket itself should never appear as a rail section.
--
-- Set is_admin_menu = TRUE so ShellContext skips it from both
-- the rail section list and the fallback path. AccountFlyout
-- already guards against admin_settings explicitly so it won't
-- appear there either.
--
-- Also remove any user_nav_profile_groups placements for
-- admin_settings — the ON DELETE CASCADE would handle a row
-- deletion, but since we're keeping the row we clean manually.
-- ============================================================

BEGIN;

UPDATE page_tags
SET is_admin_menu = TRUE
WHERE tag_enum = 'admin_settings';

DELETE FROM user_nav_profile_groups
WHERE tag_enum = 'admin_settings';

COMMIT;
