-- ============================================================
-- MMFFDev - Vector: Register /library-releases nav entry
-- Migration 022 — applied on top of 021_library_acknowledgements.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 022_library_releases_page.sql
--
-- Phase 3 of the mmff_library adoption plan: gadmin-only releases page.
-- Lives in the admin_settings group alongside Portfolio Model. Gated to
-- gadmin only (per plan §12 — only the group admin acknowledges
-- releases on behalf of the subscription).
-- ============================================================

BEGIN;

-- Use the system-scoped partial unique index from migration 012
-- (renamed in migration 017 alongside tenant_id -> subscription_id):
--   pages_unique_key_system ON (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL
INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('library-releases', 'Library Releases', '/library-releases', 'bell', 'admin_settings', 'static', TRUE, TRUE, 3)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

INSERT INTO page_roles (page_id, role)
SELECT id, 'gadmin'::user_role
FROM pages
WHERE key_enum = 'library-releases' AND subscription_id IS NULL AND created_by IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
