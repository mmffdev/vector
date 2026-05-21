-- DOWN for migration 239: Revoke the back-fill role grants for dev-code.

BEGIN;

DELETE FROM users_roles_pages
WHERE users_roles_pages_id_page = (SELECT id FROM pages WHERE key_enum = 'dev-code')
  AND users_roles_pages_id_role IN (
      SELECT users_roles_id FROM users_roles
      WHERE users_roles_code IN (
          'grp_portfolio',
          'grp_product',
          'grp_stakeholder',
          'grp_team_lead',
          'grp_team_member'
      )
        AND users_roles_is_system = true
  );

COMMIT;
