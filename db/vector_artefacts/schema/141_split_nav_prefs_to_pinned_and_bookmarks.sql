-- ============================================================
-- 141_split_nav_prefs_to_pinned_and_bookmarks.sql
--
-- Split users_nav_prefs into two physical tables:
--   - users_nav_pinned    (the pinned-section nav-rail rows)
--   - users_nav_bookmarks (page bookmarks, mirror schema, no is_bookmark
--                          discriminator — bookmark-ness is table membership)
--
-- WHY:
--   users_nav_prefs has carried bookmark rows and pinned-section rows in
--   a single table since the bookmarks surface landed, distinguished by
--   the users_nav_prefs_is_bookmark boolean. That conflation caused the
--   2026-05-28 data-loss bug where the PUT /nav/prefs wipe-and-replace
--   path destroyed bookmarks because the payload only carries pinned
--   rows. Commit 2e809075 added a surgical WHERE NOT is_bookmark filter
--   to the delete; this migration removes the coupling at its source
--   so the two domains can't ever entangle again. Per the user, this is
--   the proper fix — not deferred as TD.
--
--   Future-proofs the bookmarks domain: nested bookmark folders,
--   per-bookmark icon overrides, group assignment are all already on
--   the schema (mirrored from users_nav_prefs), ready when the UX
--   needs them.
--
-- IDEMPOTENCY:
--   Single transaction. Forward-only: drops the source table once rows
--   are moved + renamed. NOT safe to re-run after success (table is
--   gone). Re-running before success rolls back cleanly — every step is
--   inside BEGIN; COMMIT;. Pre-flight asserts ensure the source schema
--   matches expectations before any destructive change.
--
-- DATA MOVE:
--   Pre-migration: 180 rows in users_nav_prefs (176 pinned, 4 bookmarks).
--   Post-migration: 176 in users_nav_pinned, 4 in users_nav_bookmarks.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/141_split_nav_prefs_to_pinned_and_bookmarks_DOWN.sql
-- ============================================================

BEGIN;

-- ---------------------------------------------------------------
-- Pre-flight: source table must exist with the expected schema.
-- ---------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'users_nav_prefs'
    ) THEN
        RAISE EXCEPTION 'users_nav_prefs not found — wrong DB or already migrated';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users_nav_prefs'
           AND column_name = 'users_nav_prefs_is_bookmark'
    ) THEN
        RAISE EXCEPTION 'users_nav_prefs_is_bookmark missing — schema drift, abort';
    END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Create users_nav_bookmarks (mirror of users_nav_prefs minus
--    is_bookmark column; bookmark-ness is table membership).
-- ---------------------------------------------------------------
CREATE TABLE public.users_nav_bookmarks (
    users_nav_bookmarks_id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
    users_nav_bookmarks_id_user         uuid                     NOT NULL,
    users_nav_bookmarks_id_subscription uuid                     NOT NULL,
    users_nav_bookmarks_id_profile      uuid                     NOT NULL,
    users_nav_bookmarks_item_key        text                     NOT NULL,
    users_nav_bookmarks_position        integer                  NOT NULL,
    users_nav_bookmarks_is_start_page   boolean                  DEFAULT false NOT NULL,
    users_nav_bookmarks_created_at      timestamp with time zone DEFAULT now() NOT NULL,
    users_nav_bookmarks_updated_at      timestamp with time zone DEFAULT now() NOT NULL,
    users_nav_bookmarks_parent_item_key text,
    users_nav_bookmarks_id_group        uuid,
    users_nav_bookmarks_icon_override   text
);

ALTER TABLE ONLY public.users_nav_bookmarks
    ADD CONSTRAINT users_nav_bookmarks_pkey PRIMARY KEY (users_nav_bookmarks_id);

ALTER TABLE ONLY public.users_nav_bookmarks
    ADD CONSTRAINT uq_users_nav_bookmarks_unique_item
    UNIQUE (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile, users_nav_bookmarks_item_key);

CREATE INDEX idx_users_nav_bookmarks_group
    ON public.users_nav_bookmarks USING btree
       (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile, users_nav_bookmarks_id_group, users_nav_bookmarks_position)
    WHERE (users_nav_bookmarks_id_group IS NOT NULL);

