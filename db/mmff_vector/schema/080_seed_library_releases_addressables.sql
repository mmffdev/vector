-- ============================================================
-- 080 — seed page_addressables for /library-releases
--
-- Single panel that wraps the loading / empty / error / list
-- states; one addressable so help copy ("what are library
-- releases?") binds to a stable UUID regardless of state.
--   - library_releases_outstanding
--
-- Idempotent: ON CONFLICT DO NOTHING against the sibling-unique
-- index (parent_id IS NULL + kind + name).
-- ============================================================

BEGIN;

INSERT INTO page_addressables (parent_id, kind, name, address, page_route, source)
VALUES
    (NULL, 'panel', 'library_releases_outstanding', 'samantha._viewport.app._panel.library_releases_outstanding', '/library-releases', 'build')
ON CONFLICT DO NOTHING;

COMMIT;
