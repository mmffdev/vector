-- ============================================================
-- DOWN for 196_repoint_role_references.sql
--
-- WARNING: this DOWN cannot perfectly invert the original. Users
-- previously on grp_product / grp_stakeholder / grp_team_lead /
-- grp_team_member / grp_external coalesce into the closest legacy
-- bucket. grp_global → gadmin, grp_portfolio → padmin, every other
-- new role → 'user' on legacy users.role_id.
--
-- Page grants for grp_product / grp_stakeholder are silently
-- DELETED on down because no legacy UUID exists to point them at.
-- Permission grants for the same two roles are also dropped.
--
-- This is a DEV-ONLY recovery path; do not run on prod data.
-- ============================================================

BEGIN;

-- 1. Re-insert the 5 legacy system rows.
INSERT INTO users_roles (
    users_roles_id, users_roles_id_subscription, users_roles_code,
    users_roles_label, users_roles_description, users_roles_rank,
    users_roles_is_system, users_roles_is_external
) VALUES
    ('00000000-0000-0000-0000-00000000ad30', NULL, 'gadmin',    'Global Admin',
     'Full administrative authority within a tenant; can manage roles and users at every level.',
     30, TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ad25', NULL, 'padmin',    'Portfolio Admin',
     'Portfolio-level admin; can create Team Leads and Users and manage portfolio-scoped settings.',
     25, TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ad20', NULL, 'team_lead', 'Team Lead',
     'Mid-tier role with the same operational rights as Portfolio Admin in v0; ranks differ so role-ceiling is preserved.',
     20, TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ad10', NULL, 'user',      'User',
     'Standard end-user. No account-creation rights.',
     10, TRUE, FALSE),
    ('00000000-0000-0000-0000-00000000ad05', NULL, 'external',  'External (archetype)',
     'Bespoke external account archetype. Tenants clone-and-edit to define auditor / contractor / agent roles.',
      5, TRUE, TRUE)
ON CONFLICT (users_roles_id) DO NOTHING;

-- 2. Drop grants for grp_product / grp_stakeholder (no legacy mapping).
DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_role IN (
    SELECT users_roles_id FROM users_roles
     WHERE users_roles_code IN ('grp_product','grp_stakeholder')
       AND users_roles_id_subscription IS NULL
 );

DELETE FROM users_roles_permissions
 WHERE users_roles_permissions_id_role IN (
    SELECT users_roles_id FROM users_roles
     WHERE users_roles_code IN ('grp_product','grp_stakeholder')
       AND users_roles_id_subscription IS NULL
 );

-- 3. Repoint users.role_id back to the closest legacy bucket.
DO $$
DECLARE
    g UUID; p UUID; tl UUID; tm UUID; ex UUID; pr UUID; sk UUID;
BEGIN
    SELECT users_roles_id INTO g  FROM users_roles WHERE users_roles_code = 'grp_global'      AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO p  FROM users_roles WHERE users_roles_code = 'grp_portfolio'   AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO tl FROM users_roles WHERE users_roles_code = 'grp_team_lead'   AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO tm FROM users_roles WHERE users_roles_code = 'grp_team_member' AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO ex FROM users_roles WHERE users_roles_code = 'grp_external'    AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO pr FROM users_roles WHERE users_roles_code = 'grp_product'     AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO sk FROM users_roles WHERE users_roles_code = 'grp_stakeholder' AND users_roles_id_subscription IS NULL;

    UPDATE users SET role_id = '00000000-0000-0000-0000-00000000ad30' WHERE role_id = g;
    UPDATE users SET role_id = '00000000-0000-0000-0000-00000000ad25' WHERE role_id = p;
    UPDATE users SET role_id = '00000000-0000-0000-0000-00000000ad20' WHERE role_id = tl;
    UPDATE users SET role_id = '00000000-0000-0000-0000-00000000ad10' WHERE role_id IN (tm, pr, sk);
    UPDATE users SET role_id = '00000000-0000-0000-0000-00000000ad05' WHERE role_id = ex;

    -- 4. Repoint users_roles_pages.id_role.
    UPDATE users_roles_pages SET users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad30' WHERE users_roles_pages_id_role = g;
    UPDATE users_roles_pages SET users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad25' WHERE users_roles_pages_id_role = p;
    UPDATE users_roles_pages SET users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad20' WHERE users_roles_pages_id_role = tl;
    UPDATE users_roles_pages SET users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad10' WHERE users_roles_pages_id_role = tm;
    UPDATE users_roles_pages SET users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad05' WHERE users_roles_pages_id_role = ex;

    -- 5. Repoint users_roles_permissions.id_role.
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad30' WHERE users_roles_permissions_id_role = g;
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad25' WHERE users_roles_permissions_id_role = p;
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad20' WHERE users_roles_permissions_id_role = tl;
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad10' WHERE users_roles_permissions_id_role = tm;
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad05' WHERE users_roles_permissions_id_role = ex;
END $$;

COMMIT;
