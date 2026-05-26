-- ============================================================
-- 255_users_tab_order_column_prefix_RF1_5_1_DOWN.sql
--
-- Reverses 255_users_tab_order_column_prefix_RF1_5_1.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE users_tab_order
    RENAME CONSTRAINT users_tab_order_id_user_fkey
                  TO user_tab_order_user_id_fkey;

ALTER TABLE users_tab_order
    RENAME CONSTRAINT users_tab_order_id_user_id_subscription_page_id_tab_key_unique
                  TO user_tab_order_unique_tab;

ALTER TABLE users_tab_order
    RENAME CONSTRAINT users_tab_order_id_user_id_subscription_page_id_position_unique
                  TO user_tab_order_unique_position;

ALTER TABLE users_tab_order
    RENAME CONSTRAINT users_tab_order_id_subscription_fkey
                  TO user_tab_order_subscription_id_fkey;

ALTER TABLE users_tab_order
    RENAME CONSTRAINT users_tab_order_pkey
                  TO user_tab_order_pkey;

-- ---- Plain index renames (reverse) ----

ALTER INDEX idx_users_tab_order_id_user_id_subscription_page_id_position
    RENAME TO idx_user_tab_order_lookup;

-- ---- Column renames (reverse) ----

ALTER TABLE users_tab_order RENAME COLUMN users_tab_order_updated_at        TO updated_at;
ALTER TABLE users_tab_order RENAME COLUMN users_tab_order_created_at        TO created_at;
ALTER TABLE users_tab_order RENAME COLUMN users_tab_order_position          TO "position";
ALTER TABLE users_tab_order RENAME COLUMN users_tab_order_tab_key           TO tab_key;
ALTER TABLE users_tab_order RENAME COLUMN users_tab_order_page_id           TO page_id;
ALTER TABLE users_tab_order RENAME COLUMN users_tab_order_id_subscription   TO subscription_id;
ALTER TABLE users_tab_order RENAME COLUMN users_tab_order_id_user           TO user_id;
ALTER TABLE users_tab_order RENAME COLUMN users_tab_order_id                TO id;

COMMIT;
