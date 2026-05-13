-- Migration 158: Replace single /dev page with individual dev sub-pages as nav entries.
-- Each dev tool (Setup, Plans, Retros, etc.) becomes its own page in the catalogue,
-- gated to gadmin only. A new 'dev_tools' tag bucket groups them in the rail.

-- 1. Add the dev_tools tag bucket (appears as its own rail icon for gadmin).
INSERT INTO page_tags (tag_enum, display_name, default_order, is_admin_menu)
VALUES ('dev_tools', 'Dev Tools', 10, false)
ON CONFLICT (tag_enum) DO NOTHING;

-- 2. Remove old catch-all /dev and /dev/library pages (cascade removes roles_pages rows).
DELETE FROM roles_pages WHERE page_id IN (
    SELECT id FROM pages WHERE key_enum IN ('dev', 'dev-library')
);
DELETE FROM pages WHERE key_enum IN ('dev', 'dev-library');

-- 3. Insert individual dev sub-pages. All gadmin-only, all non-pinnable
--    (they appear via the dev_tools tag section, not user prefs).
--    role_id uses the stable gadmin system UUID: 00000000-0000-0000-0000-00000000ad30
WITH inserted AS (
    INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id)
    VALUES
        ('dev-research',      'Research',      '/dev/research',      'search',    'dev_tools', 'static', true, true,  1, NULL, NULL),
        ('dev-setup',         'Setup',         '/dev/setup',         'cog',       'dev_tools', 'static', true, true,  2, NULL, NULL),
        ('dev-plans',         'Plans',         '/dev/plans',         'clipboard', 'dev_tools', 'static', true, true,  3, NULL, NULL),
        ('dev-retros',        'Retros',        '/dev/retros',        'refresh',   'dev_tools', 'static', true, true,  4, NULL, NULL),
        ('dev-scope',         'Scope',         '/dev/scope',         'star',      'dev_tools', 'static', true, true,  5, NULL, NULL),
        ('dev-reports',       'Reports',       '/dev/reports',       'chart',     'dev_tools', 'static', true, true,  6, NULL, NULL),
        ('dev-shortcuts',     'Shortcuts',     '/dev/shortcuts',     'bolt',      'dev_tools', 'static', true, true,  7, NULL, NULL),
        ('dev-operations',    'Operations',    '/dev/operations',    'server',    'dev_tools', 'static', true, true,  8, NULL, NULL),
        ('dev-page-help',     'Page Help',     '/dev/page-help',     'help',      'dev_tools', 'static', true, true,  9, NULL, NULL),
        ('dev-ui-catalog',    'UI Catalog',    '/dev/ui-catalog',    'palette',   'dev_tools', 'static', true, true, 10, NULL, NULL),
        ('dev-icons',         'Icons',         '/dev/icons',         'image',     'dev_tools', 'static', true, true, 11, NULL, NULL),
        ('dev-api-v2-tests',  'API v2 Tests',  '/dev/api-v2-tests',  'code',      'dev_tools', 'static', true, true, 12, NULL, NULL),
        ('dev-api-changelog', 'API Changelog', '/dev/api-changelog', 'list',      'dev_tools', 'static', true, true, 13, NULL, NULL)
    RETURNING id, key_enum
)
INSERT INTO roles_pages (page_id, role_id, role)
SELECT id, '00000000-0000-0000-0000-00000000ad30', 'gadmin' FROM inserted;
