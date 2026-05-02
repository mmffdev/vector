-- ============================================================
-- 077 — seed page_addressables for the /dev page
--
-- The /dev page (DevPage.tsx + DevPlansPanel/DevReportsPanel/
-- DevResearchPanel/DevPageHelpPanel/DevShortcutsPanel) is now
-- wrapped in <StrictRoute> with each panel using <Panel
-- name="dev_*">. Because /dev is a dev-only surface that is not
-- visited as part of normal session flow, build-reconcile may not
-- visit it; pre-seed the addressables here with source='build' so
-- they appear in the snapshot regardless and any future
-- reconcile run idempotently adopts them.
--
-- Address shape (matches frontend ViewportSlot kind="app"):
--   samantha._viewport.app._panel.<name>
--
-- Idempotent: ON CONFLICT DO NOTHING against the sibling-unique
-- index (parent_id IS NULL + kind + name).
-- ============================================================

BEGIN;

INSERT INTO page_addressables (parent_id, kind, name, address, page_route, source)
VALUES
    (NULL, 'panel', 'dev_health',             'samantha._viewport.app._panel.dev_health',             '/dev', 'build'),
    (NULL, 'panel', 'dev_debug',              'samantha._viewport.app._panel.dev_debug',              '/dev', 'build'),
    (NULL, 'panel', 'dev_portfolio_adoption', 'samantha._viewport.app._panel.dev_portfolio_adoption', '/dev', 'build'),
    (NULL, 'panel', 'dev_ssh_tunnel',         'samantha._viewport.app._panel.dev_ssh_tunnel',         '/dev', 'build'),
    (NULL, 'panel', 'dev_ssh_what',           'samantha._viewport.app._panel.dev_ssh_what',           '/dev', 'build'),
    (NULL, 'panel', 'dev_ssh_reqs',           'samantha._viewport.app._panel.dev_ssh_reqs',           '/dev', 'build'),
    (NULL, 'panel', 'dev_plans',              'samantha._viewport.app._panel.dev_plans',              '/dev', 'build'),
    (NULL, 'panel', 'dev_reports',            'samantha._viewport.app._panel.dev_reports',            '/dev', 'build'),
    (NULL, 'panel', 'dev_research',           'samantha._viewport.app._panel.dev_research',           '/dev', 'build'),
    (NULL, 'panel', 'dev_page_help',          'samantha._viewport.app._panel.dev_page_help',          '/dev', 'build'),
    (NULL, 'panel', 'dev_shortcuts',          'samantha._viewport.app._panel.dev_shortcuts',          '/dev', 'build')
ON CONFLICT DO NOTHING;

COMMIT;
