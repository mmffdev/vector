BEGIN;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES ('dev-library', 'Library', '/dev/library', 'book-open', 'personal', 'static', FALSE, FALSE, 101)
ON CONFLICT (key_enum) WHERE subscription_id IS NULL AND created_by IS NULL DO NOTHING;

INSERT INTO page_roles (page_id, role)
SELECT id, r::user_role
FROM pages, UNNEST(ARRAY['user', 'padmin', 'gadmin']) AS r
WHERE key_enum = 'dev-library' AND subscription_id IS NULL AND created_by IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
