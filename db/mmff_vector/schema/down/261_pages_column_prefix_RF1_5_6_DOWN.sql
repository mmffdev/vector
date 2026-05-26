-- ============================================================
-- 261_pages_column_prefix_RF1_5_6_DOWN.sql
--
-- Reverses 261_pages_column_prefix_RF1_5_6.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE pages
    RENAME CONSTRAINT pages_id_subscription_fkey
                  TO pages_subscription_id_fkey;

ALTER TABLE pages
    RENAME CONSTRAINT pages_id_user_creator_fkey
                  TO pages_created_by_fkey;

ALTER TABLE pages
    RENAME CONSTRAINT pages_kind_chk
                  TO pages_kind_valid;

-- ---- Index renames (reverse) ----

ALTER INDEX pages_key_enum_id_subscription_id_user_creator_unique RENAME TO pages_unique_key_user;
ALTER INDEX pages_key_enum_system_unique                          RENAME TO pages_unique_key_system;
ALTER INDEX pages_key_enum_id_subscription_shared_unique          RENAME TO pages_unique_key_shared_subscription;
ALTER INDEX idx_pages_tag_enum                                    RENAME TO idx_pages_tag;
ALTER INDEX idx_pages_id_subscription                             RENAME TO idx_pages_subscription;
ALTER INDEX idx_pages_id_user_creator                             RENAME TO idx_pages_creator;

-- ---- Column renames (reverse) ----

ALTER TABLE pages RENAME COLUMN pages_updated_at         TO updated_at;
ALTER TABLE pages RENAME COLUMN pages_created_at         TO created_at;
ALTER TABLE pages RENAME COLUMN pages_id_subscription    TO subscription_id;
ALTER TABLE pages RENAME COLUMN pages_id_user_creator    TO created_by;
ALTER TABLE pages RENAME COLUMN pages_default_order      TO default_order;
ALTER TABLE pages RENAME COLUMN pages_default_pinned     TO default_pinned;
ALTER TABLE pages RENAME COLUMN pages_pinnable           TO pinnable;
ALTER TABLE pages RENAME COLUMN pages_kind               TO kind;
ALTER TABLE pages RENAME COLUMN pages_tag_enum           TO tag_enum;
ALTER TABLE pages RENAME COLUMN pages_icon               TO icon;
ALTER TABLE pages RENAME COLUMN pages_href               TO href;
ALTER TABLE pages RENAME COLUMN pages_label              TO label;
ALTER TABLE pages RENAME COLUMN pages_key_enum           TO key_enum;
ALTER TABLE pages RENAME COLUMN pages_id                 TO id;

COMMIT;
