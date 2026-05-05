-- 114_remove_portfolio_model_from_sidebar_DOWN.sql
--
-- Restores the standalone `/portfolio-model` entry in the sidebar
-- nav registry, plus its padmin and gadmin page_roles rows
-- (matching the post-113 state). Original row id is preserved so
-- existing references hold up.

INSERT INTO pages (id, key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES (
    'ce130a78-1be2-46b4-9a98-de0ac2d35c11'::uuid,
    'portfolio-model',
    'Portfolio Model',
    '/portfolio-model',
    'briefcase',
    'admin_settings',
    'static',
    TRUE,
    TRUE,
    2
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO page_roles (page_id, role_id, role)
SELECT 'ce130a78-1be2-46b4-9a98-de0ac2d35c11'::uuid,
       '00000000-0000-0000-0000-00000000ad25'::uuid,
       'padmin'::user_role
ON CONFLICT (page_id, role) DO NOTHING;

INSERT INTO page_roles (page_id, role_id, role)
SELECT 'ce130a78-1be2-46b4-9a98-de0ac2d35c11'::uuid,
       '00000000-0000-0000-0000-00000000ad30'::uuid,
       'gadmin'::user_role
ON CONFLICT (page_id, role) DO NOTHING;
