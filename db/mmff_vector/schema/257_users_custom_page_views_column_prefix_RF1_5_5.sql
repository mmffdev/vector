-- ============================================================
-- 257_users_custom_page_views_column_prefix_RF1_5_5.sql
--
-- RF1.5.5 — Pillar 1 wave 4, table 1/4 (mmff_vector side).
--
-- Applies the §2.3 column-prefix convention to
-- users_custom_page_views (the per-page named-view slots for the
-- /p/{id} custom-pages surface). PK becomes <table>_id; FKs follow
-- §2.4 PK/FK shape (FK column = <table>_id_<target>[_<role>]).
--
-- Inbound: none.
-- Outbound: page_id → users_custom_pages(id) — FK auto-retargets
-- on the source column rename here. The target column on the
-- parent table also gets renamed by migration 258 in this same
-- wave; FKs track column oid, not name, so the constraint stays
-- valid through both renames.
--
-- Legacy `user_custom_page_views_*` constraint + index names get
-- normalised to the plural `users_custom_page_views_*` (matches
-- the current table name; singular form was a pre-rename relic).
-- Same pattern as wave-2 workspaces_fields (098).
--
-- Trigger `trg_user_custom_page_views_updated_at` currently calls
-- the shared `set_updated_at()` function; trigger-function repair
-- happens in migration 260 in this same wave.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE users_custom_page_views RENAME COLUMN id         TO users_custom_page_views_id;
ALTER TABLE users_custom_page_views RENAME COLUMN page_id    TO users_custom_page_views_id_page;
ALTER TABLE users_custom_page_views RENAME COLUMN label      TO users_custom_page_views_label;
ALTER TABLE users_custom_page_views RENAME COLUMN kind       TO users_custom_page_views_kind;
ALTER TABLE users_custom_page_views RENAME COLUMN position   TO users_custom_page_views_position;
ALTER TABLE users_custom_page_views RENAME COLUMN config     TO users_custom_page_views_config;
ALTER TABLE users_custom_page_views RENAME COLUMN created_at TO users_custom_page_views_created_at;
ALTER TABLE users_custom_page_views RENAME COLUMN updated_at TO users_custom_page_views_updated_at;

-- ---- Index renames ----

ALTER INDEX idx_user_custom_page_views_page RENAME TO idx_users_custom_page_views_id_page_position;

-- ---- Constraint renames (also renames the backing index for PK + unique) ----

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT user_custom_page_views_pkey
                  TO users_custom_page_views_pkey;

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT user_custom_page_views_unique_label
                  TO users_custom_page_views_id_page_label_unique;

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT user_custom_page_views_unique_position
                  TO users_custom_page_views_id_page_position_unique;

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT user_custom_page_views_label_nonempty
                  TO users_custom_page_views_label_chk;

ALTER TABLE users_custom_page_views
    RENAME CONSTRAINT user_custom_page_views_page_id_fkey
                  TO users_custom_page_views_id_page_fkey;

COMMIT;
