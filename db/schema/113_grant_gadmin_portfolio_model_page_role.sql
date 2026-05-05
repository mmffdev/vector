-- 113_grant_gadmin_portfolio_model_page_role.sql
--
-- Grants gadmin visibility of the `/portfolio-model` page in the
-- nav registry. Companion to 112 (which granted the
-- `portfolio.model.edit` permission).
--
-- Root cause: PLA-0007 introduced a structured `roles` table but
-- left two parallel grant surfaces — `role_permissions` (capability
-- gates, used by useHasPermission on the page) AND `page_roles`
-- (sidebar/menu visibility, used by the nav registry). 112 fixed
-- the first; gadmin still lacked the page_roles row, so the menu
-- entry was hidden and the page redirected even though the
-- capability check would have passed.
--
-- Idempotent: ON CONFLICT DO NOTHING. Safe to re-run.

INSERT INTO page_roles (page_id, role_id, role)
SELECT p.id,
       '00000000-0000-0000-0000-00000000ad30'::uuid,
       'gadmin'::user_role
FROM pages p
WHERE p.key_enum = 'portfolio-model'
ON CONFLICT (page_id, role) DO NOTHING;
