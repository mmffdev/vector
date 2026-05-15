-- ============================================================
-- 201_seed_grant_va_tenant_settings.sql
--
-- PLA-0050 follow-on. Story 00572 inserted the `va-tenant-settings`
-- row into `pages` but never seeded the role grants in
-- `users_roles_pages`. That left the new
-- `RequirePageAccess(pageAccessResolver, "va-tenant-settings")`
-- middleware (added to /_site/tenant-settings during PLA-0050
-- runtime-smoke verification) without any role able to pass.
--
-- This migration:
--   1. Grants the `grp_global` (gadmin) system role access to
--      `va-tenant-settings` so gadmins can read + PATCH the
--      subscription-tier defaults — AC5 + AC6 of PLA-0050.
--   2. Deliberately does NOT grant any other role: the AC7 contract
--      says non-gadmin users must 403, and there is no separate
--      tenant-admin role tier yet.
--
-- Idempotent: ON CONFLICT DO NOTHING. Safe to re-run.
--
-- The historical universal-page-grant mechanism (mig 193) ran once
-- at migration time and does not auto-grant gadmin on subsequent
-- new pages. A trigger to keep that invariant has been discussed
-- (see 193 footer) but not built; until then, every new system
-- page row needs an explicit grant-seed migration like this one.
-- ============================================================

BEGIN;

INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT p.id, r.users_roles_id
  FROM pages p
  CROSS JOIN users_roles r
 WHERE p.key_enum = 'va-tenant-settings'
   AND r.users_roles_code = 'grp_global'
   AND r.users_roles_is_system = TRUE
   AND r.users_roles_id_subscription IS NULL
ON CONFLICT DO NOTHING;

-- Verify exactly one row landed (or already existed).
DO $$
DECLARE grants_count int;
BEGIN
    SELECT COUNT(*) INTO grants_count
      FROM users_roles_pages urp
      JOIN pages p ON p.id = urp.users_roles_pages_id_page
      JOIN users_roles r ON r.users_roles_id = urp.users_roles_pages_id_role
     WHERE p.key_enum = 'va-tenant-settings'
       AND r.users_roles_code = 'grp_global';
    IF grants_count <> 1 THEN
        RAISE EXCEPTION 'va-tenant-settings grant seed incomplete: expected 1 grp_global grant, found %', grants_count;
    END IF;
END $$;

COMMIT;
