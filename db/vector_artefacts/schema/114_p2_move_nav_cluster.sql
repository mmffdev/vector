-- ============================================================
-- 114_p2_move_nav_cluster.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 6 of N. Navigation surface tables.
--
-- Tables in scope (in safe-order — FK targets first):
--   1. users_nav_groups        (0 rows; user-defined nav groups)
--   2. users_nav_profiles      (7 rows; FK users + subscriptions)
--   3. users_nav_profile_groups (48 rows; FK profiles + groups + pages_tags)
--   4. users_nav_prefs         (88 rows; FK users + subscriptions
--                                     + profiles + groups)
--   5. users_custom_pages      (2 rows; FK users + subscriptions)
--   6. users_custom_page_views (2 rows; FK custom_pages; uses
--                                       enum custom_view_kind from 109)
--   7. users_tab_order         (34 rows; FK users + subscriptions)
--
-- Each table installs its own set_updated_at trigger + function.
-- FK constraints are deferred to 118_p2_add_all_fks.sql.
-- ============================================================

BEGIN;

-- ======================================================================
-- TABLE 1: users_nav_groups
-- ======================================================================

CREATE TABLE public.users_nav_groups (
    users_nav_groups_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_nav_groups_id_user uuid NOT NULL,
    users_nav_groups_label text NOT NULL,
    users_nav_groups_position integer NOT NULL,
    users_nav_groups_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_nav_groups_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    users_nav_groups_icon text,
    CONSTRAINT users_nav_groups_icon_max CHECK (((users_nav_groups_icon IS NULL) OR (length(users_nav_groups_icon) <= 64))),
    CONSTRAINT users_nav_groups_label_max CHECK ((length(users_nav_groups_label) <= 64)),
    CONSTRAINT users_nav_groups_label_nonempty CHECK ((length(TRIM(BOTH FROM users_nav_groups_label)) > 0))
);

ALTER TABLE ONLY public.users_nav_groups
    ADD CONSTRAINT users_nav_groups_pkey PRIMARY KEY (users_nav_groups_id);

ALTER TABLE ONLY public.users_nav_groups
    ADD CONSTRAINT uq_users_nav_groups_unique_position
    UNIQUE (users_nav_groups_id_user, users_nav_groups_position) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_users_nav_groups_user
    ON public.users_nav_groups USING btree (users_nav_groups_id_user, users_nav_groups_position);

CREATE UNIQUE INDEX uq_users_nav_groups_user_label_ci
    ON public.users_nav_groups USING btree (users_nav_groups_id_user, lower(users_nav_groups_label));

CREATE OR REPLACE FUNCTION public.fn_users_nav_groups_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.users_nav_groups_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_nav_groups_touch_updated_at
    BEFORE UPDATE ON public.users_nav_groups
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_nav_groups_touch_updated_at();

