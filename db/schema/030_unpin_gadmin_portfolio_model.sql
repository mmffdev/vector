-- ============================================================
-- MMFFDev - Vector: Unpin /portfolio-model from gadmins + drop gadmin from page_roles
-- Migration 030 — applied on top of 029_adoption_mirror_tables.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 030_unpin_gadmin_portfolio_model.sql
--
-- Background:
--   Migration 020 originally seeded /portfolio-model with both padmin
--   and gadmin in page_roles, and migration 024 backfilled a pinned
--   user_nav_prefs row for both audiences. That choice has since been
--   reversed at the product level: the portfolio model is a
--   padmin-only concern (product owner workspace), not a gadmin
--   (tech/support) surface. See feedback_role_boundaries — gadmin must
--   not see portfolio-model in nav, and the page itself must not be
--   gated to gadmin.
--
--   This migration removes the gadmin grant from page_roles and
--   cleans up any leftover pins that 024 created for gadmins. The
--   padmin grant and any padmin pins are left untouched.
--
-- Idempotent: re-running is a no-op (both DELETEs become 0-row
-- operations once applied).
--
-- Schema notes (verified against live DB on 2026-04-25):
--   page_roles      → (page_id UUID FK → pages.id, role user_role)
--                     joined to pages via pages.key_enum = 'portfolio-model'
--   user_nav_prefs  → (user_id, subscription_id, item_key, ...)
--                     pin recorded as item_key = 'portfolio-model'
-- ============================================================

BEGIN;

-- 1) Remove the gadmin grant on /portfolio-model from page_roles.
--    Tightly scoped: matches exactly one row (the gadmin grant on the
--    system-scoped portfolio-model page seeded in migration 020). The
--    padmin row is left untouched so padmins keep access.
DELETE FROM page_roles
WHERE role = 'gadmin'
  AND page_id IN (
      SELECT id
      FROM pages
      WHERE key_enum = 'portfolio-model'
        AND subscription_id IS NULL
        AND created_by IS NULL
  );

-- 2) Remove orphaned pinned nav entries for gadmins.
--    Migration 024 backfilled a pinned 'portfolio-model' entry for
--    every active padmin AND gadmin. Now that gadmins lose access we
--    delete only the gadmin pins; padmin pins are preserved.
DELETE FROM user_nav_prefs
WHERE item_key = 'portfolio-model'
  AND user_id IN (
      SELECT id FROM users WHERE role = 'gadmin'
  );

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- The page_roles deletion is fully reversible — re-INSERT the row
-- using the same shape as migration 020. The user_nav_prefs deletion
-- is NOT cleanly reversible: each pin had a per-user `position` in
-- the user's sidebar that we did not snapshot here. The most we can
-- do is re-run the migration 024 backfill logic, which will append
-- 'portfolio-model' to the bottom of each gadmin's sidebar. If the
-- precise prior position matters, restore from a pre-migration
-- backup instead.
--
-- BEGIN;
--
-- INSERT INTO page_roles (page_id, role)
-- SELECT id, 'gadmin'::user_role
-- FROM pages
-- WHERE key_enum = 'portfolio-model'
--   AND subscription_id IS NULL
--   AND created_by IS NULL
-- ON CONFLICT DO NOTHING;
--
-- INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
-- SELECT
--     u.id,
--     u.subscription_id,
--     NULL,
--     'portfolio-model',
--     COALESCE(
--         (SELECT MAX(unp.position) + 1
--          FROM user_nav_prefs unp
--          WHERE unp.user_id = u.id
--            AND unp.subscription_id = u.subscription_id
--            AND unp.profile_id IS NULL),
--         0
--     ),
--     FALSE
-- FROM users u
-- WHERE u.role = 'gadmin'
--   AND u.is_active = TRUE
--   AND NOT EXISTS (
--       SELECT 1 FROM user_nav_prefs unp
--       WHERE unp.user_id = u.id
--         AND unp.subscription_id = u.subscription_id
--         AND unp.profile_id IS NULL
--         AND unp.item_key = 'portfolio-model'
--   );
--
-- COMMIT;
-- ============================================================
