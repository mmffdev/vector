-- Migration 235: Move the four avatar-bucket pages under /user/.
--
-- Pairs with the file move from app/(user)/<page>/ to app/user/<page>/
-- (the parens vs no-parens distinction in Next.js: (user) is a route
-- group that doesn't appear in the URL, app/user/ is a literal segment).
-- The avatar bucket now has its own URL namespace.
--
-- Routes flipped:
--   /account-settings  → /user/account-settings
--   /navigation        → /user/navigation
--   /theme             → /user/theme
--   /notifications     → /user/notifications
--
-- Page key_enums are NOT changed (binds in 199_seed_role_page_grants_locked.sql
-- and elsewhere reference pages by key_enum). Only href flips.
--
-- Idempotent: each UPDATE is gated by the old href value so re-running is
-- a no-op once the row has the new href.

BEGIN;

-- 1. Update pages.href for all four avatar-bucket pages.
UPDATE pages SET href = '/user/account-settings', updated_at = NOW()
 WHERE key_enum = 'account-settings' AND href = '/account-settings';

UPDATE pages SET href = '/user/navigation', updated_at = NOW()
 WHERE key_enum = 'preferences-navigation' AND href = '/navigation';

UPDATE pages SET href = '/user/theme', updated_at = NOW()
 WHERE key_enum = 'theme' AND href = '/theme';

UPDATE pages SET href = '/user/notifications', updated_at = NOW()
 WHERE key_enum = 'notifications-manager' AND href = '/notifications';

-- 2. Update pages_addressables.page_route rows that hard-code any of the
--    four old routes (or their sub-paths for account-settings).
UPDATE pages_addressables
   SET pages_addressables_page_route = '/user/account-settings'
 WHERE pages_addressables_page_route = '/account-settings';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/user/account-settings/mfa'
 WHERE pages_addressables_page_route = '/account-settings/mfa';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/user/account-settings/sessions'
 WHERE pages_addressables_page_route = '/account-settings/sessions';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/user/navigation'
 WHERE pages_addressables_page_route = '/navigation';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/user/theme'
 WHERE pages_addressables_page_route = '/theme';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/user/notifications'
 WHERE pages_addressables_page_route = '/notifications';

COMMIT;