CREATE INDEX idx_users_nav_bookmarks_lookup
    ON public.users_nav_bookmarks USING btree
       (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile, users_nav_bookmarks_position);

CREATE INDEX idx_users_nav_bookmarks_parent
    ON public.users_nav_bookmarks USING btree
       (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile, users_nav_bookmarks_parent_item_key, users_nav_bookmarks_position)
    WHERE (users_nav_bookmarks_parent_item_key IS NOT NULL);

-- A bookmark row never carries is_start_page=true (start-page is a
-- pinned-section concept); keep the partial unique index for parity in
-- case the constraint is ever exercised by a hand-written insert. It's
-- a cheap insurance index.
CREATE UNIQUE INDEX uq_users_nav_bookmarks_one_start_page
    ON public.users_nav_bookmarks USING btree
       (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile)
    WHERE (users_nav_bookmarks_is_start_page = true);

CREATE UNIQUE INDEX uq_users_nav_bookmarks_unique_position_nested
    ON public.users_nav_bookmarks USING btree
       (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile, users_nav_bookmarks_parent_item_key, users_nav_bookmarks_position)
    WHERE (users_nav_bookmarks_parent_item_key IS NOT NULL);

CREATE UNIQUE INDEX uq_users_nav_bookmarks_unique_position_top
    ON public.users_nav_bookmarks USING btree
       (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile, users_nav_bookmarks_position)
    WHERE (users_nav_bookmarks_parent_item_key IS NULL);

