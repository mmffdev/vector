-- ============================================================
-- 262_subscriptions_column_prefix_RF1_5_6_DOWN.sql
--
-- Reverses 262_subscriptions_column_prefix_RF1_5_6.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE subscriptions
    RENAME CONSTRAINT subscriptions_tier_chk
                  TO subscriptions_tier_check;

-- ---- Column renames (reverse) ----

ALTER TABLE subscriptions RENAME COLUMN subscriptions_tier        TO tier;
ALTER TABLE subscriptions RENAME COLUMN subscriptions_updated_at  TO updated_at;
ALTER TABLE subscriptions RENAME COLUMN subscriptions_created_at  TO created_at;
ALTER TABLE subscriptions RENAME COLUMN subscriptions_is_active   TO is_active;
ALTER TABLE subscriptions RENAME COLUMN subscriptions_slug        TO slug;
ALTER TABLE subscriptions RENAME COLUMN subscriptions_name        TO name;
ALTER TABLE subscriptions RENAME COLUMN subscriptions_id          TO id;

COMMIT;
