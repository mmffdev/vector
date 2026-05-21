-- DOWN for migration 235: revert the four avatar-bucket pages back to
-- their flat (no /user/) hrefs and roll pages_addressables routes back.

BEGIN;

UPDATE pages SET href = '/account-settings', updated_at = NOW()
 WHERE key_enum = 'account-settings' AND href = '/user/account-settings';

UPDATE pages SET href = '/navigation', updated_at = NOW()
 WHERE key_enum = 'preferences-navigation' AND href = '/user/navigation';

UPDATE pages SET href = '/theme', updated_at = NOW()
 WHERE key_enum = 'theme' AND href = '/user/theme';

UPDATE pages SET href = '/notifications', updated_at = NOW()
 WHERE key_enum = 'notifications-manager' AND href = '/user/notifications';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/account-settings'
 WHERE pages_addressables_page_route = '/user/account-settings';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/account-settings/mfa'
 WHERE pages_addressables_page_route = '/user/account-settings/mfa';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/account-settings/sessions'
 WHERE pages_addressables_page_route = '/user/account-settings/sessions';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/navigation'
 WHERE pages_addressables_page_route = '/user/navigation';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/theme'
 WHERE pages_addressables_page_route = '/user/theme';

UPDATE pages_addressables
   SET pages_addressables_page_route = '/notifications'
 WHERE pages_addressables_page_route = '/user/notifications';

COMMIT;
