-- ============================================================
-- MMFFDev - Vector: Backfill /library-releases pin for existing gadmins
-- Migration 023 — applied on top of 022_library_releases_page.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 023_backfill_library_releases_pin.sql
--
-- Phase 3 follow-up: pages.default_pinned only seeds nav for users who
-- have NO existing prefs row. Every gadmin already has a pinned set, so
-- the new system page never appears in their sidebar without explicit
-- self-pin via Manage Nav. This migration backfills the pin for every
-- existing gadmin so the new page surfaces immediately.
--
-- Idempotent — re-running is a no-op (WHERE NOT EXISTS guard).
-- Scope:
--   - role = 'gadmin' (matches page_roles.role for library-releases)
--   - profile_id IS NULL (MVP always uses NULL — see migration 008 §11)
--   - position = max + 1 per (user, subscription) so we never collide
--     with an existing entry
--
-- One-shot, not a recurring concern. Future system pages with
-- default_pinned=true that should backfill must ship a sibling
-- migration like this one.
-- ============================================================

BEGIN;

INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT
    u.id,
    u.subscription_id,
    NULL,
    'library-releases',
    COALESCE(
        (SELECT MAX(unp.position) + 1
         FROM user_nav_prefs unp
         WHERE unp.user_id = u.id
           AND unp.subscription_id = u.subscription_id
           AND unp.profile_id IS NULL),
        0
    ),
    FALSE
FROM users u
WHERE u.role = 'gadmin'
  AND u.is_active = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM user_nav_prefs unp
      WHERE unp.user_id = u.id
        AND unp.subscription_id = u.subscription_id
        AND unp.profile_id IS NULL
        AND unp.item_key = 'library-releases'
  );

COMMIT;
