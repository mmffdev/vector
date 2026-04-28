-- ============================================================
-- MMFFDev - Vector: per-user theme pack (Palette flyout)
-- Migration 039 — applied on top of 038_pin_product_entity_bookmark.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 039_user_theme_pack.sql
--
-- Adds users.theme_pack — the active stylesheet pack for this user,
-- selected from the avatar-menu Palette flyout. Drives the
-- /themes/<pack>.css <link> injected by the frontend useThemePack hook.
--
-- Why a hard-coded CHECK list rather than a separate themes table:
--   - Theme files are bundled static assets in /public/themes/, not
--     user-authored content. The set is small and changes only when
--     a developer ships a new stylesheet. A lookup table would buy
--     no flexibility and add a join to every user load.
--   - Adding a new pack later: extend the CHECK constraint in a
--     follow-up migration alongside the new CSS file.
--
-- NULL is treated as "default" by the API; we still set a column
-- default of 'default' so new accounts land on the warm Vector look.
-- ============================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN theme_pack TEXT NOT NULL DEFAULT 'default';

ALTER TABLE users
    ADD CONSTRAINT users_theme_pack_check
        CHECK (theme_pack IN ('default', 'vector-mono'));

COMMIT;