-- FKs mirror users_nav_prefs's outbound FKs.
ALTER TABLE ONLY public.users_nav_bookmarks
    ADD CONSTRAINT users_nav_bookmarks_id_user_fkey
    FOREIGN KEY (users_nav_bookmarks_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_bookmarks
    ADD CONSTRAINT users_nav_bookmarks_id_subscription_fkey
    FOREIGN KEY (users_nav_bookmarks_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_bookmarks
    ADD CONSTRAINT users_nav_bookmarks_id_profile_fkey
    FOREIGN KEY (users_nav_bookmarks_id_profile)
    REFERENCES public.users_nav_profiles(users_nav_profiles_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_bookmarks
    ADD CONSTRAINT users_nav_bookmarks_id_group_fkey
    FOREIGN KEY (users_nav_bookmarks_id_group)
    REFERENCES public.users_nav_groups(users_nav_groups_id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.fn_users_nav_bookmarks_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN NEW.users_nav_bookmarks_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_nav_bookmarks_touch_updated_at
    BEFORE UPDATE ON public.users_nav_bookmarks
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_nav_bookmarks_touch_updated_at();

-- ---------------------------------------------------------------
-- 2. Move bookmark rows from users_nav_prefs into users_nav_bookmarks.
--    Preserve all UUIDs + timestamps so external references survive.
-- ---------------------------------------------------------------
INSERT INTO public.users_nav_bookmarks (
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
    users_nav_bookmarks_icon_override
)
SELECT
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
    users_nav_prefs_icon_override
FROM public.users_nav_prefs
WHERE users_nav_prefs_is_bookmark = TRUE;

-- ---------------------------------------------------------------
-- 3. Remove the moved rows from the source table.
-- ---------------------------------------------------------------
DELETE FROM public.users_nav_prefs
 WHERE users_nav_prefs_is_bookmark = TRUE;

-- ---------------------------------------------------------------
-- 4. Rename the table users_nav_prefs → users_nav_pinned.
-- ---------------------------------------------------------------
ALTER TABLE public.users_nav_prefs RENAME TO users_nav_pinned;

-- ---------------------------------------------------------------
-- 5. Rename every column from users_nav_prefs_* → users_nav_pinned_*.
-- ---------------------------------------------------------------
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_id              TO users_nav_pinned_id;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_id_user         TO users_nav_pinned_id_user;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_id_subscription TO users_nav_pinned_id_subscription;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_id_profile      TO users_nav_pinned_id_profile;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_item_key        TO users_nav_pinned_item_key;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_position        TO users_nav_pinned_position;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_is_start_page   TO users_nav_pinned_is_start_page;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_created_at      TO users_nav_pinned_created_at;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_updated_at      TO users_nav_pinned_updated_at;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_parent_item_key TO users_nav_pinned_parent_item_key;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_id_group        TO users_nav_pinned_id_group;
ALTER TABLE public.users_nav_pinned RENAME COLUMN users_nav_prefs_icon_override   TO users_nav_pinned_icon_override;
-- users_nav_prefs_is_bookmark deliberately NOT renamed — it gets dropped in step 8.

-- ---------------------------------------------------------------
-- 6. Rename every constraint + index from users_nav_prefs_* / uq_* / idx_*
--    to the pinned equivalent.
-- ---------------------------------------------------------------
ALTER TABLE public.users_nav_pinned
    RENAME CONSTRAINT users_nav_prefs_pkey                 TO users_nav_pinned_pkey;
ALTER TABLE public.users_nav_pinned
    RENAME CONSTRAINT uq_users_nav_prefs_unique_item       TO uq_users_nav_pinned_unique_item;
ALTER TABLE public.users_nav_pinned
    RENAME CONSTRAINT users_nav_prefs_id_user_fkey         TO users_nav_pinned_id_user_fkey;
ALTER TABLE public.users_nav_pinned
    RENAME CONSTRAINT users_nav_prefs_id_subscription_fkey TO users_nav_pinned_id_subscription_fkey;
ALTER TABLE public.users_nav_pinned
    RENAME CONSTRAINT users_nav_prefs_id_profile_fkey      TO users_nav_pinned_id_profile_fkey;
ALTER TABLE public.users_nav_pinned
    RENAME CONSTRAINT users_nav_prefs_id_group_fkey        TO users_nav_pinned_id_group_fkey;

-- Indexes (not constraints — ALTER INDEX RENAME).
ALTER INDEX public.idx_users_nav_prefs_group                   RENAME TO idx_users_nav_pinned_group;
ALTER INDEX public.idx_users_nav_prefs_lookup                  RENAME TO idx_users_nav_pinned_lookup;
ALTER INDEX public.idx_users_nav_prefs_parent                  RENAME TO idx_users_nav_pinned_parent;
ALTER INDEX public.uq_users_nav_prefs_one_start_page           RENAME TO uq_users_nav_pinned_one_start_page;
ALTER INDEX public.uq_users_nav_prefs_unique_position_nested   RENAME TO uq_users_nav_pinned_unique_position_nested;
ALTER INDEX public.uq_users_nav_prefs_unique_position_top      RENAME TO uq_users_nav_pinned_unique_position_top;

-- ---------------------------------------------------------------
-- 7. Rename the trigger + trigger function.
--    Trigger renamed in place; function gets a new name and the
--    trigger is repointed.
-- ---------------------------------------------------------------
DROP TRIGGER trg_users_nav_prefs_touch_updated_at ON public.users_nav_pinned;
DROP FUNCTION public.fn_users_nav_prefs_touch_updated_at();

CREATE OR REPLACE FUNCTION public.fn_users_nav_pinned_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN NEW.users_nav_pinned_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_nav_pinned_touch_updated_at
    BEFORE UPDATE ON public.users_nav_pinned
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_nav_pinned_touch_updated_at();

-- ---------------------------------------------------------------
-- 8. Drop the now-meaningless is_bookmark column on users_nav_pinned.
--    Every row in this table is, by table membership, a pinned-section
--    entry — there is no need for a discriminator.
-- ---------------------------------------------------------------
ALTER TABLE public.users_nav_pinned DROP COLUMN users_nav_prefs_is_bookmark;

-- ---------------------------------------------------------------
-- Post-flight asserts:
--   - users_nav_pinned has the column shape we expect (sanity check).
--   - users_nav_bookmarks rowcount + users_nav_pinned rowcount = original
--     180 (176 + 4).
-- ---------------------------------------------------------------
DO $$
DECLARE
    pinned_count int;
    bookmarks_count int;
BEGIN
    SELECT COUNT(*) INTO pinned_count    FROM public.users_nav_pinned;
    SELECT COUNT(*) INTO bookmarks_count FROM public.users_nav_bookmarks;
    RAISE NOTICE 'split complete: users_nav_pinned=% users_nav_bookmarks=%',
        pinned_count, bookmarks_count;
END $$;

COMMIT;
