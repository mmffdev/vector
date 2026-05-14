-- ============================================================
-- MMFFDev - Vector: user navigation profiles (Phase 5)
-- Migration 034 — applied on top of 033_theme_unpinnable_product_strategic.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 034_user_nav_profiles.sql
--
-- Phase 5 turns the long-reserved user_nav_prefs.profile_id into
-- a real concept. Each user gets multiple named navigation
-- profiles (e.g. "Default", "Planning", "Reviews") within a
-- subscription. A profile owns its pinned items and which custom
-- groups it displays + in what order — but the custom groups
-- and custom pages themselves stay shared per-user.
--
-- Hard rule (shared pool): user_nav_groups and user_custom_pages
-- are NOT scoped to a profile. They belong to the user. Any
-- profile may display them; deleting a profile never deletes
-- a group or a page. The new junction table user_nav_profile_groups
-- expresses "this profile shows that group, in this position"
-- without the group being claimed by the profile.
--
-- Caps (max 10 profiles per user-per-subscription, label 1–32 chars)
-- are enforced both here and at the API layer; the API layer is
-- authoritative for product policy and returns user-friendly errors.
--
-- Forward-compat: user_nav_prefs.profile_id and every related
-- index already include profile_id (since migration 008). Production
-- rows are still NULL today; migration 035 enforces NOT NULL after
-- the 036 backfill seeds a Default profile per existing user.
-- ============================================================

BEGIN;

-- ---- 1. user_nav_profiles --------------------------------------

CREATE TABLE user_nav_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    position        INT  NOT NULL,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    start_page_key  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_nav_profiles_label_nonempty
        CHECK (length(btrim(label)) > 0),
    CONSTRAINT user_nav_profiles_label_max
        CHECK (length(label) <= 32),
    CONSTRAINT user_nav_profiles_position_nonneg
        CHECK (position >= 0),

    -- Position uniqueness within a (user, subscription). Deferrable so
    -- batch reorder PATCH can renumber without intermediate collisions.
    CONSTRAINT user_nav_profiles_unique_position
        UNIQUE (user_id, subscription_id, position)
        DEFERRABLE INITIALLY DEFERRED
);

-- Exactly one Default profile per (user, subscription).
CREATE UNIQUE INDEX uq_user_nav_profiles_default_per_user
    ON user_nav_profiles (user_id, subscription_id)
    WHERE is_default = TRUE;

-- Case-insensitive label uniqueness within a (user, subscription).
CREATE UNIQUE INDEX uq_user_nav_profiles_label_ci
    ON user_nav_profiles (user_id, subscription_id, LOWER(label));

-- Hot path: list a user's profiles in display order.
CREATE INDEX idx_user_nav_profiles_user
    ON user_nav_profiles (user_id, subscription_id, position);

CREATE TRIGGER trg_user_nav_profiles_updated_at
    BEFORE UPDATE ON user_nav_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ---- 2. user_nav_profile_groups (junction) ---------------------
-- Per-profile placement of shared custom groups. A row says
-- "profile P displays group G at position N". Removing the row
-- hides the group from that profile without deleting the group.
-- Primary key (profile_id, group_id) prevents the same group
-- being placed twice in the same profile.

CREATE TABLE user_nav_profile_groups (
    profile_id  UUID NOT NULL REFERENCES user_nav_profiles(id) ON DELETE CASCADE,
    group_id    UUID NOT NULL REFERENCES user_nav_groups(id)   ON DELETE CASCADE,
    position    INT  NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (profile_id, group_id),

    CONSTRAINT user_nav_profile_groups_position_nonneg
        CHECK (position >= 0),

    -- Position uniqueness within a profile. Deferrable for the same
    -- batch-reorder reason as user_nav_profiles above.
    CONSTRAINT user_nav_profile_groups_unique_position
        UNIQUE (profile_id, position)
        DEFERRABLE INITIALLY DEFERRED
);

-- Hot path: list groups placed in a profile, in display order.
CREATE INDEX idx_user_nav_profile_groups_profile
    ON user_nav_profile_groups (profile_id, position);

-- Reverse lookup: which profiles place this group? Used when a
-- group is deleted to know which profiles to refresh.
CREATE INDEX idx_user_nav_profile_groups_group
    ON user_nav_profile_groups (group_id);

COMMIT;
