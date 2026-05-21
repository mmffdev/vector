-- Migration 239: Grant dev-code page to the remaining 5 system roles
-- (grp_portfolio, grp_product, grp_stakeholder, grp_team_lead, grp_team_member).
--
-- Migration 238 only granted to grp_global, matching the literal text of the
-- earlier security-audits migration (207). But every other dev-* page in
-- production is granted to ALL 6 user-facing roles — at some point the dev
-- pages got back-filled. Only gadmin saw the Code tab without this grant.
--
-- grp_external is intentionally excluded (not part of the dev_tools surface
-- for any existing dev-* page).

BEGIN;

WITH page AS (
    SELECT id FROM pages WHERE key_enum = 'dev-code'
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
