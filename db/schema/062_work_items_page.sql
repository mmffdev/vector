-- ============================================================
-- MMFFDev - Vector: Register /work-items nav entry
-- Migration 062
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 062_work_items_page.sql
--
-- Work Items is the primary execution-layer surface for user stories,
-- defects, tasks, and test cases. Available to all roles (user, padmin,
-- gadmin). Lives under the Planning nav group at default_order 3
-- (after Backlog=0, Planning=1, Portfolio=2).
-- ============================================================

BEGIN;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('work-items', 'Work Items', '/work-items', 'layers', 'planning', 'static', TRUE, TRUE, 3)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

INSERT INTO page_roles (page_id, role)
SELECT id, r::user_role
FROM pages, UNNEST(ARRAY['user', 'padmin', 'gadmin']) AS r
WHERE key_enum = 'work-items' AND subscription_id IS NULL AND created_by IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
