-- ============================================================
-- 078 — seed page_addressables for /portfolio-settings and
-- /portfolio-model
--
-- /portfolio-settings (PortfolioSettingsPage): three panels
--   - portfolio_settings_identity
--   - portfolio_settings_stakeholders
--   - portfolio_settings_danger_zone
--
-- /portfolio-model (PortfolioModelPage / BundleView): three panels
-- (hierarchy is always rendered; artifacts and terminology only
-- when their lists are non-empty, but we seed all three so future
-- bundles light them up immediately):
--   - portfolio_model_hierarchy
--   - portfolio_model_artifacts
--   - portfolio_model_terminology
--
-- Idempotent: ON CONFLICT DO NOTHING against the sibling-unique
-- index (parent_id IS NULL + kind + name).
-- ============================================================

BEGIN;

INSERT INTO page_addressables (parent_id, kind, name, address, page_route, source)
VALUES
    (NULL, 'panel', 'portfolio_settings_identity',     'samantha._viewport.app._panel.portfolio_settings_identity',     '/portfolio-settings', 'build'),
    (NULL, 'panel', 'portfolio_settings_stakeholders', 'samantha._viewport.app._panel.portfolio_settings_stakeholders', '/portfolio-settings', 'build'),
    (NULL, 'panel', 'portfolio_settings_danger_zone',  'samantha._viewport.app._panel.portfolio_settings_danger_zone',  '/portfolio-settings', 'build'),
    (NULL, 'panel', 'portfolio_model_hierarchy',       'samantha._viewport.app._panel.portfolio_model_hierarchy',       '/portfolio-model',    'build'),
    (NULL, 'panel', 'portfolio_model_artifacts',       'samantha._viewport.app._panel.portfolio_model_artifacts',       '/portfolio-model',    'build'),
    (NULL, 'panel', 'portfolio_model_terminology',     'samantha._viewport.app._panel.portfolio_model_terminology',     '/portfolio-model',    'build')
ON CONFLICT DO NOTHING;

COMMIT;
