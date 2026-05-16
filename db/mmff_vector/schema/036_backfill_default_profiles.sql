-- ============================================================
-- MMFFDev - Vector: backfill Default profiles for existing users (Phase 5)
-- Migration 036 — applied on top of 035_user_nav_profiles_links.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 036_backfill_default_profiles.sql
--
-- Idempotent backfill that takes the profile system from "schema
-- exists, no rows" to "every existing user has a Default profile,
-- their existing prefs and group placements live inside it, and
-- the column they were always supposed to fill is now NOT NULL."
--
-- Steps (all in one transaction so partial failure rolls back):
--
--   0. Renumber positions on orphan prefs (profile_id IS NULL) so each
--      (user, subscription) has a contiguous 0..N-1 sequence. Required
--      because the unique constraint on user_nav_prefs treats NULL
--      profile_id as distinct, which let pre-existing data accumulate
--      duplicate positions; once step 2 collapses those NULLs onto a
--      single Default UUID, the dupes would violate uniqueness.
--   1. INSERT one Default profile per (user_id, subscription_id) that
--      already has user_nav_prefs rows. Skip pairs that already have
--      a Default (re-run safe via the partial-unique index).
--   2. UPDATE user_nav_prefs.profile_id to that Default's id, only
--      where profile_id IS NULL (re-run safe). Followed by
--      SET CONSTRAINTS ALL IMMEDIATE so any deferrable unique
--      constraints fire here, before the ALTER below — Postgres
--      refuses to ALTER a table with pending trigger events.
--   3. ALTER user_nav_prefs.profile_id SET NOT NULL — every prefs row
--      now has a profile, the FK from migration 035 is enforceable.
--   4. INSERT user_nav_profile_groups for every existing group × every
--      one of that user's Default profiles. Uses ON CONFLICT DO NOTHING
--      against the (profile_id, group_id) primary key so re-runs are
--      no-ops. Position copied from user_nav_groups.position (already
--      unique per user → unique per profile after the cross-product).
--   5. UPDATE users.active_nav_profile_id to that user's Default
--      where it's still NULL.
--
-- NOT covered (intentionally):
--   - Users who have user_nav_groups but no user_nav_prefs: no
--     subscription context to anchor a Default to. They'll get a
--     Default lazy-seeded on their first /api/nav/prefs request
--     (story B5: lazy-seed + role-aware Default).
--   - Users with no nav data of any kind: same — lazy seed on first read.
-- ============================================================

BEGIN;

-- ---- 0. Dedupe positions on orphan prefs ----------------------
-- The (user_id, subscription_id, profile_id, position) unique constraint
-- treats NULL profile_id as distinct, so historical rows accumulated
-- duplicate (user, sub, position) tuples while profile_id was NULL.
-- Renumber per (user, subscription) so positions are contiguous 0..N-1
-- BEFORE step 2 collapses every NULL onto the same Default UUID.
-- Idempotent: rows already in canonical order produce zero updates.

WITH renumbered AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, subscription_id
               ORDER BY position, item_key
           ) - 1 AS new_position
      FROM user_nav_prefs
     WHERE profile_id IS NULL
)
UPDATE user_nav_prefs p
   SET position = r.new_position
  FROM renumbered r
 WHERE p.id       = r.id
   AND p.position <> r.new_position;

-- ---- 1. Insert one Default per (user, subscription) -----------
-- Distinct pairs from existing prefs become Default profiles.
-- WHERE NOT EXISTS guard makes this re-runnable.

INSERT INTO user_nav_profiles
    (user_id, subscription_id, label, position, is_default, start_page_key)
SELECT DISTINCT
    p.user_id,
    p.subscription_id,
    'Default',
    0,
    TRUE,
    NULL
FROM user_nav_prefs p
WHERE NOT EXISTS (
    SELECT 1 FROM user_nav_profiles d
     WHERE d.user_id         = p.user_id
       AND d.subscription_id = p.subscription_id
       AND d.is_default      = TRUE
);

-- ---- 2. Backfill user_nav_prefs.profile_id --------------------
-- Every prefs row gets pointed at its Default profile.

UPDATE user_nav_prefs p
   SET profile_id = d.id
  FROM user_nav_profiles d
 WHERE d.user_id         = p.user_id
   AND d.subscription_id = p.subscription_id
   AND d.is_default      = TRUE
   AND p.profile_id      IS NULL;

-- Force any deferrable constraints to validate now. Without this,
-- the ALTER below fails with "cannot ALTER TABLE ... because it has
-- pending trigger events". Step 0 already guarantees positions are
-- unique, so this only validates — it never raises.
SET CONSTRAINTS ALL IMMEDIATE;

-- ---- 3. Lock the column down ----------------------------------
-- Now safe — no NULLs left in profile_id.

ALTER TABLE user_nav_prefs
    ALTER COLUMN profile_id SET NOT NULL;

-- ---- 4. Seed user_nav_profile_groups --------------------------
-- Each existing custom group gets placed in every Default profile
-- of its owner. Position copied from user_nav_groups.position
-- (already unique per user, so unique per profile after the join).
-- ON CONFLICT DO NOTHING for re-run safety.

INSERT INTO user_nav_profile_groups (profile_id, group_id, position)
SELECT
    d.id,
    g.id,
    g.position
FROM user_nav_groups g
JOIN user_nav_profiles d
  ON d.user_id    = g.user_id
 AND d.is_default = TRUE
ON CONFLICT (profile_id, group_id) DO NOTHING;

-- ---- 5. Set users.active_nav_profile_id ----------------------
-- Pick any of the user's Defaults if they have multiple subscriptions.
-- (Hot-desking: when the user signs in to a different subscription,
--  the API resolves to that subscription's Default if active is NULL
--  or belongs to a different subscription. Backend handles this in B3.)

UPDATE users u
   SET active_nav_profile_id = d.id
  FROM (
        SELECT DISTINCT ON (user_id)
            user_id,
            id
          FROM user_nav_profiles
         WHERE is_default = TRUE
         ORDER BY user_id, created_at, id
       ) d
 WHERE d.user_id              = u.id
   AND u.active_nav_profile_id IS NULL;

COMMIT;
