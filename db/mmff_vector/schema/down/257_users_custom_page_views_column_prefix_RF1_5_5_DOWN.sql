-- ============================================================
-- 257_users_custom_page_views_column_prefix_RF1_5_5_DOWN.sql
--
-- Reverses 257_users_custom_page_views_column_prefix_RF1_5_5.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT users_custom_page_views_id_page_fkey
                  TO user_custom_page_views_page_id_fkey;

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT users_custom_page_views_label_chk
                  TO user_custom_page_views_label_nonempty;

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT users_custom_page_views_id_page_position_unique
                  TO user_custom_page_views_unique_position;

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT users_custom_page_views_id_page_label_unique
                  TO user_custom_page_views_unique_label;

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT users_custom_page_views_pkey
                  TO user_custom_page_views_pkey;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_users_custom_page_views_id_page_position RENAME TO idx_user_custom_page_views_page;

-- ---- Column renames (reverse) ----

ALTER TABLE users_custom_page_views RENAME COLUMN users_custom_page_views_updated_at TO updated_at;
ALTER TABLE users_custom_page_views RENAME COLUMN users_custom_page_views_created_at TO created_at;
ALTER TABLE users_custom_page_views RENAME COLUMN users_custom_page_views_config     TO config;
ALTER TABLE users_custom_page_views RENAME COLUMN users_custom_page_views_position   TO position;
ALTER TABLE users_custom_page_views RENAME COLUMN users_custom_page_views_kind       TO kind;
ALTER TABLE users_custom_page_views RENAME COLUMN users_custom_page_views_label      TO label;
ALTER TABLE users_custom_page_views RENAME COLUMN users_custom_page_views_id_page    TO page_id;
ALTER TABLE users_custom_page_views RENAME COLUMN users_custom_page_views_id         TO id;

COMMIT;
