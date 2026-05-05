-- 113_grant_gadmin_portfolio_model_page_role_DOWN.sql
--
-- Reverts migration 113 — removes the gadmin nav-registry grant
-- for `/portfolio-model`.

DELETE FROM page_roles
WHERE role = 'gadmin'
  AND page_id = (SELECT id FROM pages WHERE key_enum = 'portfolio-model');
