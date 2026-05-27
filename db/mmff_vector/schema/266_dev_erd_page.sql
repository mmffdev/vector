-- Migration 266: Add dev-erd page to the dev_tools nav rail (PLA-ERD).
-- Mirrors migration 239 (Reporting) — grants to all 6 system roles.

BEGIN;

WITH inserted AS (
    INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id)
    VALUES ('dev-erd', 'ERD', '/dev/erd', 'database', 'dev_tools', 'static', true, true, 18, NULL, NULL)
    ON CONFLICT (key_enum) WHERE (created_by IS NULL AND subscription_id IS NULL) DO NOTHING
    RETURNING id
)
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT i.id, r.users_roles_id
  FROM inserted i, users_roles r
 WHERE r.users_roles_code IN ('grp_global','grp_portfolio','grp_product','grp_stakeholder','grp_team_lead','grp_team_member')
   AND r.users_roles_is_system = true
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
