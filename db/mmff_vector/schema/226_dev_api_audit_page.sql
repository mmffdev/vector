-- Migration 226: Add the /dev/api-audit nav entry (Dev Tools rail).
--
-- Adds a new gadmin-only Dev Tools tab "API Audit" that surfaces the
-- siteAPI compliance survey produced by dev/scripts/audit_api_touchpoints.sh
-- (served by GET /_site/admin/dev/api-audit, rendered by DevApiAuditPanel.tsx).
--
-- Mirrors the pattern from migration 158 (dev_pages_as_nav_entries).
-- Idempotent: ON CONFLICT on the page key + role grant.

BEGIN;

-- 1. Insert the page row (catalogue-scoped, gadmin-only, dev_tools bucket).
--    pages.key_enum is UNIQUE only under partial-index conditions; use a
--    NOT EXISTS guard to stay idempotent on re-run.
INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id)
SELECT 'dev-api-audit', 'API Audit', '/dev/api-audit', 'shield', 'dev_tools', 'static', true, true, 14, NULL, NULL
WHERE NOT EXISTS (
    SELECT 1 FROM pages WHERE key_enum = 'dev-api-audit' AND created_by IS NULL AND subscription_id IS NULL
);

-- 2. Grant grp_global (gadmin). Post-RF1.4.2:
--    - table renamed roles_pages → users_roles_pages with prefixed columns
--    - the legacy hardcoded role UUID (00…ad30) is gone; resolve by code.
--    gadmin's universal page access is normally backed by an auto-grant
--    trigger (mig 193 + the access-version trigger), but this explicit
--    insert keeps the catalogue self-documenting and survives even if
--    that trigger is ever rebuilt.
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT p.id, r.users_roles_id
  FROM pages p, users_roles r
 WHERE p.key_enum = 'dev-api-audit'
   AND p.created_by IS NULL
   AND p.subscription_id IS NULL
   AND r.users_roles_code = 'grp_global'
   AND r.users_roles_is_system = TRUE
   AND r.users_roles_id_subscription IS NULL
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
