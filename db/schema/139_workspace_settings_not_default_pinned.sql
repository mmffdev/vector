-- ============================================================
-- Migration 139 — fix workspace-settings default_pinned flag
--
-- workspace-settings is gadmin-only, but was incorrectly marked
-- as default_pinned=TRUE. When padmin first creates navigation
-- preferences, the frontend initializes with all defaultPinned items,
-- but padmin lacks role permission for workspace-settings, causing
-- the save to fail with "The request was not valid" (ErrRoleForbidden).
--
-- Fix: Mark workspace-settings as default_pinned=FALSE so it is not
-- included in default pinned lists for users who can't see it.
-- ============================================================

BEGIN;

UPDATE pages
SET default_pinned = FALSE
WHERE key_enum = 'workspace-settings';

COMMIT;
