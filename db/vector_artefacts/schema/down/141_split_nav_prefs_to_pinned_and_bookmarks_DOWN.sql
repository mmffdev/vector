-- ============================================================
-- 141_split_nav_prefs_to_pinned_and_bookmarks_DOWN.sql
-- Rollback for 141_split_nav_prefs_to_pinned_and_bookmarks.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
--
-- Reverses the split:
--   1. Rename users_nav_pinned → users_nav_prefs (table + columns).
--   2. Rename constraints/indexes/trigger/function back.
--   3. Add the users_nav_prefs_is_bookmark column back, default FALSE.
--   4. Copy bookmarks back from users_nav_bookmarks with is_bookmark=TRUE.
--   5. Drop users_nav_bookmarks.
--
-- All original users_nav_prefs UUIDs survive the round-trip because
-- both the move (in 141) and the restore (here) preserve the PK.
-- ============================================================

BEGIN;

-- ---------------------------------------------------------------
-- Pre-flight.
-- ---------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'users_nav_pinned'
    ) THEN
        RAISE EXCEPTION 'users_nav_pinned not found — already rolled back, or 141 was never applied';
    END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Rename users_nav_pinned → users_nav_prefs (table + columns).
-- ---------------------------------------------------------------
ALTER TABLE public.users_nav_pinned RENAME TO users_nav_prefs;

ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_id              TO users_nav_prefs_id;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_id_user         TO users_nav_prefs_id_user;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_id_subscription TO users_nav_prefs_id_subscription;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_id_profile      TO users_nav_prefs_id_profile;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_item_key        TO users_nav_prefs_item_key;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_position        TO users_nav_prefs_position;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_is_start_page   TO users_nav_prefs_is_start_page;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_created_at      TO users_nav_prefs_created_at;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_updated_at      TO users_nav_prefs_updated_at;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_parent_item_key TO users_nav_prefs_parent_item_key;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_id_group        TO users_nav_prefs_id_group;
ALTER TABLE public.users_nav_prefs RENAME COLUMN users_nav_pinned_icon_override   TO users_nav_prefs_icon_override;

-- ---------------------------------------------------------------
-- 2. Rename constraints, indexes, trigger, function back.
-- ---------------------------------------------------------------
ALTER TABLE public.users_nav_prefs
    RENAME CONSTRAINT users_nav_pinned_pkey                 TO users_nav_prefs_pkey;
ALTER TABLE public.users_nav_prefs
    RENAME CONSTRAINT uq_users_nav_pinned_unique_item       TO uq_users_nav_prefs_unique_item;
ALTER TABLE public.users_nav_prefs
    RENAME CONSTRAINT users_nav_pinned_id_user_fkey         TO users_nav_prefs_id_user_fkey;
ALTER TABLE public.users_nav_prefs
    RENAME CONSTRAINT users_nav_pinned_id_subscription_fkey TO users_nav_prefs_id_subscription_fkey;
ALTER TABLE public.users_nav_prefs
    RENAME CONSTRAINT users_nav_pinned_id_profile_fkey      TO users_nav_prefs_id_profile_fkey;
ALTER TABLE public.users_nav_prefs
    RENAME CONSTRAINT users_nav_pinned_id_group_fkey        TO users_nav_prefs_id_group_fkey;

ALTER INDEX public.idx_users_nav_pinned_group                  RENAME TO idx_users_nav_prefs_group;
ALTER INDEX public.idx_users_nav_pinned_lookup                 RENAME TO idx_users_nav_prefs_lookup;
ALTER INDEX public.idx_users_nav_pinned_parent                 RENAME TO idx_users_nav_prefs_parent;
ALTER INDEX public.uq_users_nav_pinned_one_start_page          RENAME TO uq_users_nav_prefs_one_start_page;
ALTER INDEX public.uq_users_nav_pinned_unique_position_nested  RENAME TO uq_users_nav_prefs_unique_position_nested;
ALTER INDEX public.uq_users_nav_pinned_unique_position_top     RENAME TO uq_users_nav_prefs_unique_position_top;

DROP TRIGGER trg_users_nav_pinned_touch_updated_at ON public.users_nav_prefs;
DROP FUNCTION public.fn_users_nav_pinned_touch_updated_at();

CREATE OR REPLACE FUNCTION public.fn_users_nav_prefs_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN NEW.users_nav_prefs_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_nav_prefs_touch_updated_at
    BEFORE UPDATE ON public.users_nav_prefs
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_nav_prefs_touch_updated_at();

-- ---------------------------------------------------------------
-- 3. Restore the users_nav_prefs_is_bookmark column.
-- ---------------------------------------------------------------
ALTER TABLE public.users_nav_prefs
    ADD COLUMN users_nav_prefs_is_bookmark boolean DEFAULT false NOT NULL;

-- ---------------------------------------------------------------
-- 4. Copy bookmarks back with is_bookmark=TRUE.
-- ---------------------------------------------------------------
INSERT INTO public.users_nav_prefs (
    users_nav_prefs_id,
    users_nav_prefs_id_user,
    users_nav_prefs_id_subscription,
    users_nav_prefs_id_profile,
    users_nav_prefs_item_key,
    users_nav_prefs_position,
    users_nav_prefs_is_start_page,
    users_nav_prefs_created_at,
    users_nav_prefs_updated_at,
    users_nav_prefs_parent_item_key,
    users_nav_prefs_id_group,
    users_nav_prefs_icon_override,
    users_nav_prefs_is_bookmark
)
SELECT
    users_nav_bookmarks_id,
    users_nav_bookmarks_id_user,
    users_nav_bookmarks_id_subscription,
    users_nav_bookmarks_id_profile,
    users_nav_bookmarks_item_key,
    users_nav_bookmarks_position,
    users_nav_bookmarks_is_start_page,
    users_nav_bookmarks_created_at,
    users_nav_bookmarks_updated_at,
    users_nav_bookmarks_parent_item_key,
    users_nav_bookmarks_id_group,
    users_nav_bookmarks_icon_override,
    TRUE
FROM public.users_nav_bookmarks;

-- ---------------------------------------------------------------
-- 5. Drop users_nav_bookmarks (table, trigger, function, indexes).
-- ---------------------------------------------------------------
DROP TABLE public.users_nav_bookmarks;  -- CASCADE not needed: nothing references it.
DROP FUNCTION public.fn_users_nav_bookmarks_touch_updated_at();

COMMIT;
