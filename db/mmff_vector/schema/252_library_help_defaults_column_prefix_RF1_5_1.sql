-- ============================================================
-- 252_library_help_defaults_column_prefix_RF1_5_1.sql
--
-- RF1.5.1 — Pillar 1 wave 1, table 2/5.
--
-- Applies the §2.3 column-prefix convention to library_help_defaults.
-- No FKs. PK becomes <table>_id; remaining columns are plain
-- prefixed.
--
-- Inbound FK from pages_help.pages_help_id_library_help_default
-- → library_help_defaults(id) is automatically retargeted by
-- Postgres on PK column rename.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE library_help_defaults RENAME COLUMN id           TO library_help_defaults_id;
ALTER TABLE library_help_defaults RENAME COLUMN kind         TO library_help_defaults_kind;
ALTER TABLE library_help_defaults RENAME COLUMN name_pattern TO library_help_defaults_name_pattern;
ALTER TABLE library_help_defaults RENAME COLUMN locale       TO library_help_defaults_locale;
ALTER TABLE library_help_defaults RENAME COLUMN body_html    TO library_help_defaults_body_html;
ALTER TABLE library_help_defaults RENAME COLUMN created_at   TO library_help_defaults_created_at;
ALTER TABLE library_help_defaults RENAME COLUMN updated_at   TO library_help_defaults_updated_at;
ALTER TABLE library_help_defaults RENAME COLUMN title        TO library_help_defaults_title;
ALTER TABLE library_help_defaults RENAME COLUMN video_embeds TO library_help_defaults_video_embeds;
ALTER TABLE library_help_defaults RENAME COLUMN image_urls   TO library_help_defaults_image_urls;

-- ---- Index renames ----

-- library_help_defaults_pkey + library_help_defaults_lookup already
-- carry the table prefix in their names — left untouched.

COMMIT;
