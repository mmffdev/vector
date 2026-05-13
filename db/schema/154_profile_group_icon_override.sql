-- ============================================================
-- MMFFDev - Vector: Add icon_override to user_nav_profile_groups
-- Migration 154
--
-- Allows users to override the display icon for built-in tag
-- bucket sections (Personal, Admin Settings, Planning, etc.)
-- on a per-profile basis, matching the existing icon override
-- pattern used by user_nav_prefs (per-item) and user_nav_groups
-- (per custom-group).
-- ============================================================

BEGIN;

ALTER TABLE user_nav_profile_groups
    ADD COLUMN IF NOT EXISTS icon_override TEXT;

COMMIT;
