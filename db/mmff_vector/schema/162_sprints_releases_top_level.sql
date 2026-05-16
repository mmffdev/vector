-- ============================================================
-- MMFFDev - Vector: Move Sprints + Releases to top-level routes
-- Migration 162
--
-- Sprints and Releases were originally seeded under /planning/...
-- (migrations 129 and 138) but they are top-level destinations,
-- not nested planning sub-routes. This migration:
--
--   1. Updates pages.href to /sprints and /releases.
--   2. Renames pages.key_enum from 'planning/sprints'/'planning/releases'
--      to plain 'sprints'/'releases' for consistency.
--   3. Migrates user_nav_prefs.item_key references to the new keys
--      so existing pinning rows survive the rename.
--
-- tag_enum stays 'planning' — they remain grouped under the Planning
-- section in the rail/flyout.
-- ============================================================

BEGIN;

-- Step 1: rename keys + hrefs on the page rows
UPDATE pages
   SET key_enum = 'sprints',
       href     = '/sprints'
 WHERE key_enum         = 'planning/sprints'
   AND subscription_id IS NULL
   AND created_by      IS NULL;

UPDATE pages
   SET key_enum = 'releases',
       href     = '/releases'
 WHERE key_enum         = 'planning/releases'
   AND subscription_id IS NULL
   AND created_by      IS NULL;

-- Step 2: migrate user_nav_prefs.item_key references
UPDATE user_nav_prefs
   SET item_key = 'sprints'
 WHERE item_key = 'planning/sprints';

UPDATE user_nav_prefs
   SET item_key = 'releases'
 WHERE item_key = 'planning/releases';

COMMIT;
