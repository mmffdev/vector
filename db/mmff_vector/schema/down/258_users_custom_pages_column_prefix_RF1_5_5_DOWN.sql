-- ============================================================
-- 258_users_custom_pages_column_prefix_RF1_5_5_DOWN.sql
--
-- Reverses 258_users_custom_pages_column_prefix_RF1_5_5.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT users_custom_pages_id_user_fkey
                  TO user_custom_pages_user_id_fkey;

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT users_custom_pages_id_subscription_fkey
                  TO user_custom_pages_subscription_id_fkey;

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT users_custom_pages_label_chk
                  TO user_custom_pages_label_nonempty;

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT users_custom_pages_id_user_id_subscription_label_unique
                  TO user_custom_pages_label_unique;

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT users_custom_pages_pkey
                  TO user_custom_pages_pkey;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_users_custom_pages_id_user_id_subscription RENAME TO idx_user_custom_pages_owner;

-- ---- Column renames (reverse) ----

ALTER TABLE users_custom_pages RENAME COLUMN users_custom_pages_updated_at        TO updated_at;
ALTER TABLE users_custom_pages RENAME COLUMN users_custom_pages_created_at        TO created_at;
ALTER TABLE users_custom_pages RENAME COLUMN users_custom_pages_icon              TO icon;
ALTER TABLE users_custom_pages RENAME COLUMN users_custom_pages_label             TO label;
ALTER TABLE users_custom_pages RENAME COLUMN users_custom_pages_id_subscription   TO subscription_id;
ALTER TABLE users_custom_pages RENAME COLUMN users_custom_pages_id_user           TO user_id;
ALTER TABLE users_custom_pages RENAME COLUMN users_custom_pages_id                TO id;

COMMIT;
