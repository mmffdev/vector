-- ============================================================
-- MMFFDev - Vector: Rename 'User Management' nav bucket to 'User Admin'
-- Migration 168
--
-- Coordinated rename of the 'User Management' user_nav_groups label
-- to 'User Admin'. This migration is paired with simultaneous
-- updates to:
--   - backend/internal/nav/service.go — the lazy-seed VALUES and
--     heal-mapping rows now read 'User Admin' / 'user admin'
--   - app/redesign/components/AccountFlyout.tsx — label updated
--
-- A previous attempt (migration 166) renamed the DB rows without
-- updating the Go heal routine, causing the rail to render empty
-- because the heal mapping couldn't bind pages to the renamed
-- group. Migration 167 reverted to the safe state; this migration
-- redoes the rename now that the heal routine matches.
-- ============================================================

BEGIN;

UPDATE user_nav_groups
   SET label = 'User Admin'
 WHERE LOWER(label) = 'user management';

COMMIT;
