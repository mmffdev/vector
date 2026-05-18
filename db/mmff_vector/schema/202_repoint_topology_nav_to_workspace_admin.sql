-- Move the topology + topology-map nav entries from /vector-admin/* to
-- /workspace-admin/* so they live under the workspace-admin section of the
-- nav rather than the legacy vector-admin section.
--
-- Companion frontend change: app/(user)/workspace-admin/topology/page.tsx added;
-- app/(user)/vector-admin/topology/page.tsx redirects to the new path.

UPDATE pages
   SET href     = '/workspace-admin/topology',
       tag_enum = 'workspace_admin'
 WHERE key_enum = 'va-topology'
   AND subscription_id IS NULL
   AND created_by IS NULL;

UPDATE pages
   SET href     = '/workspace-admin/topology-map',
       tag_enum = 'workspace_admin'
 WHERE key_enum = 'va-topology-map'
   AND subscription_id IS NULL
   AND created_by IS NULL;
