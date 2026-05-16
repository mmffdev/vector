-- ============================================================
-- MMFFDev - Vector: Theme page (under Personal Settings)
-- Migration 014 — applied on top of 013_polymorphic_dispatch_triggers.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 014_page_theme.sql
--
-- Adds a new system page "Theme" that lives in the avatar dropdown
-- under the Personal Settings group. Visible to all roles.
-- Icon key 'theme' renders the four-coloured-squares glyph in
-- app/components/UserAvatarMenu.tsx (IconFor switch).
-- ============================================================

BEGIN;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('theme', 'Theme', '/theme', 'theme', 'personal_settings', 'static', TRUE, FALSE, 1);

INSERT INTO page_roles (page_id, role)
SELECT id, r::user_role
FROM pages, UNNEST(ARRAY['user', 'padmin', 'gadmin']) AS r
WHERE key_enum = 'theme';

COMMIT;
