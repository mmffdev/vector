-- ============================================================
-- MMFFDev - Vector: Correct admin page hrefs to canonical paths
-- Migration 157
--
-- The old URL structure nested all admin pages under
-- /workspace-settings/... which was confusing and incorrect.
-- Each admin domain now has its own top-level path:
--
--   /workspace-admin/...   (was /workspace-settings/workspace-settings/...)
--   /user-management/...   (was /workspace-settings/users + /permissions)
--   /vector-admin/...      (was /workspace-settings/vector-admin/...)
--
-- The top-level /workspace-settings and /workspace-settings/workspace-settings
-- stubs keep their hrefs as-is; they redirect at runtime via router.replace.
-- ============================================================

BEGIN;

-- Workspace Admin sub-tabs
UPDATE pages SET href = '/workspace-admin/organisation'      WHERE key_enum = 'ws-organisation'     AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/workspace-admin/workspaces'        WHERE key_enum = 'ws-workspaces'       AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/workspace-admin/portfolio-model'   WHERE key_enum = 'ws-portfolio-model'  AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/workspace-admin/artefact-types'    WHERE key_enum = 'ws-artefact-types'   AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/workspace-admin/flow-states'       WHERE key_enum = 'ws-flow-states'      AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/workspace-admin/transition-rules'  WHERE key_enum = 'ws-transition-rules' AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/workspace-admin/custom-fields'     WHERE key_enum = 'ws-custom-fields'    AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/workspace-admin/flow-states-v2'    WHERE key_enum = 'ws-flow-states-v2'   AND subscription_id IS NULL AND created_by IS NULL;

-- User Management
UPDATE pages SET href = '/user-management'             WHERE key_enum = 'user-management' AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/user-management/permissions' WHERE key_enum = 'um-permissions'  AND subscription_id IS NULL AND created_by IS NULL;

-- Vector Admin sub-tabs
UPDATE pages SET href = '/vector-admin/tenant-details' WHERE key_enum = 'va-tenant-details'  AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/vector-admin/topology'       WHERE key_enum = 'va-topology'         AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/vector-admin/topology-map'   WHERE key_enum = 'va-topology-map'     AND subscription_id IS NULL AND created_by IS NULL;
UPDATE pages SET href = '/vector-admin/api-manager'    WHERE key_enum = 'va-api-manager'      AND subscription_id IS NULL AND created_by IS NULL;

-- Vector Admin root stub (was /workspace-settings/vector-admin)
UPDATE pages SET href = '/vector-admin'       WHERE key_enum = 'vector-admin-nav'  AND subscription_id IS NULL AND created_by IS NULL;

-- Workspace Admin root stub (was /workspace-settings/workspace-settings)
UPDATE pages SET href = '/workspace-admin'    WHERE key_enum = 'workspace-admin'   AND subscription_id IS NULL AND created_by IS NULL;

COMMIT;
