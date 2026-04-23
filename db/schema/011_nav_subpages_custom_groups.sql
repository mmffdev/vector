-- ============================================================
-- MMFFDev - Vector: nav sub-pages + user custom groups
-- Migration 011 — applied on top of 010_nav_entity_bookmarks.sql
-- Run: PGPASSWORD=... psql -h localhost -p 5434 -U mmff_dev -d mmff_vector \
--        -v ON_ERROR_STOP=1 -f db/schema/011_nav_subpages_custom_groups.sql
--
-- Two related additions on top of the registry/grouping work:
--
-- 1. Sub-pages (one-level nesting). user_nav_prefs gains
--    parent_item_key TEXT NULL. The one-level rule and the
--    catalogue-lock rule (only kind='user_custom' pages may be
--    children) are enforced server-side in the validator — there
--    is no FK on parent_item_key because item_keys are synthetic
--    (entity:product:<uuid>, page:<id>, ...) and span tables.
--
-- 2. User-created primary groups. New table user_nav_groups holds
--    per-user custom group headers; user_nav_prefs gains
--    group_id UUID NULL referencing it. Resolution: if group_id
--    is set, the item lives in that custom group; else it lives
--    in its registry tag group. tag_enum on the page record is
--    retained either way (used as fallback when a custom group
--    is deleted).
--
-- Caps (max 10 custom groups, max 8 children per parent) are
-- enforced server-side, not via DB constraints, because they're
-- product policy and likely to move.
-- ============================================================

BEGIN;

-- ---- 1. Sub-pages -----------------------------------------------

ALTER TABLE user_nav_prefs
    ADD COLUMN parent_item_key TEXT NULL;

-- Hot path: load all children of a parent in order.
CREATE INDEX idx_user_nav_prefs_parent
    ON user_nav_prefs (user_id, tenant_id, profile_id, parent_item_key, position)
    WHERE parent_item_key IS NOT NULL;

-- ---- 2. Custom primary groups ------------------------------------

CREATE TABLE user_nav_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    position    INT  NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_nav_groups_label_nonempty CHECK (length(trim(label)) > 0),
    CONSTRAINT user_nav_groups_label_max     CHECK (length(label) <= 64),

    CONSTRAINT user_nav_groups_unique_position
        UNIQUE (user_id, position)
        DEFERRABLE INITIALLY DEFERRED
);

-- Case-insensitive uniqueness within a user's own groups.
CREATE UNIQUE INDEX uq_user_nav_groups_user_label_ci
    ON user_nav_groups (user_id, LOWER(label));

CREATE INDEX idx_user_nav_groups_user
    ON user_nav_groups (user_id, position);

CREATE TRIGGER trg_user_nav_groups_updated_at
    BEFORE UPDATE ON user_nav_groups
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Optional override: which custom group an item belongs to.
-- NULL = use the page's registry tag_enum (current behaviour).
ALTER TABLE user_nav_prefs
    ADD COLUMN group_id UUID NULL
        REFERENCES user_nav_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_user_nav_prefs_group
    ON user_nav_prefs (user_id, tenant_id, profile_id, group_id, position)
    WHERE group_id IS NOT NULL;

COMMIT;
