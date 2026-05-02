-- ============================================================
-- MMFFDev - Vector: Canonical default order for the Planning nav group
-- Migration 073
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 073_planning_canonical_order.sql
--
-- Establishes the catalogue's canonical top-to-bottom order for the
-- "planning" tag. This is the *default* state — applied to new users
-- via the auto-pin backfill in nav.GetPrefsForProfile, which inserts
-- new prefs ORDER BY pages.default_order, key_enum.
--
--   1. Portfolio
--   2. Portfolio Items
--   3. Work Items
--   4. Planning
--   5. Backlog
--   6. Scope
--
-- We deliberately do NOT rewrite existing user_nav_prefs rows: any
-- user who has reordered their planning items in personal navigation
-- settings keeps their override. Only the default for new users (and
-- for new pages auto-pinned into existing users' Default profile) is
-- changed by this migration.
-- ============================================================

BEGIN;

UPDATE pages SET default_order = 0 WHERE key_enum = 'portfolio'       AND created_by IS NULL AND subscription_id IS NULL;
UPDATE pages SET default_order = 1 WHERE key_enum = 'portfolio-items' AND created_by IS NULL AND subscription_id IS NULL;
UPDATE pages SET default_order = 2 WHERE key_enum = 'work-items'      AND created_by IS NULL AND subscription_id IS NULL;
UPDATE pages SET default_order = 3 WHERE key_enum = 'planning'        AND created_by IS NULL AND subscription_id IS NULL;
UPDATE pages SET default_order = 4 WHERE key_enum = 'backlog'         AND created_by IS NULL AND subscription_id IS NULL;
UPDATE pages SET default_order = 5 WHERE key_enum = 'scope'           AND created_by IS NULL AND subscription_id IS NULL;

COMMIT;
