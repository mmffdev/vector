-- ============================================================
-- 190_users_nav_family_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (9 of N — FINAL).
--
-- Applies the §2.3 column-prefix convention to the user-nav family:
--   • users_nav_prefs          (12 cols)
--   • users_nav_groups         (7 cols)
--   • users_nav_profiles       (9 cols)
--   • users_nav_profile_groups (7 cols)
--   • users_roles_pages        (3 cols — composite PK)
--
-- This is the LAST package on the TD-NAME-001 ledger. After this
-- migration `lint:column-prefix-convention` will report 0 findings
-- across 0 packages → ledger empties → lint flips to fail-on-
-- violation as the new architectural invariant.
--
-- §2.4 FK shapes applied throughout.
--
-- The FK column `users.active_nav_profile_id` on the parent users
-- table (which references users_nav_profiles) stays bare — the
-- users table itself is deferred under TD-NAME-001.
-- ============================================================

BEGIN;

-- ═════════════════════════════════════════════════════════════
-- users_nav_prefs (12 cols, 4 FKs)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE users_nav_prefs RENAME COLUMN id              TO users_nav_prefs_id;
ALTER TABLE users_nav_prefs RENAME COLUMN user_id         TO users_nav_prefs_id_user;
ALTER TABLE users_nav_prefs RENAME COLUMN subscription_id TO users_nav_prefs_id_subscription;
ALTER TABLE users_nav_prefs RENAME COLUMN profile_id      TO users_nav_prefs_id_profile;
ALTER TABLE users_nav_prefs RENAME COLUMN item_key        TO users_nav_prefs_item_key;
ALTER TABLE users_nav_prefs RENAME COLUMN position        TO users_nav_prefs_position;
ALTER TABLE users_nav_prefs RENAME COLUMN is_start_page   TO users_nav_prefs_is_start_page;
ALTER TABLE users_nav_prefs RENAME COLUMN created_at      TO users_nav_prefs_created_at;
ALTER TABLE users_nav_prefs RENAME COLUMN updated_at      TO users_nav_prefs_updated_at;
ALTER TABLE users_nav_prefs RENAME COLUMN parent_item_key TO users_nav_prefs_parent_item_key;
ALTER TABLE users_nav_prefs RENAME COLUMN group_id        TO users_nav_prefs_id_group;
ALTER TABLE users_nav_prefs RENAME COLUMN icon_override   TO users_nav_prefs_icon_override;

ALTER INDEX user_nav_prefs_pkey                       RENAME TO users_nav_prefs_pkey;
ALTER INDEX idx_user_nav_prefs_group                  RENAME TO idx_users_nav_prefs_group;
ALTER INDEX idx_user_nav_prefs_lookup                 RENAME TO idx_users_nav_prefs_lookup;
ALTER INDEX idx_user_nav_prefs_parent                 RENAME TO idx_users_nav_prefs_parent;
ALTER INDEX user_nav_prefs_one_start_page             RENAME TO uq_users_nav_prefs_one_start_page;
ALTER INDEX user_nav_prefs_unique_item                RENAME TO uq_users_nav_prefs_unique_item;
ALTER INDEX user_nav_prefs_unique_position_nested     RENAME TO uq_users_nav_prefs_unique_position_nested;
ALTER INDEX user_nav_prefs_unique_position_top        RENAME TO uq_users_nav_prefs_unique_position_top;

ALTER TABLE users_nav_prefs
    RENAME CONSTRAINT fk_user_nav_prefs_profile             TO users_nav_prefs_id_profile_fkey;
ALTER TABLE users_nav_prefs
    RENAME CONSTRAINT user_nav_prefs_group_id_fkey          TO users_nav_prefs_id_group_fkey;
ALTER TABLE users_nav_prefs
    RENAME CONSTRAINT user_nav_prefs_subscription_id_fkey   TO users_nav_prefs_id_subscription_fkey;
ALTER TABLE users_nav_prefs
    RENAME CONSTRAINT user_nav_prefs_user_id_fkey           TO users_nav_prefs_id_user_fkey;

-- ═════════════════════════════════════════════════════════════
-- users_nav_groups (7 cols, 1 FK)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE users_nav_groups RENAME COLUMN id         TO users_nav_groups_id;
ALTER TABLE users_nav_groups RENAME COLUMN user_id    TO users_nav_groups_id_user;
ALTER TABLE users_nav_groups RENAME COLUMN label      TO users_nav_groups_label;
ALTER TABLE users_nav_groups RENAME COLUMN position   TO users_nav_groups_position;
ALTER TABLE users_nav_groups RENAME COLUMN created_at TO users_nav_groups_created_at;
ALTER TABLE users_nav_groups RENAME COLUMN updated_at TO users_nav_groups_updated_at;
ALTER TABLE users_nav_groups RENAME COLUMN icon       TO users_nav_groups_icon;

