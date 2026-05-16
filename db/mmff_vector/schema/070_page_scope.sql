-- ============================================================
-- 070 — Add "Scope" page under the Planning tag
--
-- Top-level sibling of Backlog / Planning / Portfolio in the
-- sidebar's Planning group. Visible to all logged-in roles.
-- Slots between Backlog (0) and Planning so the group reads:
--   Backlog (0) → Scope (1) → Planning (2) → Portfolio (3)
--
-- Purpose: users upload scoping documents here so sprint and
-- product work can tie back to the originating scope.
-- ============================================================

BEGIN;

-- Renumber existing planning-tag pages to make room for Scope at 1.
-- Bumps every planning-tag page with default_order >= 1 by one slot.
UPDATE pages
SET default_order = default_order + 1
WHERE tag_enum = 'planning'
  AND default_order >= 1;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order) VALUES
    ('scope', 'Scope', '/scope', 'folder', 'planning', 'static', TRUE, TRUE, 1);

INSERT INTO page_roles (page_id, role)
SELECT id, r::user_role
FROM pages, UNNEST(ARRAY['user', 'padmin', 'gadmin']) AS r
WHERE key_enum = 'scope';

COMMIT;
