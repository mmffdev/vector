-- TD-RAIL-ADMIN-TAGS (2026-05-19) — primary nav rail was showing
-- "User Management", "Vector Admin", "Workspace Admin", "Dev Tools"
-- alongside the user-facing buckets (Personal, Planning, Strategy, …).
--
-- ShellContext (app/redesign/ShellContext.tsx) already filters
-- pages_tags rows with is_admin_menu = TRUE off the primary rail and
-- routes them through the avatar/cog menu instead — but only
-- 'notifications' and 'avatar_menu' carried that flag. The four
-- admin-surface tags shipped with FALSE and so leaked onto the rail.
--
-- Reclassify so the rail honours the original is_admin_menu contract.
-- Pages under these tags are still reachable via the admin avatar menu
-- (UserAvatarMenu) which filters on the same flag; role gating on the
-- pages themselves stays server-side and unchanged.

BEGIN;

UPDATE pages_tags
SET pages_tags_is_admin_menu = TRUE
WHERE pages_tags_tag_enum IN (
    'user_management',
    'vector_admin',
    'workspace_admin',
    'dev_tools'
);

COMMIT;
