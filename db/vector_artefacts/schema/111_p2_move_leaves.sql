-- ============================================================
-- 111_p2_move_leaves.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 3 of N.
--
-- Moves the five leaf tables that have NO outbound FKs (they are
-- catalogue / lookup / global-singleton tables):
--
--   1. library_help_defaults  (4 rows; has updated_at trigger)
--   2. pages_tags             (10 rows; static catalogue)
--   3. users_permissions      (37 rows; static catalogue)
--   4. vector_icons           (4 rows; static catalogue)
--   5. pages_access_version   (1 row; global access-version counter,
--                              CHECK (id=1) enforces singleton)
--
-- These are pure leaves (no outbound FKs); they can move in any
-- order. The pages_access_version_bump() function is recreated here
-- — it's the trigger function referenced by triggers on users_roles
-- and users_roles_pages (installed later when those tables land in
-- 116). The bump function itself only touches pages_access_version,
-- so it's safe to install once the counter table exists.
--
-- No FK constraints in this migration; none exist on these tables.
-- ============================================================

BEGIN;

-- ======================================================================
-- TABLE 1: library_help_defaults
-- ======================================================================

CREATE TABLE public.library_help_defaults (
    library_help_defaults_id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_help_defaults_kind text NOT NULL,
    library_help_defaults_name_pattern text NOT NULL,
    library_help_defaults_locale text DEFAULT 'en'::text NOT NULL,
    library_help_defaults_body_html text DEFAULT ''::text NOT NULL,
    library_help_defaults_created_at timestamp with time zone DEFAULT now() NOT NULL,
    library_help_defaults_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    library_help_defaults_title text,
    library_help_defaults_video_embeds jsonb DEFAULT '[]'::jsonb NOT NULL,
    library_help_defaults_image_urls jsonb DEFAULT '[]'::jsonb NOT NULL
);

ALTER TABLE ONLY public.library_help_defaults
    ADD CONSTRAINT library_help_defaults_pkey PRIMARY KEY (library_help_defaults_id);

CREATE UNIQUE INDEX library_help_defaults_lookup
    ON public.library_help_defaults USING btree
    (library_help_defaults_kind, library_help_defaults_name_pattern, library_help_defaults_locale);

CREATE OR REPLACE FUNCTION public.library_help_defaults_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.library_help_defaults_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER library_help_defaults_updated_at
    BEFORE UPDATE ON public.library_help_defaults
    FOR EACH ROW EXECUTE FUNCTION public.library_help_defaults_set_updated_at();

