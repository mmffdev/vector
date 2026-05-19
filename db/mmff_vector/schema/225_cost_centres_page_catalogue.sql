-- B20.4.3 (2026-05-19) — register the cost-centres admin page in the
-- nav catalogue and grant it to gadmin (grp_global). Same shape as
-- the other workspace-admin pages.

BEGIN;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES ('ws-cost-centres', 'Cost Centres', '/workspace-admin/cost-centres', 'building',
        'workspace_admin', 'static', TRUE, TRUE, 80)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO UPDATE
  SET href           = EXCLUDED.href,
      label          = EXCLUDED.label,
      icon           = EXCLUDED.icon,
      tag_enum       = EXCLUDED.tag_enum,
      kind           = EXCLUDED.kind,
      pinnable       = EXCLUDED.pinnable,
      default_pinned = EXCLUDED.default_pinned,
      default_order  = EXCLUDED.default_order,
      updated_at     = NOW();

-- Grant the page to grp_global (gadmin). Cost-centre management is
-- gadmin-only, matching cost_centres.manage permission scope.
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT p.id, r.users_roles_id
  FROM pages p, users_roles r
 WHERE p.key_enum = 'ws-cost-centres'
   AND r.users_roles_code = 'grp_global'
   AND NOT EXISTS (
     SELECT 1 FROM users_roles_pages urp
      WHERE urp.users_roles_pages_id_page = p.id
        AND urp.users_roles_pages_id_role = r.users_roles_id
   );

COMMIT;
