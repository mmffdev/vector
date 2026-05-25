-- DOWN for 245_value_nav_bucket.sql
-- Removes the Value bucket and its 4 child pages.
-- Note: live tables are `pages_tags` (plural) with prefixed columns
-- per the PLA-0049-era naming refactor.

BEGIN;

-- Step 1: drop the 4 Value pages (cascades to users_roles_pages via FK ON DELETE CASCADE).
DELETE FROM pages
 WHERE key_enum IN ('value-status', 'value-sprint', 'value-sprint-board', 'value-flow')
   AND created_by IS NULL
   AND subscription_id IS NULL;

-- Step 2: clean up any users_nav_prefs rows that pinned a Value page.
-- (item_key is text, not FK — needs explicit cleanup.)
DELETE FROM users_nav_prefs
 WHERE users_nav_prefs_item_key IN ('value-status', 'value-sprint', 'value-sprint-board', 'value-flow');

-- Step 3: clean up any users_nav_profile_groups placements for the value tag.
DELETE FROM users_nav_profile_groups
 WHERE users_nav_profile_groups_tag_enum = 'value';

-- Step 4: drop the 'value' tag itself.
DELETE FROM pages_tags WHERE pages_tags_tag_enum = 'value';

COMMIT;
