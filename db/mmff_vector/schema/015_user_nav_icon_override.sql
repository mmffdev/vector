-- ============================================================
-- MMFFDev - Vector: per-user icon override on nav prefs
-- Migration 015 — applied on top of 014_page_theme.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 015_user_nav_icon_override.sql
--
-- Lets a user pick a different icon for any pinned nav row without
-- changing the catalogue (which is shared across all users in a tenant).
-- NULL means "use the registry default" (pages.icon).
-- The set of allowed values is enforced in the app (NavIcon switch);
-- we intentionally don't constrain in SQL so a future icon added on
-- the frontend doesn't require a migration.
-- ============================================================

BEGIN;

ALTER TABLE user_nav_prefs
    ADD COLUMN icon_override TEXT NULL;

COMMIT;
