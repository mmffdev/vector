-- Migration 238: Add dev-code page to the dev_tools nav rail.
-- Follows the pattern from migrations 158, 176, 207, 226.

BEGIN;

WITH inserted AS (
    INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id)
    VALUES ('dev-code', 'Code', '/dev/code', 'code', 'dev_tools', 'static', true, true, 16, NULL, NULL)
    ON CONFLICT (key_enum) WHERE (created_by IS NULL AND subscription_id IS NULL) DO NOTHING
    RETURNING id
)
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT id, users_roles_id FROM inserted, users_roles WHERE users_roles_code = 'grp_global' AND users_roles_is_system = true
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
