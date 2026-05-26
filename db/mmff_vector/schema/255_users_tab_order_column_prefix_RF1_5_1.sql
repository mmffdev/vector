-- ============================================================
-- 255_users_tab_order_column_prefix_RF1_5_1.sql
--
-- RF1.5.1 — Pillar 1 wave 1, table 5/5.
--
-- Applies the §2.3 column-prefix convention to users_tab_order.
-- PK becomes <table>_id; FKs follow §2.4 shape; `page_id` is a
-- TEXT addressable-route key (app-soft reference, not a uuid FK),
-- so it gets plain prefix `users_tab_order_page_id` rather than
-- the `_id_<target>` form.
--
-- Legacy `user_tab_order_*` (singular) constraint + index names get
-- normalised to `users_tab_order_*` (plural — matches the table
-- name).
--
-- Note: Postgres unique/PK constraints share their object name with
-- the backing index. We rename via `ALTER TABLE RENAME CONSTRAINT`
-- (which propagates to the index) for the PK + uniques, and
-- `ALTER INDEX` only for the plain non-unique index.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE users_tab_order RENAME COLUMN id              TO users_tab_order_id;
ALTER TABLE users_tab_order RENAME COLUMN user_id         TO users_tab_order_id_user;
ALTER TABLE users_tab_order RENAME COLUMN subscription_id TO users_tab_order_id_subscription;
ALTER TABLE users_tab_order RENAME COLUMN page_id         TO users_tab_order_page_id;
ALTER TABLE users_tab_order RENAME COLUMN tab_key         TO users_tab_order_tab_key;
ALTER TABLE users_tab_order RENAME COLUMN "position"      TO users_tab_order_position;
ALTER TABLE users_tab_order RENAME COLUMN created_at      TO users_tab_order_created_at;
ALTER TABLE users_tab_order RENAME COLUMN updated_at      TO users_tab_order_updated_at;

-- ---- Plain (non-unique, non-PK) index renames ----

ALTER INDEX idx_user_tab_order_lookup
    RENAME TO idx_users_tab_order_id_user_id_subscription_page_id_position;

-- ---- Constraint renames (these also rename the backing index) ----

ALTER TABLE users_tab_order
    RENAME CONSTRAINT user_tab_order_pkey
                  TO users_tab_order_pkey;

ALTER TABLE users_tab_order
    RENAME CONSTRAINT user_tab_order_subscription_id_fkey
                  TO users_tab_order_id_subscription_fkey;

ALTER TABLE users_tab_order
    RENAME CONSTRAINT user_tab_order_unique_position
                  TO users_tab_order_id_user_id_subscription_page_id_position_unique;

ALTER TABLE users_tab_order
    RENAME CONSTRAINT user_tab_order_unique_tab
                  TO users_tab_order_id_user_id_subscription_page_id_tab_key_unique;

ALTER TABLE users_tab_order
    RENAME CONSTRAINT user_tab_order_user_id_fkey
                  TO users_tab_order_id_user_fkey;

COMMIT;
