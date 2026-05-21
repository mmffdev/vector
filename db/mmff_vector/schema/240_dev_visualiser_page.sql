-- Migration 240: Add dev-visualiser page to the dev_tools nav rail.
-- Mirrors migrations 238 + 239 (dev-code page) — same pattern,
-- all 6 user-facing system roles get the grant.

BEGIN;

WITH inserted AS (
    INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id)
    VALUES ('dev-visualiser', 'Visualiser', '/dev/visualiser', 'graph', 'dev_tools', 'static', true, true, 17, NULL, NULL)
    ON CONFLICT (key_enum) WHERE (created_by IS NULL AND subscription_id IS NULL) DO NOTHING
    RETURNING id
)
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT id, users_roles_id FROM inserted, users_roles WHERE users_roles_code = 'grp_global' AND users_roles_is_system = true
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