ALTER INDEX user_nav_groups_pkey            RENAME TO users_nav_groups_pkey;
ALTER INDEX idx_user_nav_groups_user        RENAME TO idx_users_nav_groups_user;
ALTER INDEX uq_user_nav_groups_user_label_ci RENAME TO uq_users_nav_groups_user_label_ci;
ALTER INDEX user_nav_groups_unique_position  RENAME TO uq_users_nav_groups_unique_position;

ALTER TABLE users_nav_groups
    RENAME CONSTRAINT user_nav_groups_icon_max       TO users_nav_groups_icon_max;
ALTER TABLE users_nav_groups
    RENAME CONSTRAINT user_nav_groups_label_max      TO users_nav_groups_label_max;
ALTER TABLE users_nav_groups
    RENAME CONSTRAINT user_nav_groups_label_nonempty TO users_nav_groups_label_nonempty;
ALTER TABLE users_nav_groups
    RENAME CONSTRAINT user_nav_groups_user_id_fkey   TO users_nav_groups_id_user_fkey;

-- ═════════════════════════════════════════════════════════════
-- users_nav_profiles (9 cols, 2 FKs)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE users_nav_profiles RENAME COLUMN id              TO users_nav_profiles_id;
ALTER TABLE users_nav_profiles RENAME COLUMN user_id         TO users_nav_profiles_id_user;
ALTER TABLE users_nav_profiles RENAME COLUMN subscription_id TO users_nav_profiles_id_subscription;
ALTER TABLE users_nav_profiles RENAME COLUMN label           TO users_nav_profiles_label;
ALTER TABLE users_nav_profiles RENAME COLUMN position        TO users_nav_profiles_position;
ALTER TABLE users_nav_profiles RENAME COLUMN is_default      TO users_nav_profiles_is_default;
ALTER TABLE users_nav_profiles RENAME COLUMN start_page_key  TO users_nav_profiles_start_page_key;
ALTER TABLE users_nav_profiles RENAME COLUMN created_at      TO users_nav_profiles_created_at;
ALTER TABLE users_nav_profiles RENAME COLUMN updated_at      TO users_nav_profiles_updated_at;

ALTER INDEX user_nav_profiles_pkey                   RENAME TO users_nav_profiles_pkey;
ALTER INDEX idx_user_nav_profiles_user               RENAME TO idx_users_nav_profiles_user;
ALTER INDEX uq_user_nav_profiles_default_per_user    RENAME TO uq_users_nav_profiles_default_per_user;
ALTER INDEX uq_user_nav_profiles_label_ci            RENAME TO uq_users_nav_profiles_label_ci;
ALTER INDEX user_nav_profiles_unique_position        RENAME TO uq_users_nav_profiles_unique_position;

ALTER TABLE users_nav_profiles
    RENAME CONSTRAINT user_nav_profiles_label_max          TO users_nav_profiles_label_max;
ALTER TABLE users_nav_profiles
    RENAME CONSTRAINT user_nav_profiles_label_nonempty     TO users_nav_profiles_label_nonempty;
ALTER TABLE users_nav_profiles
    RENAME CONSTRAINT user_nav_profiles_position_nonneg    TO users_nav_profiles_position_nonneg;
ALTER TABLE users_nav_profiles
    RENAME CONSTRAINT user_nav_profiles_subscription_id_fkey TO users_nav_profiles_id_subscription_fkey;
ALTER TABLE users_nav_profiles
    RENAME CONSTRAINT user_nav_profiles_user_id_fkey       TO users_nav_profiles_id_user_fkey;

-- ═════════════════════════════════════════════════════════════
-- users_nav_profile_groups (7 cols, 3 FKs, XOR check on group_id/tag_enum)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE users_nav_profile_groups RENAME COLUMN profile_id    TO users_nav_profile_groups_id_profile;
ALTER TABLE users_nav_profile_groups RENAME COLUMN group_id      TO users_nav_profile_groups_id_group;
ALTER TABLE users_nav_profile_groups RENAME COLUMN position      TO users_nav_profile_groups_position;
ALTER TABLE users_nav_profile_groups RENAME COLUMN created_at    TO users_nav_profile_groups_created_at;
ALTER TABLE users_nav_profile_groups RENAME COLUMN id            TO users_nav_profile_groups_id;
ALTER TABLE users_nav_profile_groups RENAME COLUMN tag_enum      TO users_nav_profile_groups_tag_enum;
ALTER TABLE users_nav_profile_groups RENAME COLUMN icon_override TO users_nav_profile_groups_icon_override;

