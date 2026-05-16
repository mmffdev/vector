-- ============================================================
-- MMFFDev - Vector: Default-pin the Product entity bookmark
-- Migration 038 — applied on top of 037_user_nav_prefs_position_per_parent.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 038_pin_product_entity_bookmark.sql
--
-- The dev subscription's Product entity bookmark
--   key_enum = 'entity:product:9320b036-816b-41a7-aa6f-4033ee07d2f6'
-- was kind='entity', default_pinned=FALSE, so it surfaced in the
-- "Available" pool of nav preferences but never landed in any
-- user's pinned sidebar. Padmin asked for it pinned by default.
--
-- Two changes:
--
--   1. UPDATE pages.default_pinned = TRUE for that single row.
--      Records intent; the auto-pin loop in nav.GetPrefsForProfile
--      currently only fires for system pages (subscription_id IS
--      NULL), so this UPDATE alone does NOT seed existing users —
--      step 2 covers that.
--
--   2. INSERT a user_nav_prefs row into every existing user's
--      Default profile, scoped to the entity's owning subscription
--      (00000000-...-001). Audience comes from page_roles for the
--      entity (user + padmin + gadmin). Append to the bottom of
--      each Default profile's existing pin list. Idempotent via
--      NOT EXISTS guard.
-- ============================================================

BEGIN;

-- 1. Flip default_pinned on the page row.
UPDATE pages
   SET default_pinned = TRUE,
       updated_at     = NOW()
 WHERE key_enum       = 'entity:product:9320b036-816b-41a7-aa6f-4033ee07d2f6'
   AND subscription_id = '00000000-0000-0000-0000-000000000001'
   AND kind            = 'entity';

-- 2. Backfill: pin into every eligible user's Default profile.
INSERT INTO user_nav_prefs
    (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT
    u.id,
    u.subscription_id,
    d.id,
    'entity:product:9320b036-816b-41a7-aa6f-4033ee07d2f6',
    COALESCE(
        (SELECT MAX(unp.position) + 1
           FROM user_nav_prefs unp
          WHERE unp.user_id         = u.id
            AND unp.subscription_id = u.subscription_id
            AND unp.profile_id      = d.id
            AND unp.parent_item_key IS NULL),
        0
    ),
    FALSE
  FROM users u
  JOIN user_nav_profiles d
    ON d.user_id         = u.id
   AND d.subscription_id = u.subscription_id
   AND d.is_default      = TRUE
 WHERE u.subscription_id = '00000000-0000-0000-0000-000000000001'
   AND u.is_active       = TRUE
   AND u.role::text IN (
        SELECT pr.role::text
          FROM page_roles pr
          JOIN pages p ON p.id = pr.page_id
         WHERE p.key_enum        = 'entity:product:9320b036-816b-41a7-aa6f-4033ee07d2f6'
           AND p.subscription_id = '00000000-0000-0000-0000-000000000001'
   )
   AND NOT EXISTS (
        SELECT 1 FROM user_nav_prefs unp
         WHERE unp.user_id         = u.id
           AND unp.subscription_id = u.subscription_id
           AND unp.profile_id      = d.id
           AND unp.item_key        = 'entity:product:9320b036-816b-41a7-aa6f-4033ee07d2f6'
   );

COMMIT;
