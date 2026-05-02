-- ============================================================
-- 079 — seed page_addressables for /work-items, /backlog, and
-- /work-items/settings.
--
-- /work-items (WorkItemsPage):
--   - work_items_filters
--   - work_items_tree
--
-- /backlog (Backlog):
--   - backlog_filters
--   - backlog_list
--
-- /work-items/settings (WorkItemsSettingsPage): one panel per
-- tab; only one is mounted at a time but we seed both so the
-- registry always has a stable handle for either tab.
--   - work_items_settings_fields
--   - work_items_settings_templates
--
-- Idempotent: ON CONFLICT DO NOTHING against the sibling-unique
-- index (parent_id IS NULL + kind + name).
-- ============================================================

BEGIN;

INSERT INTO page_addressables (parent_id, kind, name, address, page_route, source)
VALUES
    (NULL, 'panel', 'work_items_filters',            'samantha._viewport.app._panel.work_items_filters',            '/work-items',          'build'),
    (NULL, 'panel', 'work_items_tree',               'samantha._viewport.app._panel.work_items_tree',               '/work-items',          'build'),
    (NULL, 'panel', 'backlog_filters',               'samantha._viewport.app._panel.backlog_filters',               '/backlog',             'build'),
    (NULL, 'panel', 'backlog_list',                  'samantha._viewport.app._panel.backlog_list',                  '/backlog',             'build'),
    (NULL, 'panel', 'work_items_settings_fields',    'samantha._viewport.app._panel.work_items_settings_fields',    '/work-items/settings', 'build'),
    (NULL, 'panel', 'work_items_settings_templates', 'samantha._viewport.app._panel.work_items_settings_templates', '/work-items/settings', 'build')
ON CONFLICT DO NOTHING;

COMMIT;
