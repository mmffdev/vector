-- ============================================================
-- MMFFDev - Vector: icon column on user_nav_groups
-- Migration 148 — adds per-group icon selection (parity with
-- user_nav_prefs.icon_override which already exists for pages).
-- Run: PGPASSWORD=... psql -h localhost -p 5435 -U mmff_dev -d mmff_vector \
--        -v ON_ERROR_STOP=1 -f db/schema/148_user_nav_groups_icon.sql
--
-- icon is NULL = "no override picked"; the rail consumer falls back
-- (today: a generic folder/group icon). When the user picks an icon in
-- /preferences/navigation the editor writes the string key here (the
-- same vocabulary used by user_nav_prefs.icon_override).
-- ============================================================

BEGIN;

ALTER TABLE user_nav_groups
    ADD COLUMN icon TEXT NULL
        CONSTRAINT user_nav_groups_icon_max CHECK (icon IS NULL OR length(icon) <= 64);

COMMIT;
