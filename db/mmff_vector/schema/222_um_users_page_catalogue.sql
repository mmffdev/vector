-- B20.4.1 (2026-05-19) — User Management tab-bar restructure (PLA-frozen,
-- tracked as scope ref B20.4.1).
--
-- /user-management is now a tab-bar landing surface; the user list moved
-- to /user-management/users. Old `pages` catalogue rows reference the
-- old shape (only `um-permissions` exists today). This migration adds
-- a new `um-users` page row pointing at /user-management/users and
-- grants it to the same roles that already hold `um-permissions`
-- (portfolio_manager, product_owner, grp_global) so the nav landing
-- works for every admin role on first reload.
--
-- Forward-only: no destructive changes; adds one row + N grant rows.

BEGIN;

-- 1. Insert the um-users page row (catalogue entry).
--    Same shape as um-permissions: tag_enum='user_management', kind='static',
--    pinnable + default_pinned so it appears as the first user-management
--    page in the nav rail (default_order=0 so it sorts before
--    um-permissions at order=1).
--
--    ON CONFLICT references the partial unique index for system pages
--    (pages_unique_key_system) since this is a system-scope row
--    (created_by IS NULL AND subscription_id IS NULL). The matching
--    WHERE-clause predicate is required by Postgres to resolve which
--    partial index satisfies the conflict target.
INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES ('um-users', 'Users', '/user-management/users', 'users', 'user_management', 'static', TRUE, TRUE, 0)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO UPDATE
  SET href           = EXCLUDED.href,
      label          = EXCLUDED.label,
      icon           = EXCLUDED.icon,
      tag_enum       = EXCLUDED.tag_enum,
      kind           = EXCLUDED.kind,
      pinnable       = EXCLUDED.pinnable,
      default_pinned = EXCLUDED.default_pinned,
      default_order  = EXCLUDED.default_order,
      updated_at     = NOW();

-- 2. Grant um-users to the same roles already holding um-permissions.
--    Idempotent via NOT EXISTS so re-running is safe.
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT p_users.id, urp.users_roles_pages_id_role
  FROM pages p_users
  JOIN pages p_perms ON p_perms.key_enum = 'um-permissions'
  JOIN users_roles_pages urp ON urp.users_roles_pages_id_page = p_perms.id
 WHERE p_users.key_enum = 'um-users'
   AND NOT EXISTS (
     SELECT 1 FROM users_roles_pages urp2
      WHERE urp2.users_roles_pages_id_page = p_users.id
        AND urp2.users_roles_pages_id_role = urp.users_roles_pages_id_role
   );

COMMIT;
