-- Migration 231: Restore the /workspace-admin/custom-fields nav entry.
--
-- Inverse of migration 227 (which dropped the dead /api/dev/artefact-types*
-- shadow-handler surface). The page surface has been rebuilt on siteAPI:
--
--   POST   /_site/workspaces/{id}/fields           (fields.Handler.Create)
--   PATCH  /_site/workspaces/{id}/fields/{fid}     (fields.Handler.Update)
--   DELETE /_site/workspaces/{id}/fields/{fid}     (fields.Handler.Archive)
--   GET    /_site/workspaces/{id}/fields           (fields.Handler.List)
--
-- The new handler enforces server-side:
--   • Tenancy clamp (subscription_id forced from caller, never payload)
--   • Scope clamp (workspace / tenant — global out-of-band, 403)
--   • Role-tier gate (TD-FIELDS-WRITER-PERMS to flip to permission-driven
--     when PLA-0007 cutover completes)
--   • Type-change 409 when artefacts_fields_values has rows
--
-- This addresses the workspace_id scope-clamp gap migration 227 called
-- out (`If a Custom Fields admin surface is rebuilt later, it will need
-- ... the workspace_id scope clamp the original ignored`).
--
-- Grant strategy: explicit grants are required per role tier. There
-- is NO auto-grant trigger on `pages` (only trg_pages_updated_at).
-- This migration grants grp_portfolio; the companion migration 232
-- adds grp_global after the original docstring's claim of an
-- auto-grant trigger was disproven.
--
-- Idempotent: ON CONFLICT keeps the row in sync; the grant is gated by
-- a NOT EXISTS probe.

BEGIN;

-- 1. Register the page in the nav catalogue.
INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES ('ws-custom-fields', 'Custom Fields', '/workspace-admin/custom-fields', 'pencil',
        'workspace_admin', 'static', TRUE, TRUE, 90)
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

-- 2. Grant to grp_portfolio (padmin) — tenant admin tier.
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT p.id, r.users_roles_id
  FROM pages p, users_roles r
 WHERE p.key_enum = 'ws-custom-fields'
   AND r.users_roles_code = 'grp_portfolio'
   AND r.users_roles_id_subscription IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM users_roles_pages urp
      WHERE urp.users_roles_pages_id_page = p.id
        AND urp.users_roles_pages_id_role = r.users_roles_id
   );

COMMIT;
