-- ============================================================
-- 261_pages_column_prefix_RF1_5_6.sql
--
-- RF1.5.6 — Pillar 1 wave 5, table 1/2 (mmff_vector side).
--
-- Applies the §2.3 column-prefix convention to mmff_vector.pages
-- (the page-registry table — holds 59 live rows; FK target for
-- page_entity_refs + users_roles_pages; text-by-value referent
-- for users_nav_prefs.users_nav_prefs_item_key, users_tab_order
-- entries, and users_nav_profiles.users_nav_profiles_start_page_key
-- via pages.key_enum → pages_key_enum).
--
-- PK becomes <table>_id per §2.4. FKs follow §2.4 PK/FK shape
-- (FK = <table>_id_<target>[_<role>]). `created_by` carries the
-- role-suffix `_creator` (analogous to admin_api_keys.created_by →
-- admin_api_keys_id_user_creator and the §2.4 role-suffix
-- precedent). `subscription_id` becomes pages_id_subscription per
-- the cost_centres precedent in 251.
--
-- Inbound FKs from page_entity_refs.page_entity_refs_id_page and
-- users_roles_pages.users_roles_pages_id_page → pages(id) are
-- auto-retargeted by Postgres on PK column rename (FKs track
-- column oid, not name). The outbound FK pages.subscription_id →
-- subscriptions(id) also auto-retargets on the source column
-- rename here; the target column name on subscriptions is renamed
-- in migration 262 in this same wave and likewise auto-retargets.
-- Same story for pages.created_by → users(id) and
-- pages.tag_enum → pages_tags(pages_tags_tag_enum).
--
-- Cascade trigger `trg_pages_cascade_nav_prefs` calls
-- `fn_pages_cascade_nav_prefs()` which currently references
-- OLD.key_enum — that function body is repaired in migration 263
-- in this same wave (alongside the set_updated_at trigger fix).
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE pages RENAME COLUMN id              TO pages_id;
ALTER TABLE pages RENAME COLUMN key_enum        TO pages_key_enum;
ALTER TABLE pages RENAME COLUMN label           TO pages_label;
ALTER TABLE pages RENAME COLUMN href            TO pages_href;
ALTER TABLE pages RENAME COLUMN icon            TO pages_icon;
ALTER TABLE pages RENAME COLUMN tag_enum        TO pages_tag_enum;
ALTER TABLE pages RENAME COLUMN kind            TO pages_kind;
ALTER TABLE pages RENAME COLUMN pinnable        TO pages_pinnable;
ALTER TABLE pages RENAME COLUMN default_pinned  TO pages_default_pinned;
ALTER TABLE pages RENAME COLUMN default_order   TO pages_default_order;
ALTER TABLE pages RENAME COLUMN created_by      TO pages_id_user_creator;
ALTER TABLE pages RENAME COLUMN subscription_id TO pages_id_subscription;
ALTER TABLE pages RENAME COLUMN created_at      TO pages_created_at;
ALTER TABLE pages RENAME COLUMN updated_at      TO pages_updated_at;

-- ---- Index renames ----

-- pages_pkey already matches the <table>_pkey convention.
ALTER INDEX idx_pages_creator                       RENAME TO idx_pages_id_user_creator;
ALTER INDEX idx_pages_subscription                  RENAME TO idx_pages_id_subscription;
ALTER INDEX idx_pages_tag                           RENAME TO idx_pages_tag_enum;
ALTER INDEX pages_unique_key_shared_subscription    RENAME TO pages_key_enum_id_subscription_shared_unique;
ALTER INDEX pages_unique_key_system                 RENAME TO pages_key_enum_system_unique;
ALTER INDEX pages_unique_key_user                   RENAME TO pages_key_enum_id_subscription_id_user_creator_unique;

-- ---- Constraint renames ----

ALTER TABLE pages
    RENAME CONSTRAINT pages_kind_valid
                  TO pages_kind_chk;

ALTER TABLE pages
    RENAME CONSTRAINT pages_created_by_fkey
                  TO pages_id_user_creator_fkey;

ALTER TABLE pages
    RENAME CONSTRAINT pages_subscription_id_fkey
                  TO pages_id_subscription_fkey;

-- pages_tag_enum_fkey already matches the <table>_<col>_fkey
-- convention — left untouched.

COMMIT;
