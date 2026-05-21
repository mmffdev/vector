-- Migration 241: Grant dev-visualiser page to the remaining 5 system roles
-- (grp_portfolio, grp_product, grp_stakeholder, grp_team_lead, grp_team_member).
--
-- Mirrors migration 239 (dev-code grants). grp_external excluded —
-- not part of the dev_tools surface for any dev-* page.

BEGIN;

WITH page AS (
    SELECT id FROM pages WHERE key_enum = 'dev-visualiser'
)
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT page.id, r.users_roles_id
FROM page, users_roles r
WHERE r.users_roles_code IN (
    'grp_portfolio',
    'grp_product',
    'grp_stakeholder',
    'grp_team_lead',
    'grp_team_member'
)
  AND r.users_roles_is_system = true
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
