-- ============================================================
-- MMFFDev - Vector: Register /admin/roles nav entry  (PLA-0007 G3)
-- Migration 094
--
-- /admin/roles is the gadmin-facing UI for managing system + tenant
-- roles and their permission grids. Lives under the existing
-- "admin_settings" tag (Workspace / Portfolio / Portfolio Model /
-- Roles), surfaced by the avatar-menu admin section.
--
-- Visibility: gated to gadmin via page_roles.role_id pointing at the
-- seeded gadmin system role (00000000-0000-0000-0000-00000000ad30).
-- Padmin can hit the page directly via roles.list permission and
-- gets a read-only view (UI hides write actions when canCreate /
-- canUpdate / canArchive are false). Custom-role gadmin equivalents
-- can be granted page visibility via the future tenant-side nav UI;
-- this seed only covers the system roles.
-- ============================================================

BEGIN;

INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('admin-roles', 'Roles', '/admin/roles', 'users', 'admin_settings', 'static', TRUE, TRUE, 5)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

-- gadmin only (uses role_id post-089).
-- Defensive: some envs still carry the legacy page_roles.role enum
-- column (089 was applied before the column drop step landed in
-- some dev DBs). Populate both columns when the legacy column
-- still exists; the role_id column is always populated.
DO $$
DECLARE
    legacy_exists BOOLEAN;
    page_uuid UUID;
BEGIN
    SELECT id INTO page_uuid
    FROM pages
    WHERE key_enum = 'admin-roles'
      AND subscription_id IS NULL
      AND created_by IS NULL;

    IF page_uuid IS NULL THEN
        RAISE EXCEPTION 'PLA-0007 094: admin-roles page row not found after upsert';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'page_roles' AND column_name = 'role'
    ) INTO legacy_exists;

    IF legacy_exists THEN
        EXECUTE format(
            'INSERT INTO page_roles (page_id, role_id, role) VALUES (%L, %L::uuid, %L::user_role) ON CONFLICT DO NOTHING',
            page_uuid,
            '00000000-0000-0000-0000-00000000ad30',
            'gadmin'
        );
    ELSE
        EXECUTE format(
            'INSERT INTO page_roles (page_id, role_id) VALUES (%L, %L::uuid) ON CONFLICT DO NOTHING',
            page_uuid,
            '00000000-0000-0000-0000-00000000ad30'
        );
    END IF;
END $$;

COMMIT;
