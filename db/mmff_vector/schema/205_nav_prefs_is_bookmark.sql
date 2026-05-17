-- Add is_bookmark flag to users_nav_prefs so explicitly bookmarked pages
-- can be distinguished from section-nav entries in the same table.
-- Default FALSE means all existing rows are treated as section entries.

ALTER TABLE users_nav_prefs
  ADD COLUMN users_nav_prefs_is_bookmark BOOLEAN NOT NULL DEFAULT FALSE;
