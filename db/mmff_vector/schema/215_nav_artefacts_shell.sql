-- 215_nav_artefacts_shell.sql
--
-- Introduce a /workspace-admin/artefacts shell page that groups
-- Artefact Types, Transition Rules, and Flow States v2 under one
-- sidebar nav. The three leaf pages move to /workspace-admin/artefacts/*.
--
-- Idempotent: INSERT … ON CONFLICT DO NOTHING for the new page row;
-- UPDATE for the three href changes.

BEGIN;

-- 1. Insert the shell page entry.
INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES (
  'ws-artefacts',
  'Artefacts',
  '/workspace-admin/artefacts',
  'package',
  'workspace_admin',
  'static',
  TRUE,
  TRUE,
  2
)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

-- 2. Grant ws-artefacts to the same roles that can see ws-artefact-types
--    (grp_portfolio via the 199 locked seed — padmin + gadmin inherit
--    via the auto-grant trigger on system roles).
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT
  (SELECT id FROM pages WHERE key_enum = 'ws-artefacts' AND subscription_id IS NULL AND created_by IS NULL),
  users_roles_pages_id_role
FROM users_roles_pages
WHERE users_roles_pages_id_page = (
  SELECT id FROM pages WHERE key_enum = 'ws-artefact-types' AND subscription_id IS NULL AND created_by IS NULL
)
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

-- 3. Repoint the three leaf hrefs to live under /artefacts/.
UPDATE pages
   SET href = '/workspace-admin/artefacts/artefact-types'
 WHERE key_enum = 'ws-artefact-types'
   AND subscription_id IS NULL
   AND created_by IS NULL;

UPDATE pages
   SET href = '/workspace-admin/artefacts/transition-rules'
 WHERE key_enum = 'ws-transition-rules'
   AND subscription_id IS NULL
   AND created_by IS NULL;

UPDATE pages
   SET href = '/workspace-admin/artefacts/flow-states-v2'
 WHERE key_enum = 'ws-flow-states-v2'
   AND subscription_id IS NULL
   AND created_by IS NULL;

COMMIT;
