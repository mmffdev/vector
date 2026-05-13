-- ============================================================
-- MMFFDev - Vector: per-profile placement of tag buckets too
-- Migration 149 — applied on top of 148_user_nav_groups_icon.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 149_nav_profile_groups_tag_enum.sql
--
-- Today user_nav_profile_groups only places custom groups. Tag buckets
-- (Personal, Admin Settings, Planning, Strategic, Bookmarks) always render
-- in canonical page_tags.default_order — so users can drag tag buckets in
-- the nav editor but the order is discarded on save.
--
-- This migration extends the junction to carry either a custom group_id
-- OR a tag_enum, with a CHECK that exactly one is set. The Default profile
-- for every existing user is back-filled with rows for each non-admin
-- page_tag in canonical default_order, slotted BEFORE existing custom-group
-- rows (which are renumbered to follow).
--
-- Position uniqueness stays scoped to (profile_id, position) — the deferred
-- constraint already handles wipe+re-insert in one txn.
-- ============================================================

BEGIN;

-- 1. Drop the composite PK first — it contains group_id which we need to
--    make nullable. Replace with a synthetic id PK + two partial unique
--    indexes so each (profile, group_id) and (profile, tag_enum) pair is
--    unique while allowing one or the other to be NULL.
ALTER TABLE user_nav_profile_groups
    DROP CONSTRAINT user_nav_profile_groups_pkey;

ALTER TABLE user_nav_profile_groups
    ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE user_nav_profile_groups
    ADD PRIMARY KEY (id);

-- 2. Make group_id nullable; add tag_enum column.
ALTER TABLE user_nav_profile_groups
    ALTER COLUMN group_id DROP NOT NULL;

ALTER TABLE user_nav_profile_groups
    ADD COLUMN tag_enum TEXT
        REFERENCES page_tags(tag_enum) ON DELETE CASCADE;

-- 3. Exactly one of (group_id, tag_enum) must be set.
ALTER TABLE user_nav_profile_groups
    ADD CONSTRAINT user_nav_profile_groups_kind_xor
        CHECK ((group_id IS NOT NULL)::int + (tag_enum IS NOT NULL)::int = 1);

CREATE UNIQUE INDEX uq_user_nav_profile_groups_group
    ON user_nav_profile_groups (profile_id, group_id)
    WHERE group_id IS NOT NULL;

CREATE UNIQUE INDEX uq_user_nav_profile_groups_tag
    ON user_nav_profile_groups (profile_id, tag_enum)
    WHERE tag_enum IS NOT NULL;

-- 4. Backfill — for every existing profile, prepend rows for every
--    non-admin tag in canonical default_order. Custom-group rows in that
--    profile are shifted by the number of tags inserted so position stays
--    contiguous 0..N-1.

-- Determine non-admin tag count once.
DO $$
DECLARE
    tag_count INT;
BEGIN
    SELECT COUNT(*) INTO tag_count
      FROM page_tags
     WHERE is_admin_menu = FALSE;

    -- Shift existing custom-group placements by tag_count to make room.
    -- Update in DESC order to avoid transient collisions on the deferred
    -- unique constraint (constraint is DEFERRABLE INITIALLY DEFERRED so
    -- this also commits cleanly at the end of the txn).
    UPDATE user_nav_profile_groups
       SET position = position + tag_count
     WHERE group_id IS NOT NULL;
END $$;

-- Insert tag placements at the front of every profile. default_order
-- has a tie between personal(0) and bookmarks(0), so use ROW_NUMBER over
-- (default_order, tag_enum) to produce contiguous 0..N-1 positions.
INSERT INTO user_nav_profile_groups (profile_id, group_id, tag_enum, position)
SELECT
    p.id        AS profile_id,
    NULL        AS group_id,
    pt.tag_enum AS tag_enum,
    (ROW_NUMBER() OVER (
        PARTITION BY p.id
        ORDER BY pt.default_order, pt.tag_enum
     ) - 1)::int AS position
  FROM user_nav_profiles p
 CROSS JOIN page_tags pt
 WHERE pt.is_admin_menu = FALSE;

COMMIT;
