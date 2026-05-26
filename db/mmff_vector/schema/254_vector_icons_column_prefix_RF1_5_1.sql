-- ============================================================
-- 254_vector_icons_column_prefix_RF1_5_1.sql
--
-- RF1.5.1 — Pillar 1 wave 1, table 4/5.
--
-- Applies the §2.3 column-prefix convention to vector_icons.
-- No FKs. PK becomes <table>_id; remaining columns are plain
-- prefixed.
--
-- Legacy `vi_*` constraint + index names get normalised to
-- `vector_icons_*` so future readers don't trip over the
-- abbreviation.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE vector_icons RENAME COLUMN id          TO vector_icons_id;
ALTER TABLE vector_icons RENAME COLUMN pack        TO vector_icons_pack;
ALTER TABLE vector_icons RENAME COLUMN name        TO vector_icons_name;
ALTER TABLE vector_icons RENAME COLUMN label       TO vector_icons_label;
ALTER TABLE vector_icons RENAME COLUMN is_default  TO vector_icons_is_default;
ALTER TABLE vector_icons RENAME COLUMN default_for TO vector_icons_default_for;
ALTER TABLE vector_icons RENAME COLUMN created_at  TO vector_icons_created_at;

-- ---- Index renames (legacy `vi_*` / `idx_vi_*` → table-prefixed) ----

ALTER INDEX idx_vi_default_for   RENAME TO idx_vector_icons_default_for_where_is_default_true;
ALTER INDEX idx_vi_pack          RENAME TO idx_vector_icons_pack;
ALTER INDEX vi_pack_name_unique  RENAME TO vector_icons_pack_name_unique;

-- ---- Constraint renames (legacy `vi_*` → table-prefixed) ----

ALTER TABLE vector_icons
    RENAME CONSTRAINT vi_default_for_valid TO vector_icons_default_for_valid_chk;

ALTER TABLE vector_icons
    RENAME CONSTRAINT vi_label_nonempty    TO vector_icons_label_nonempty_chk;

ALTER TABLE vector_icons
    RENAME CONSTRAINT vi_name_nonempty     TO vector_icons_name_nonempty_chk;

ALTER TABLE vector_icons
    RENAME CONSTRAINT vi_pack_valid        TO vector_icons_pack_valid_chk;

COMMIT;