INSERT INTO public.library_help_defaults (
    library_help_defaults_id, library_help_defaults_kind,
    library_help_defaults_name_pattern, library_help_defaults_locale,
    library_help_defaults_body_html, library_help_defaults_created_at,
    library_help_defaults_updated_at, library_help_defaults_title,
    library_help_defaults_video_embeds, library_help_defaults_image_urls
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT library_help_defaults_id, library_help_defaults_kind, library_help_defaults_name_pattern, library_help_defaults_locale, library_help_defaults_body_html, library_help_defaults_created_at, library_help_defaults_updated_at, library_help_defaults_title, library_help_defaults_video_embeds, library_help_defaults_image_urls FROM public.library_help_defaults')
AS t(
    library_help_defaults_id uuid, library_help_defaults_kind text,
    library_help_defaults_name_pattern text, library_help_defaults_locale text,
    library_help_defaults_body_html text,
    library_help_defaults_created_at timestamp with time zone,
    library_help_defaults_updated_at timestamp with time zone,
    library_help_defaults_title text,
    library_help_defaults_video_embeds jsonb,
    library_help_defaults_image_urls jsonb
);

SELECT _p2_assert_rowcount('library_help_defaults', _p2_source_rowcount('library_help_defaults'));


-- ======================================================================
-- TABLE 2: pages_tags
-- ======================================================================

CREATE TABLE public.pages_tags (
    pages_tags_tag_enum text NOT NULL,
    pages_tags_display_name text NOT NULL,
    pages_tags_default_order integer NOT NULL,
    pages_tags_is_admin_menu boolean DEFAULT false NOT NULL,
    pages_tags_created_at timestamp with time zone DEFAULT now() NOT NULL,
    pages_tags_env_only text,
    pages_tags_min_auth_level smallint
);

ALTER TABLE ONLY public.pages_tags
    ADD CONSTRAINT page_tags_pkey PRIMARY KEY (pages_tags_tag_enum);

INSERT INTO public.pages_tags (
    pages_tags_tag_enum, pages_tags_display_name, pages_tags_default_order,
    pages_tags_is_admin_menu, pages_tags_created_at, pages_tags_env_only,
    pages_tags_min_auth_level
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT pages_tags_tag_enum, pages_tags_display_name, pages_tags_default_order, pages_tags_is_admin_menu, pages_tags_created_at, pages_tags_env_only, pages_tags_min_auth_level FROM public.pages_tags')
AS t(
    pages_tags_tag_enum text, pages_tags_display_name text,
    pages_tags_default_order integer, pages_tags_is_admin_menu boolean,
    pages_tags_created_at timestamp with time zone, pages_tags_env_only text,
    pages_tags_min_auth_level smallint
);

SELECT _p2_assert_rowcount('pages_tags', _p2_source_rowcount('pages_tags'));


-- ======================================================================
-- TABLE 3: users_permissions
-- ======================================================================

CREATE TABLE public.users_permissions (
    users_permissions_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_permissions_code text NOT NULL,
    users_permissions_label text NOT NULL,
    users_permissions_category text DEFAULT 'general'::text NOT NULL,
    users_permissions_description text DEFAULT ''::text NOT NULL,
    users_permissions_created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.users_permissions
    ADD CONSTRAINT users_permissions_pkey PRIMARY KEY (users_permissions_id);

ALTER TABLE ONLY public.users_permissions
    ADD CONSTRAINT users_permissions_code_key UNIQUE (users_permissions_code);

CREATE INDEX idx_users_permissions_category
    ON public.users_permissions USING btree (users_permissions_category);

INSERT INTO public.users_permissions (
    users_permissions_id, users_permissions_code, users_permissions_label,
    users_permissions_category, users_permissions_description,
    users_permissions_created_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_permissions_id, users_permissions_code, users_permissions_label, users_permissions_category, users_permissions_description, users_permissions_created_at FROM public.users_permissions')
AS t(
    users_permissions_id uuid, users_permissions_code text,
    users_permissions_label text, users_permissions_category text,
    users_permissions_description text,
    users_permissions_created_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_permissions', _p2_source_rowcount('users_permissions'));


-- ======================================================================
-- TABLE 4: vector_icons
-- ======================================================================

CREATE TABLE public.vector_icons (
    vector_icons_id uuid DEFAULT gen_random_uuid() NOT NULL,
    vector_icons_pack text NOT NULL,
    vector_icons_name text NOT NULL,
    vector_icons_label text NOT NULL,
    vector_icons_is_default boolean DEFAULT false NOT NULL,
    vector_icons_default_for text,
    vector_icons_created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vector_icons_default_for_valid_chk CHECK (((vector_icons_default_for IS NULL) OR (vector_icons_default_for = ANY (ARRAY['epic'::text, 'story'::text, 'task'::text, 'defect'::text])))),
    CONSTRAINT vector_icons_label_nonempty_chk CHECK ((length(btrim(vector_icons_label)) > 0)),
    CONSTRAINT vector_icons_name_nonempty_chk CHECK ((length(btrim(vector_icons_name)) > 0)),
    CONSTRAINT vector_icons_pack_valid_chk CHECK ((vector_icons_pack = ANY (ARRAY['fa6'::text, 'md'::text, 'bs'::text, 'tb'::text, 'ri'::text])))
);

ALTER TABLE ONLY public.vector_icons
    ADD CONSTRAINT vector_icons_pkey PRIMARY KEY (vector_icons_id);

ALTER TABLE ONLY public.vector_icons
    ADD CONSTRAINT vector_icons_pack_name_unique UNIQUE (vector_icons_pack, vector_icons_name);

CREATE UNIQUE INDEX idx_vector_icons_default_for_where_is_default_true
    ON public.vector_icons USING btree (vector_icons_default_for)
    WHERE ((vector_icons_is_default = true) AND (vector_icons_default_for IS NOT NULL));

CREATE INDEX idx_vector_icons_pack ON public.vector_icons USING btree (vector_icons_pack);

INSERT INTO public.vector_icons (
    vector_icons_id, vector_icons_pack, vector_icons_name, vector_icons_label,
    vector_icons_is_default, vector_icons_default_for, vector_icons_created_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT vector_icons_id, vector_icons_pack, vector_icons_name, vector_icons_label, vector_icons_is_default, vector_icons_default_for, vector_icons_created_at FROM public.vector_icons')
AS t(
    vector_icons_id uuid, vector_icons_pack text, vector_icons_name text,
    vector_icons_label text, vector_icons_is_default boolean,
    vector_icons_default_for text, vector_icons_created_at timestamp with time zone
);

SELECT _p2_assert_rowcount('vector_icons', _p2_source_rowcount('vector_icons'));


-- ======================================================================
-- TABLE 5: pages_access_version (singleton counter)
-- ======================================================================

CREATE TABLE public.pages_access_version (
    pages_access_version_id integer NOT NULL,
    pages_access_version_value bigint DEFAULT 1 NOT NULL,
    pages_access_version_bumped_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pages_access_version_pages_access_version_id_check CHECK ((pages_access_version_id = 1))
);

ALTER TABLE ONLY public.pages_access_version
    ADD CONSTRAINT pages_access_version_pkey PRIMARY KEY (pages_access_version_id);

-- The bump() function is the trigger body invoked by triggers on
-- users_roles + users_roles_pages (installed in 116). Define it here
-- because the counter table now exists.
CREATE OR REPLACE FUNCTION public.pages_access_version_bump() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE pages_access_version
       SET pages_access_version_value     = pages_access_version_value + 1,
           pages_access_version_bumped_at = NOW()
     WHERE pages_access_version_id = 1;
    RETURN NULL;
END;
$$;

INSERT INTO public.pages_access_version (
    pages_access_version_id, pages_access_version_value, pages_access_version_bumped_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT pages_access_version_id, pages_access_version_value, pages_access_version_bumped_at FROM public.pages_access_version')
AS t(
    pages_access_version_id integer, pages_access_version_value bigint,
    pages_access_version_bumped_at timestamp with time zone
);

SELECT _p2_assert_rowcount('pages_access_version', _p2_source_rowcount('pages_access_version'));

COMMIT;
