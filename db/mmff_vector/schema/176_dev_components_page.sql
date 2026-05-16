-- Migration 176: Add dev-components page to the dev_tools nav rail.
-- Follows the pattern from migration 158.

WITH inserted AS (
    INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id)
    VALUES ('dev-components', 'Components', '/dev/components', 'layout', 'dev_tools', 'static', true, true, 14, NULL, NULL)
    RETURNING id
)
INSERT INTO roles_pages (page_id, role_id, role)
SELECT id, '00000000-0000-0000-0000-00000000ad30', 'gadmin' FROM inserted;
