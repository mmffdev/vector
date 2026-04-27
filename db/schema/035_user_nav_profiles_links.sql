-- ============================================================
-- MMFFDev - Vector: link existing nav tables to profiles (Phase 5)
-- Migration 035 — applied on top of 034_user_nav_profiles.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 035_user_nav_profiles_links.sql
--
-- Two safe-to-run-on-NULL link changes that don't touch row data:
--
-- 1. user_nav_prefs.profile_id gets a real FK to user_nav_profiles.
--    The column has been nullable since migration 008 and is still
--    nullable here — the FK accepts NULLs. Migration 036 backfills
--    every row to a Default profile and then SETs NOT NULL inside
--    the same transaction as the backfill.
--
-- 2. users gains active_nav_profile_id (server-side active profile
--    for hot-desking — same profile follows the user across devices).
--    ON DELETE SET NULL so deleting a profile doesn't orphan users;
--    next nav read falls back to that user's Default.
--
-- user_nav_groups is intentionally NOT altered — groups stay user
-- scoped (the shared-pool hard rule). Per-profile placement lives
-- in the new user_nav_profile_groups junction (migration 034).
-- ============================================================

BEGIN;

-- ---- 1. user_nav_prefs.profile_id FK ---------------------------

ALTER TABLE user_nav_prefs
    ADD CONSTRAINT fk_user_nav_prefs_profile
        FOREIGN KEY (profile_id)
        REFERENCES user_nav_profiles(id)
        ON DELETE CASCADE;

-- ---- 2. users.active_nav_profile_id ----------------------------

ALTER TABLE users
    ADD COLUMN active_nav_profile_id UUID NULL
        REFERENCES user_nav_profiles(id)
        ON DELETE SET NULL;

-- Lookup index for the bootstrap path
-- (auth → load active profile → render sidebar).
CREATE INDEX idx_users_active_nav_profile
    ON users (active_nav_profile_id)
    WHERE active_nav_profile_id IS NOT NULL;

COMMIT;
