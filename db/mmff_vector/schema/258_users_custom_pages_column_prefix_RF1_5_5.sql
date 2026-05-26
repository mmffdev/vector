-- ============================================================
-- 258_users_custom_pages_column_prefix_RF1_5_5.sql
--
-- RF1.5.5 — Pillar 1 wave 4, table 2/4 (mmff_vector side).
--
-- Applies the §2.3 column-prefix convention to users_custom_pages
-- (the /p/{id} per-user custom-page registry). PK becomes
-- <table>_id; FKs follow §2.4 PK/FK shape.
--
-- Inbound FK from users_custom_page_views.page_id → users_custom_pages(id)
-- is automatically retargeted on PK column rename. Migration 257
-- (run before this in the wave) renames that FK column too; the
-- constraint stays valid through both renames because FKs track
-- column oid, not name.
--
-- Outbound: user_id → users(id), subscription_id → subscriptions(id).
-- Both auto-retarget; target column names on parent tables stay
-- bare here — users + subscriptions are different waves.
--
-- Legacy `user_custom_pages_*` constraint + index names normalise
-- to plural `users_custom_pages_*` — singular form was a pre-rename
-- relic (same pattern as wave-2 workspaces_fields 098).
--
-- Trigger `trg_user_custom_pages_updated_at` currently calls the
-- shared `set_updated_at()` function; trigger-function repair
-- happens in migration 260 in this same wave.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE users_custom_pages RENAME COLUMN id              TO users_custom_pages_id;
ALTER TABLE users_custom_pages RENAME COLUMN user_id         TO users_custom_pages_id_user;
ALTER TABLE users_custom_pages RENAME COLUMN subscription_id TO users_custom_pages_id_subscription;
ALTER TABLE users_custom_pages RENAME COLUMN label           TO users_custom_pages_label;
ALTER TABLE users_custom_pages RENAME COLUMN icon            TO users_custom_pages_icon;
ALTER TABLE users_custom_pages RENAME COLUMN created_at      TO users_custom_pages_created_at;
ALTER TABLE users_custom_pages RENAME COLUMN updated_at      TO users_custom_pages_updated_at;

-- ---- Index renames ----

ALTER INDEX idx_user_custom_pages_owner RENAME TO idx_users_custom_pages_id_user_id_subscription;

-- ---- Constraint renames ----

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT user_custom_pages_pkey
                  TO users_custom_pages_pkey;

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT user_custom_pages_label_unique
                  TO users_custom_pages_id_user_id_subscription_label_unique;

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT user_custom_pages_label_nonempty
                  TO users_custom_pages_label_chk;

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT user_custom_pages_subscription_id_fkey
                  TO users_custom_pages_id_subscription_fkey;

ALTER TABLE users_custom_pages
    RENAME CONSTRAINT user_custom_pages_user_id_fkey
                  TO users_custom_pages_id_user_fkey;

COMMIT;
