-- ============================================================
-- 242 DOWN — Remove api_keys.manage permission and its grants.
--
-- Order: grants first, then catalogue row. ON DELETE CASCADE on
-- users_roles_permissions.users_roles_permissions_id_permission
-- would tidy the grants automatically when the catalogue row drops,
-- but explicit deletion is safer in case the FK cascade is ever
-- weakened.
-- ============================================================

BEGIN;

DELETE FROM users_roles_permissions
 WHERE users_roles_permissions_id_permission IN (
     SELECT users_permissions_id FROM users_permissions
      WHERE users_permissions_code = 'api_keys.manage'
 );

DELETE FROM users_permissions
 WHERE users_permissions_code = 'api_keys.manage';

COMMIT;
