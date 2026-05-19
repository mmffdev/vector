-- Migration 227: Drop the dead /workspace-admin/custom-fields nav entry.
--
-- The Custom Fields surface (CustomFieldsTree, CustomFieldsWorkItemsBody,
-- /workspace-admin/custom-fields/{work-items,risks,tasks,defects,portfolio-items})
-- was wired to /api/dev/artefact-types* — Next.js shadow handlers that
-- queried the OLD column-prefix-free tables (artefact_types, etc.). After
-- the RF1.4.2 column-prefix rename, those tables no longer exist, so the
-- handlers 500ed and the page was effectively dead.
--
-- Discovered 2026-05-19 during the API-audit cleanup (TD-API-AUDIT-001).
-- Surface deleted in commit XXXXX. This migration removes the nav row +
-- role grant so the broken link is gone from the rail.
--
-- If a Custom Fields admin surface is rebuilt later, it will need a
-- fresh page row, fresh handlers under /_site/admin/dev/artefact-types*,
-- and the workspace_id scope clamp the original ignored.
--
-- Idempotent: silent no-op if the row is already gone.

BEGIN;

-- 1. Drop role grants (FK CASCADE will also handle this, but explicit is clearer).
DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
   SELECT id FROM pages
    WHERE key_enum = 'ws-custom-fields'
      AND created_by IS NULL
      AND subscription_id IS NULL
 );

-- 2. Drop the page row itself.
DELETE FROM pages
 WHERE key_enum = 'ws-custom-fields'
   AND created_by IS NULL
   AND subscription_id IS NULL;

COMMIT;