INSERT INTO public.users_nav_groups (
    users_nav_groups_id, users_nav_groups_id_user, users_nav_groups_label,
    users_nav_groups_position, users_nav_groups_created_at,
    users_nav_groups_updated_at, users_nav_groups_icon
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_nav_groups_id, users_nav_groups_id_user, users_nav_groups_label, users_nav_groups_position, users_nav_groups_created_at, users_nav_groups_updated_at, users_nav_groups_icon FROM public.users_nav_groups')
AS t(
    users_nav_groups_id uuid, users_nav_groups_id_user uuid,
    users_nav_groups_label text, users_nav_groups_position integer,
    users_nav_groups_created_at timestamp with time zone,
    users_nav_groups_updated_at timestamp with time zone,
    users_nav_groups_icon text
);

SELECT _p2_assert_rowcount('users_nav_groups', _p2_source_rowcount('users_nav_groups'));


-- ======================================================================
-- TABLE 2: users_nav_profiles
-- ======================================================================

CREATE TABLE public.users_nav_profiles (
    users_nav_profiles_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_nav_profiles_id_user uuid NOT NULL,
    users_nav_profiles_id_subscription uuid NOT NULL,
    users_nav_profiles_label text NOT NULL,
    users_nav_profiles_position integer NOT NULL,
    users_nav_profiles_is_default boolean DEFAULT false NOT NULL,
    users_nav_profiles_start_page_key text,
    users_nav_profiles_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_nav_profiles_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_nav_profiles_label_max CHECK ((length(users_nav_profiles_label) <= 32)),
    CONSTRAINT users_nav_profiles_label_nonempty CHECK ((length(btrim(users_nav_profiles_label)) > 0)),
    CONSTRAINT users_nav_profiles_position_nonneg CHECK ((users_nav_profiles_position >= 0))
);

ALTER TABLE ONLY public.users_nav_profiles
    ADD CONSTRAINT users_nav_profiles_pkey PRIMARY KEY (users_nav_profiles_id);

ALTER TABLE ONLY public.users_nav_profiles
    ADD CONSTRAINT uq_users_nav_profiles_unique_position
    UNIQUE (users_nav_profiles_id_user, users_nav_profiles_id_subscription, users_nav_profiles_position)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_users_nav_profiles_user
    ON public.users_nav_profiles USING btree (users_nav_profiles_id_user, users_nav_profiles_id_subscription, users_nav_profiles_position);

CREATE UNIQUE INDEX uq_users_nav_profiles_default_per_user
    ON public.users_nav_profiles USING btree (users_nav_profiles_id_user, users_nav_profiles_id_subscription)
    WHERE (users_nav_profiles_is_default = true);

CREATE UNIQUE INDEX uq_users_nav_profiles_label_ci
    ON public.users_nav_profiles USING btree (users_nav_profiles_id_user, users_nav_profiles_id_subscription, lower(users_nav_profiles_label));

CREATE OR REPLACE FUNCTION public.fn_users_nav_profiles_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.users_nav_profiles_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_nav_profiles_touch_updated_at
    BEFORE UPDATE ON public.users_nav_profiles
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_nav_profiles_touch_updated_at();

INSERT INTO public.users_nav_profiles (
    users_nav_profiles_id, users_nav_profiles_id_user, users_nav_profiles_id_subscription,
    users_nav_profiles_label, users_nav_profiles_position, users_nav_profiles_is_default,
    users_nav_profiles_start_page_key, users_nav_profiles_created_at, users_nav_profiles_updated_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_nav_profiles_id, users_nav_profiles_id_user, users_nav_profiles_id_subscription, users_nav_profiles_label, users_nav_profiles_position, users_nav_profiles_is_default, users_nav_profiles_start_page_key, users_nav_profiles_created_at, users_nav_profiles_updated_at FROM public.users_nav_profiles')
AS t(
    users_nav_profiles_id uuid, users_nav_profiles_id_user uuid,
    users_nav_profiles_id_subscription uuid, users_nav_profiles_label text,
    users_nav_profiles_position integer, users_nav_profiles_is_default boolean,
    users_nav_profiles_start_page_key text,
    users_nav_profiles_created_at timestamp with time zone,
    users_nav_profiles_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_nav_profiles', _p2_source_rowcount('users_nav_profiles'));


-- ======================================================================
-- TABLE 3: users_nav_profile_groups
-- ======================================================================

CREATE TABLE public.users_nav_profile_groups (
    users_nav_profile_groups_id_profile uuid NOT NULL,
    users_nav_profile_groups_id_group uuid,
    users_nav_profile_groups_position integer NOT NULL,
    users_nav_profile_groups_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_nav_profile_groups_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_nav_profile_groups_tag_enum text,
    users_nav_profile_groups_icon_override text,
    CONSTRAINT users_nav_profile_groups_kind_xor CHECK (((((users_nav_profile_groups_id_group IS NOT NULL))::integer + ((users_nav_profile_groups_tag_enum IS NOT NULL))::integer) = 1)),
    CONSTRAINT users_nav_profile_groups_position_nonneg CHECK ((users_nav_profile_groups_position >= 0))
);

ALTER TABLE ONLY public.users_nav_profile_groups
    ADD CONSTRAINT users_nav_profile_groups_pkey PRIMARY KEY (users_nav_profile_groups_id);

ALTER TABLE ONLY public.users_nav_profile_groups
    ADD CONSTRAINT uq_users_nav_profile_groups_unique_position
    UNIQUE (users_nav_profile_groups_id_profile, users_nav_profile_groups_position)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_users_nav_profile_groups_id_group
    ON public.users_nav_profile_groups USING btree (users_nav_profile_groups_id_group);

CREATE INDEX idx_users_nav_profile_groups_id_profile
    ON public.users_nav_profile_groups USING btree (users_nav_profile_groups_id_profile, users_nav_profile_groups_position);

CREATE UNIQUE INDEX uq_users_nav_profile_groups_group
    ON public.users_nav_profile_groups USING btree (users_nav_profile_groups_id_profile, users_nav_profile_groups_id_group)
    WHERE (users_nav_profile_groups_id_group IS NOT NULL);

CREATE UNIQUE INDEX uq_users_nav_profile_groups_tag
    ON public.users_nav_profile_groups USING btree (users_nav_profile_groups_id_profile, users_nav_profile_groups_tag_enum)
    WHERE (users_nav_profile_groups_tag_enum IS NOT NULL);

INSERT INTO public.users_nav_profile_groups (
    users_nav_profile_groups_id_profile, users_nav_profile_groups_id_group,
    users_nav_profile_groups_position, users_nav_profile_groups_created_at,
    users_nav_profile_groups_id, users_nav_profile_groups_tag_enum,
    users_nav_profile_groups_icon_override
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_nav_profile_groups_id_profile, users_nav_profile_groups_id_group, users_nav_profile_groups_position, users_nav_profile_groups_created_at, users_nav_profile_groups_id, users_nav_profile_groups_tag_enum, users_nav_profile_groups_icon_override FROM public.users_nav_profile_groups')
AS t(
    users_nav_profile_groups_id_profile uuid,
    users_nav_profile_groups_id_group uuid,
    users_nav_profile_groups_position integer,
    users_nav_profile_groups_created_at timestamp with time zone,
    users_nav_profile_groups_id uuid,
    users_nav_profile_groups_tag_enum text,
    users_nav_profile_groups_icon_override text
);

SELECT _p2_assert_rowcount('users_nav_profile_groups', _p2_source_rowcount('users_nav_profile_groups'));


-- ======================================================================
-- TABLE 4: users_nav_prefs
-- ======================================================================

CREATE TABLE public.users_nav_prefs (
    users_nav_prefs_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_nav_prefs_id_user uuid NOT NULL,
    users_nav_prefs_id_subscription uuid NOT NULL,
    users_nav_prefs_id_profile uuid NOT NULL,
    users_nav_prefs_item_key text NOT NULL,
    users_nav_prefs_position integer NOT NULL,
    users_nav_prefs_is_start_page boolean DEFAULT false NOT NULL,
    users_nav_prefs_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_nav_prefs_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    users_nav_prefs_parent_item_key text,
    users_nav_prefs_id_group uuid,
    users_nav_prefs_icon_override text,
    users_nav_prefs_is_bookmark boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.users_nav_prefs
    ADD CONSTRAINT users_nav_prefs_pkey PRIMARY KEY (users_nav_prefs_id);

ALTER TABLE ONLY public.users_nav_prefs
    ADD CONSTRAINT uq_users_nav_prefs_unique_item
    UNIQUE (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_item_key);

CREATE INDEX idx_users_nav_prefs_group
    ON public.users_nav_prefs USING btree (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_id_group, users_nav_prefs_position)
    WHERE (users_nav_prefs_id_group IS NOT NULL);

CREATE INDEX idx_users_nav_prefs_lookup
    ON public.users_nav_prefs USING btree (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_position);

CREATE INDEX idx_users_nav_prefs_parent
    ON public.users_nav_prefs USING btree (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_parent_item_key, users_nav_prefs_position)
    WHERE (users_nav_prefs_parent_item_key IS NOT NULL);

CREATE UNIQUE INDEX uq_users_nav_prefs_one_start_page
    ON public.users_nav_prefs USING btree (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile)
    WHERE (users_nav_prefs_is_start_page = true);

CREATE UNIQUE INDEX uq_users_nav_prefs_unique_position_nested
    ON public.users_nav_prefs USING btree (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_parent_item_key, users_nav_prefs_position)
    WHERE (users_nav_prefs_parent_item_key IS NOT NULL);

CREATE UNIQUE INDEX uq_users_nav_prefs_unique_position_top
    ON public.users_nav_prefs USING btree (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_position)
    WHERE (users_nav_prefs_parent_item_key IS NULL);

CREATE OR REPLACE FUNCTION public.fn_users_nav_prefs_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.users_nav_prefs_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_nav_prefs_touch_updated_at
    BEFORE UPDATE ON public.users_nav_prefs
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_nav_prefs_touch_updated_at();

INSERT INTO public.users_nav_prefs (
    users_nav_prefs_id, users_nav_prefs_id_user, users_nav_prefs_id_subscription,
    users_nav_prefs_id_profile, users_nav_prefs_item_key, users_nav_prefs_position,
    users_nav_prefs_is_start_page, users_nav_prefs_created_at, users_nav_prefs_updated_at,
    users_nav_prefs_parent_item_key, users_nav_prefs_id_group,
    users_nav_prefs_icon_override, users_nav_prefs_is_bookmark
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_nav_prefs_id, users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_item_key, users_nav_prefs_position, users_nav_prefs_is_start_page, users_nav_prefs_created_at, users_nav_prefs_updated_at, users_nav_prefs_parent_item_key, users_nav_prefs_id_group, users_nav_prefs_icon_override, users_nav_prefs_is_bookmark FROM public.users_nav_prefs')
AS t(
    users_nav_prefs_id uuid, users_nav_prefs_id_user uuid,
    users_nav_prefs_id_subscription uuid, users_nav_prefs_id_profile uuid,
    users_nav_prefs_item_key text, users_nav_prefs_position integer,
    users_nav_prefs_is_start_page boolean,
    users_nav_prefs_created_at timestamp with time zone,
    users_nav_prefs_updated_at timestamp with time zone,
    users_nav_prefs_parent_item_key text, users_nav_prefs_id_group uuid,
    users_nav_prefs_icon_override text, users_nav_prefs_is_bookmark boolean
);

SELECT _p2_assert_rowcount('users_nav_prefs', _p2_source_rowcount('users_nav_prefs'));


-- ======================================================================
-- TABLE 5: users_custom_pages
-- ======================================================================

CREATE TABLE public.users_custom_pages (
    users_custom_pages_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_custom_pages_id_user uuid NOT NULL,
    users_custom_pages_id_subscription uuid NOT NULL,
    users_custom_pages_label text NOT NULL,
    users_custom_pages_icon text DEFAULT 'folder'::text NOT NULL,
    users_custom_pages_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_custom_pages_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_custom_pages_label_chk CHECK ((length(btrim(users_custom_pages_label)) > 0))
);

ALTER TABLE ONLY public.users_custom_pages
    ADD CONSTRAINT users_custom_pages_pkey PRIMARY KEY (users_custom_pages_id);

ALTER TABLE ONLY public.users_custom_pages
    ADD CONSTRAINT users_custom_pages_id_user_id_subscription_label_unique
    UNIQUE (users_custom_pages_id_user, users_custom_pages_id_subscription, users_custom_pages_label);

CREATE INDEX idx_users_custom_pages_id_user_id_subscription
    ON public.users_custom_pages USING btree (users_custom_pages_id_user, users_custom_pages_id_subscription);

CREATE OR REPLACE FUNCTION public.users_custom_pages_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_custom_pages_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_custom_pages_updated_at
    BEFORE UPDATE ON public.users_custom_pages
    FOR EACH ROW EXECUTE FUNCTION public.users_custom_pages_set_updated_at();

INSERT INTO public.users_custom_pages (
    users_custom_pages_id, users_custom_pages_id_user, users_custom_pages_id_subscription,
    users_custom_pages_label, users_custom_pages_icon, users_custom_pages_created_at,
    users_custom_pages_updated_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_custom_pages_id, users_custom_pages_id_user, users_custom_pages_id_subscription, users_custom_pages_label, users_custom_pages_icon, users_custom_pages_created_at, users_custom_pages_updated_at FROM public.users_custom_pages')
AS t(
    users_custom_pages_id uuid, users_custom_pages_id_user uuid,
    users_custom_pages_id_subscription uuid, users_custom_pages_label text,
    users_custom_pages_icon text,
    users_custom_pages_created_at timestamp with time zone,
    users_custom_pages_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_custom_pages', _p2_source_rowcount('users_custom_pages'));


-- ======================================================================
-- TABLE 6: users_custom_page_views (uses enum custom_view_kind from 109)
-- ======================================================================

CREATE TABLE public.users_custom_page_views (
    users_custom_page_views_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_custom_page_views_id_page uuid NOT NULL,
    users_custom_page_views_label text NOT NULL,
    users_custom_page_views_kind public.custom_view_kind NOT NULL,
    users_custom_page_views_position integer NOT NULL,
    users_custom_page_views_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    users_custom_page_views_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_custom_page_views_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_custom_page_views_label_chk CHECK ((length(btrim(users_custom_page_views_label)) > 0))
);

ALTER TABLE ONLY public.users_custom_page_views
    ADD CONSTRAINT users_custom_page_views_pkey PRIMARY KEY (users_custom_page_views_id);

ALTER TABLE ONLY public.users_custom_page_views
    ADD CONSTRAINT users_custom_page_views_id_page_label_unique
    UNIQUE (users_custom_page_views_id_page, users_custom_page_views_label);

ALTER TABLE ONLY public.users_custom_page_views
    ADD CONSTRAINT users_custom_page_views_id_page_position_unique
    UNIQUE (users_custom_page_views_id_page, users_custom_page_views_position)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_users_custom_page_views_id_page_position
    ON public.users_custom_page_views USING btree (users_custom_page_views_id_page, users_custom_page_views_position);

CREATE OR REPLACE FUNCTION public.users_custom_page_views_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_custom_page_views_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_custom_page_views_updated_at
    BEFORE UPDATE ON public.users_custom_page_views
    FOR EACH ROW EXECUTE FUNCTION public.users_custom_page_views_set_updated_at();

INSERT INTO public.users_custom_page_views (
    users_custom_page_views_id, users_custom_page_views_id_page,
    users_custom_page_views_label, users_custom_page_views_kind,
    users_custom_page_views_position, users_custom_page_views_config,
    users_custom_page_views_created_at, users_custom_page_views_updated_at
)
SELECT
    users_custom_page_views_id, users_custom_page_views_id_page,
    users_custom_page_views_label,
    users_custom_page_views_kind::public.custom_view_kind,
    users_custom_page_views_position, users_custom_page_views_config,
    users_custom_page_views_created_at, users_custom_page_views_updated_at
FROM dblink(_p2_source_conn(),
    'SELECT users_custom_page_views_id, users_custom_page_views_id_page, users_custom_page_views_label, users_custom_page_views_kind::text, users_custom_page_views_position, users_custom_page_views_config, users_custom_page_views_created_at, users_custom_page_views_updated_at FROM public.users_custom_page_views')
AS t(
    users_custom_page_views_id uuid, users_custom_page_views_id_page uuid,
    users_custom_page_views_label text, users_custom_page_views_kind text,
    users_custom_page_views_position integer, users_custom_page_views_config jsonb,
    users_custom_page_views_created_at timestamp with time zone,
    users_custom_page_views_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_custom_page_views', _p2_source_rowcount('users_custom_page_views'));


-- ======================================================================
-- TABLE 7: users_tab_order
-- ======================================================================

CREATE TABLE public.users_tab_order (
    users_tab_order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_tab_order_id_user uuid NOT NULL,
    users_tab_order_id_subscription uuid NOT NULL,
    users_tab_order_page_id text NOT NULL,
    users_tab_order_tab_key text NOT NULL,
    users_tab_order_position integer NOT NULL,
    users_tab_order_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_tab_order_updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.users_tab_order
    ADD CONSTRAINT users_tab_order_pkey PRIMARY KEY (users_tab_order_id);

ALTER TABLE ONLY public.users_tab_order
    ADD CONSTRAINT users_tab_order_id_user_id_subscription_page_id_position_unique
    UNIQUE (users_tab_order_id_user, users_tab_order_id_subscription, users_tab_order_page_id, users_tab_order_position)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.users_tab_order
    ADD CONSTRAINT users_tab_order_id_user_id_subscription_page_id_tab_key_unique
    UNIQUE (users_tab_order_id_user, users_tab_order_id_subscription, users_tab_order_page_id, users_tab_order_tab_key);

CREATE INDEX idx_users_tab_order_id_user_id_subscription_page_id_position
    ON public.users_tab_order USING btree (users_tab_order_id_user, users_tab_order_id_subscription, users_tab_order_page_id, users_tab_order_position);

CREATE OR REPLACE FUNCTION public.users_tab_order_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_tab_order_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_tab_order_updated_at
    BEFORE UPDATE ON public.users_tab_order
    FOR EACH ROW EXECUTE FUNCTION public.users_tab_order_set_updated_at();

INSERT INTO public.users_tab_order (
    users_tab_order_id, users_tab_order_id_user, users_tab_order_id_subscription,
    users_tab_order_page_id, users_tab_order_tab_key, users_tab_order_position,
    users_tab_order_created_at, users_tab_order_updated_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_tab_order_id, users_tab_order_id_user, users_tab_order_id_subscription, users_tab_order_page_id, users_tab_order_tab_key, users_tab_order_position, users_tab_order_created_at, users_tab_order_updated_at FROM public.users_tab_order')
AS t(
    users_tab_order_id uuid, users_tab_order_id_user uuid,
    users_tab_order_id_subscription uuid, users_tab_order_page_id text,
    users_tab_order_tab_key text, users_tab_order_position integer,
    users_tab_order_created_at timestamp with time zone,
    users_tab_order_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_tab_order', _p2_source_rowcount('users_tab_order'));

COMMIT;
