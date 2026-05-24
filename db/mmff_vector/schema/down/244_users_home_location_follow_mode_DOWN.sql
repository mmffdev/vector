-- ============================================================
-- DOWN: 244_users_home_location_follow_mode.sql
--
-- Drops the column. No backfill / data preservation — the column
-- is a single boolean preference; users who flipped it ON will
-- need to flip it again after a re-apply.
--
-- Idempotent via IF EXISTS.
-- ============================================================

BEGIN;

ALTER TABLE users
    DROP COLUMN IF EXISTS home_location_follow_mode;

COMMIT;
