-- ============================================================
-- 254_vector_icons_column_prefix_RF1_5_1_DOWN.sql
--
-- Reverses 254_vector_icons_column_prefix_RF1_5_1.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE vector_icons
    RENAME CONSTRAINT vector_icons_pack_valid_chk        TO vi_pack_valid;

ALTER TABLE vector_icons
    RENAME CONSTRAINT vector_icons_name_nonempty_chk     TO vi_name_nonempty;

ALTER TABLE vector_icons
    RENAME CONSTRAINT vector_icons_label_nonempty_chk    TO vi_label_nonempty;

ALTER TABLE vector_icons
    RENAME CONSTRAINT vector_icons_default_for_valid_chk TO vi_default_for_valid;

-- ---- Index renames (reverse) ----

ALTER INDEX vector_icons_pack_name_unique                          RENAME TO vi_pack_name_unique;
ALTER INDEX idx_vector_icons_pack                                  RENAME TO idx_vi_pack;
ALTER INDEX idx_vector_icons_default_for_where_is_default_true     RENAME TO idx_vi_default_for;

-- ---- Column renames (reverse) ----

ALTER TABLE vector_icons RENAME COLUMN vector_icons_created_at  TO created_at;
ALTER TABLE vector_icons RENAME COLUMN vector_icons_default_for TO default_for;
ALTER TABLE vector_icons RENAME COLUMN vector_icons_is_default  TO is_default;
ALTER TABLE vector_icons RENAME COLUMN vector_icons_label       TO label;
ALTER TABLE vector_icons RENAME COLUMN vector_icons_name        TO name;
ALTER TABLE vector_icons RENAME COLUMN vector_icons_pack        TO pack;
ALTER TABLE vector_icons RENAME COLUMN vector_icons_id          TO id;

COMMIT;
