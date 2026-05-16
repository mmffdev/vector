-- ============================================================
-- Migration 140 — grant padmin access to workspace-settings
--
-- workspace-settings should be accessible to both padmin and gadmin.
-- This migration adds the padmin role to the roles_pages table for
-- workspace-settings, complementing the gadmin-only assignment from 009.
-- Padmin role enum: 'padmin'
-- Padmin role_id: 00000000-0000-0000-0000-00000000ad25 (seeded in 088)
-- ============================================================

BEGIN;

INSERT INTO roles_pages (page_id, role, role_id)
SELECT id, 'padmin'::user_role, '00000000-0000-0000-0000-00000000ad25'::uuid
FROM pages
WHERE key_enum = 'workspace-settings'
ON CONFLICT DO NOTHING;

COMMIT;
