-- Migration 172: Add Artefacts pages to the Value nav rail.
-- The dependency map owns a bookmarkable URL, but static catalogue
-- pages remain top-level rows in Rail 2 because nav prefs only allow nesting
-- for user_custom entries.

BEGIN;

WITH inserted AS (
    INSERT INTO pages (
        pages_key_enum,
        pages_label,
        pages_href,
        pages_icon,
        pages_tag_enum,
        pages_kind,
        pages_pinnable,
        pages_default_pinned,
        pages_default_order,
        pages_id_user_creator,
        pages_id_subscription
    )
    VALUES
        ('value-artefacts',    'Artefacts',    '/artefacts',    'layers',       'value', 'static', TRUE, TRUE, 4, NULL, NULL),
        ('value-dependencies', 'Dependencies', '/dependencies', 'dependencies', 'value', 'static', TRUE, TRUE, 5, NULL, NULL)
    ON CONFLICT (pages_key_enum) WHERE (pages_id_user_creator IS NULL AND pages_id_subscription IS NULL) DO NOTHING
    RETURNING pages_id
)
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT i.pages_id, r.users_roles_id
  FROM inserted i, users_roles r
 WHERE r.users_roles_code IN ('grp_global','grp_portfolio','grp_product','grp_stakeholder','grp_team_lead','grp_team_member')
   AND r.users_roles_is_system = true
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
