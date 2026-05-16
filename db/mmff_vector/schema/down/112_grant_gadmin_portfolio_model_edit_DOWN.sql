-- 112_grant_gadmin_portfolio_model_edit_DOWN.sql
--
-- Reverts migration 112 — removes gadmin's grant of
-- `portfolio.model.edit`. padmin's grant (seeded in 104) is left
-- untouched.

DELETE FROM role_permissions
WHERE role_id = '00000000-0000-0000-0000-00000000ad30'
  AND permission_id = (
      SELECT id FROM permissions WHERE code = 'portfolio.model.edit'
  );
