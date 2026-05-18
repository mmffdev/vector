-- Nav cleanup:
--   1. Remove planning/topology — page lives at /workspace-admin/topology (tag: workspace_admin).
--      No standalone /topology filesystem file exists; the row was stale.
--   2. Add api-manager sub-pages as nav children (asset-register, webhooks).
--   3. Remove user-management + admin/roles nav rows — these are accessed via direct links,
--      not top-level nav entries; files remain on disk.

DELETE FROM pages
 WHERE key_enum = 'topology'
   AND tag_enum = 'planning'
   AND subscription_id IS NULL
   AND created_by IS NULL;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
  ('va-api-manager-asset-register', 'Asset Register', '/vector-admin/api-manager/asset-register', 'code', 'vector_admin', 'static', false, false, 6),
  ('va-api-manager-webhooks',       'Webhooks',       '/vector-admin/api-manager/webhooks',       'code', 'vector_admin', 'static', false, false, 7)
ON CONFLICT DO NOTHING;

DELETE FROM pages
 WHERE key_enum IN ('user-management', 'admin-roles')
   AND subscription_id IS NULL
   AND created_by IS NULL;

-- Resequence all nav sections — no ties, no gaps.

-- workspace_admin (Topology Map at 4)
UPDATE pages SET default_order = 1  WHERE key_enum = 'ws-workspace-details';
UPDATE pages SET default_order = 2  WHERE key_enum = 'ws-workspaces';
UPDATE pages SET default_order = 3  WHERE key_enum = 'ws-artefact-types';
UPDATE pages SET default_order = 4  WHERE key_enum = 'va-topology-map';
UPDATE pages SET default_order = 5  WHERE key_enum = 'va-topology';
UPDATE pages SET default_order = 6  WHERE key_enum = 'ws-transition-rules';
UPDATE pages SET default_order = 7  WHERE key_enum = 'ws-flow-states';
UPDATE pages SET default_order = 8  WHERE key_enum = 'ws-flow-states-v2';
UPDATE pages SET default_order = 9  WHERE key_enum = 'ws-custom-fields';
UPDATE pages SET default_order = 10 WHERE key_enum = 'ws-portfolio-model';
UPDATE pages SET default_order = 11 WHERE key_enum = 'portfolio-settings';

-- vector_admin (close gaps from deleted rows)
UPDATE pages SET default_order = 1 WHERE key_enum = 'va-tenant-settings';
UPDATE pages SET default_order = 2 WHERE key_enum = 'library-releases';
UPDATE pages SET default_order = 3 WHERE key_enum = 'va-api-manager';
UPDATE pages SET default_order = 4 WHERE key_enum = 'va-api-manager-asset-register';
UPDATE pages SET default_order = 5 WHERE key_enum = 'va-api-manager-webhooks';

-- user_management (close gap from deleted user-management row)
UPDATE pages SET default_order = 1 WHERE key_enum = 'um-permissions';