ALTER INDEX user_nav_profile_groups_pkey            RENAME TO users_nav_profile_groups_pkey;
ALTER INDEX idx_user_nav_profile_groups_group       RENAME TO idx_users_nav_profile_groups_id_group;
ALTER INDEX idx_user_nav_profile_groups_profile     RENAME TO idx_users_nav_profile_groups_id_profile;
ALTER INDEX uq_user_nav_profile_groups_group        RENAME TO uq_users_nav_profile_groups_group;
ALTER INDEX uq_user_nav_profile_groups_tag          RENAME TO uq_users_nav_profile_groups_tag;
ALTER INDEX user_nav_profile_groups_unique_position RENAME TO uq_users_nav_profile_groups_unique_position;

ALTER TABLE users_nav_profile_groups
    RENAME CONSTRAINT user_nav_profile_groups_kind_xor      TO users_nav_profile_groups_kind_xor;
ALTER TABLE users_nav_profile_groups
    RENAME CONSTRAINT user_nav_profile_groups_position_nonneg TO users_nav_profile_groups_position_nonneg;
ALTER TABLE users_nav_profile_groups
    RENAME CONSTRAINT user_nav_profile_groups_group_id_fkey   TO users_nav_profile_groups_id_group_fkey;
ALTER TABLE users_nav_profile_groups
    RENAME CONSTRAINT user_nav_profile_groups_profile_id_fkey TO users_nav_profile_groups_id_profile_fkey;
ALTER TABLE users_nav_profile_groups
    RENAME CONSTRAINT user_nav_profile_groups_tag_enum_fkey   TO users_nav_profile_groups_tag_enum_fkey;

-- ═════════════════════════════════════════════════════════════
-- users_roles_pages (3 cols, composite PK with enum, 2 FKs)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE users_roles_pages RENAME COLUMN page_id TO users_roles_pages_id_page;
ALTER TABLE users_roles_pages RENAME COLUMN role_id TO users_roles_pages_id_role;
ALTER TABLE users_roles_pages RENAME COLUMN role    TO users_roles_pages_role;

ALTER INDEX roles_pages_pkey            RENAME TO users_roles_pages_pkey;
ALTER INDEX idx_roles_pages_role        RENAME TO idx_users_roles_pages_role;
ALTER INDEX idx_roles_pages_role_id     RENAME TO idx_users_roles_pages_id_role;

ALTER TABLE users_roles_pages
    RENAME CONSTRAINT page_roles_page_id_fkey TO users_roles_pages_id_page_fkey;
ALTER TABLE users_roles_pages
    RENAME CONSTRAINT page_roles_role_id_fkey TO users_roles_pages_id_role_fkey;

-- ═════════════════════════════════════════════════════════════
-- Trigger rewrites
-- ═════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_user_nav_prefs_updated_at    ON users_nav_prefs;
DROP TRIGGER IF EXISTS trg_user_nav_groups_updated_at   ON users_nav_groups;
DROP TRIGGER IF EXISTS trg_user_nav_profiles_updated_at ON users_nav_profiles;

CREATE OR REPLACE FUNCTION fn_users_nav_prefs_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.users_nav_prefs_updated_at := now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION fn_users_nav_groups_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.users_nav_groups_updated_at := now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION fn_users_nav_profiles_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.users_nav_profiles_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_nav_prefs_touch_updated_at
BEFORE UPDATE ON users_nav_prefs FOR EACH ROW
EXECUTE FUNCTION fn_users_nav_prefs_touch_updated_at();

CREATE TRIGGER trg_users_nav_groups_touch_updated_at
BEFORE UPDATE ON users_nav_groups FOR EACH ROW
EXECUTE FUNCTION fn_users_nav_groups_touch_updated_at();

CREATE TRIGGER trg_users_nav_profiles_touch_updated_at
BEFORE UPDATE ON users_nav_profiles FOR EACH ROW
EXECUTE FUNCTION fn_users_nav_profiles_touch_updated_at();

COMMIT;
