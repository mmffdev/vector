-- ============================================================
-- MMFFDev - Vector: scope user_nav_prefs unique position by parent
-- Migration 037 — applied on top of 036_backfill_default_profiles.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 037_user_nav_prefs_position_per_parent.sql
--
-- Bug fix: the original unique constraint from migration 008 was
--     UNIQUE (user_id, tenant_id, profile_id, position)
-- which (after the 011 rename to subscription_id and the 011 addition
-- of parent_item_key for sub-pages) collides whenever a top-level
-- pin and a nested child happen to share a position number.
--
-- Position is RELATIVE to parent in the data model — top-level items
-- are positioned among themselves, sub-pages are positioned among
-- their siblings under a given parent. The constraint was never
-- updated when sub-pages landed in 011, so any save that nested a
-- custom page under another fired
--   23505 duplicate key value violates unique constraint
--         "user_nav_prefs_unique_position"
-- and 500'd /api/nav/prefs.
--
-- Fix: drop the old constraint, replace with two PARTIAL UNIQUE
-- indexes (one per parent regime). Partial indexes can't be
-- DEFERRABLE, but the service uses DELETE-then-INSERT inside a
-- single transaction, so the deferred-check window the original
-- constraint provided isn't needed.
-- ============================================================

BEGIN;

ALTER TABLE user_nav_prefs
    DROP CONSTRAINT user_nav_prefs_unique_position;

CREATE UNIQUE INDEX user_nav_prefs_unique_position_top
    ON user_nav_prefs (user_id, subscription_id, profile_id, position)
    WHERE parent_item_key IS NULL;

CREATE UNIQUE INDEX user_nav_prefs_unique_position_nested
    ON user_nav_prefs (user_id, subscription_id, profile_id, parent_item_key, position)
    WHERE parent_item_key IS NOT NULL;

COMMIT;
