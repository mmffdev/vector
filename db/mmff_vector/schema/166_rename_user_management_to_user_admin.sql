-- ============================================================
-- MMFFDev - Vector: Rename 'User Management' nav bucket to 'User Admin'
-- Migration 166
--
-- The User Management nav group label is per-user data (seeded in
-- migration 151) — every padmin and gadmin has a user_nav_groups row
-- labelled 'User Management'. Rename it to the shorter 'User Admin'
-- so it fits the rail label area cleanly without word-breaking.
--
-- The `label` column has a case-insensitive uniqueness constraint
-- per user, so we update by lowercase match.
-- ============================================================

BEGIN;

UPDATE user_nav_groups
   SET label = 'User Admin'
 WHERE LOWER(label) = 'user management';

COMMIT;
