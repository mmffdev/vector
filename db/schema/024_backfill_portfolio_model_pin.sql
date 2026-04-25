-- ============================================================
-- MMFFDev - Vector: Backfill /portfolio-model pin for existing padmins + gadmins
-- Migration 024 — applied on top of 023_backfill_library_releases_pin.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 024_backfill_portfolio_model_pin.sql
--
-- Same root cause as migration 023: pages.default_pinned only seeds
-- nav for users with no existing prefs row. Migration 020 registered
-- /portfolio-model with default_pinned=TRUE but every existing
-- padmin / gadmin already has a pinned set, so the page never
-- appeared in any sidebar.
--
-- Audience matches page_roles for 'portfolio-model' (see 020):
-- padmin + gadmin. Idempotent — re-running is a no-op.
-- ============================================================

BEGIN;

INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
SELECT
    u.id,
    u.subscription_id,
    NULL,
    'portfolio-model',
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
WHERE u.role IN ('padmin', 'gadmin')
  AND u.is_active = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM user_nav_prefs unp
      WHERE unp.user_id = u.id
        AND unp.subscription_id = u.subscription_id
        AND unp.profile_id IS NULL
        AND unp.item_key = 'portfolio-model'
  );

COMMIT;
