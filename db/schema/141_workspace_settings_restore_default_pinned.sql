-- ============================================================
-- Migration 141 — restore workspace-settings default_pinned flag
--
-- Migration 139 incorrectly set workspace-settings.default_pinned = FALSE
-- as a workaround. The correct fix was to grant padmin access to
-- workspace-settings (done in migration 140).
--
-- Restore workspace-settings.default_pinned = TRUE so padmin sees it
-- in their default pinned navigation items alongside gadmin.
-- ============================================================

BEGIN;

UPDATE pages
SET default_pinned = TRUE
WHERE key_enum = 'workspace-settings';

COMMIT;
