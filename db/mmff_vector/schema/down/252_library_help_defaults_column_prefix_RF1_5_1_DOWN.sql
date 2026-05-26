-- ============================================================
-- 252_library_help_defaults_column_prefix_RF1_5_1_DOWN.sql
--
-- Reverses 252_library_help_defaults_column_prefix_RF1_5_1.sql.
-- ============================================================

BEGIN;

-- ---- Column renames (reverse) ----

ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_image_urls   TO image_urls;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_video_embeds TO video_embeds;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_title        TO title;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_updated_at   TO updated_at;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_created_at   TO created_at;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_body_html    TO body_html;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_locale       TO locale;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_name_pattern TO name_pattern;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_kind         TO kind;
ALTER TABLE library_help_defaults RENAME COLUMN library_help_defaults_id           TO id;

COMMIT;
