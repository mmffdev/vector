-- ============================================================
-- 117_p2_move_pages_cluster.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 9 of N. Pages surface (final cluster).
--
-- Tables in scope (FK-safe order):
--   1. pages_addressables   (988 rows; self-FK on _id_parent)
--   2. pages                (59 rows; FK pages_tags + subscriptions + users)
--   3. pages_help           (988 rows; FK pages_addressables +
--                                       library_help_defaults + users)
--   4. page_entity_refs     (0 rows; FK pages)
--   5. users_roles_pages    (274 rows; FK pages + users_roles)
--
-- Each table installs its own trigger + function.
-- FK constraints deferred to 118_p2_add_all_fks.sql.
-- ============================================================

BEGIN;

-- ======================================================================
-- TABLE 1: pages_addressables
-- ======================================================================

CREATE TABLE public.pages_addressables (
    pages_addressables_id uuid DEFAULT gen_random_uuid() NOT NULL,
    pages_addressables_id_parent uuid,
    pages_addressables_kind text NOT NULL,
    pages_addressables_name text NOT NULL,
    pages_addressables_address text NOT NULL,
    pages_addressables_page_route text NOT NULL,
    pages_addressables_source text NOT NULL,
    pages_addressables_id_custom_app uuid,
    pages_addressables_soft_archived boolean DEFAULT false NOT NULL,
    pages_addressables_last_seen_at timestamp with time zone,
    pages_addressables_created_at timestamp with time zone DEFAULT now() NOT NULL,
    pages_addressables_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pages_addressables_helpable boolean DEFAULT true NOT NULL,
    CONSTRAINT pages_addressables_source_check CHECK ((pages_addressables_source = ANY (ARRAY['build'::text, 'runtime'::text, 'custom_app'::text])))
);

ALTER TABLE ONLY public.pages_addressables
    ADD CONSTRAINT page_addressables_pkey PRIMARY KEY (pages_addressables_id);

CREATE INDEX pages_addressables_address_idx
    ON public.pages_addressables USING btree (pages_addressables_address)
    WHERE (pages_addressables_soft_archived = false);

CREATE INDEX pages_addressables_gc_idx
    ON public.pages_addressables USING btree (pages_addressables_last_seen_at)
    WHERE ((pages_addressables_source = ANY (ARRAY['runtime'::text, 'custom_app'::text])) AND (pages_addressables_soft_archived = false));

CREATE UNIQUE INDEX pages_addressables_root_unique
    ON public.pages_addressables USING btree (pages_addressables_page_route, pages_addressables_kind, pages_addressables_name)
    WHERE ((pages_addressables_soft_archived = false) AND (pages_addressables_id_parent IS NULL));

CREATE INDEX pages_addressables_route_idx
    ON public.pages_addressables USING btree (pages_addressables_page_route, pages_addressables_soft_archived);

CREATE UNIQUE INDEX pages_addressables_sibling_unique
    ON public.pages_addressables USING btree (pages_addressables_id_parent, pages_addressables_kind, pages_addressables_name)
    WHERE (pages_addressables_soft_archived = false);

CREATE OR REPLACE FUNCTION public.pages_addressables_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.pages_addressables_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER pages_addressables_updated_at
    BEFORE UPDATE ON public.pages_addressables
    FOR EACH ROW EXECUTE FUNCTION public.pages_addressables_set_updated_at();

INSERT INTO public.pages_addressables (
    pages_addressables_id, pages_addressables_id_parent, pages_addressables_kind,
    pages_addressables_name, pages_addressables_address, pages_addressables_page_route,
    pages_addressables_source, pages_addressables_id_custom_app,
    pages_addressables_soft_archived, pages_addressables_last_seen_at,
    pages_addressables_created_at, pages_addressables_updated_at,
    pages_addressables_helpable
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT pages_addressables_id, pages_addressables_id_parent, pages_addressables_kind, pages_addressables_name, pages_addressables_address, pages_addressables_page_route, pages_addressables_source, pages_addressables_id_custom_app, pages_addressables_soft_archived, pages_addressables_last_seen_at, pages_addressables_created_at, pages_addressables_updated_at, pages_addressables_helpable FROM public.pages_addressables')
AS t(
    pages_addressables_id uuid, pages_addressables_id_parent uuid,
    pages_addressables_kind text, pages_addressables_name text,
    pages_addressables_address text, pages_addressables_page_route text,
    pages_addressables_source text, pages_addressables_id_custom_app uuid,
    pages_addressables_soft_archived boolean,
    pages_addressables_last_seen_at timestamp with time zone,
    pages_addressables_created_at timestamp with time zone,
    pages_addressables_updated_at timestamp with time zone,
    pages_addressables_helpable boolean
);

SELECT _p2_assert_rowcount('pages_addressables', _p2_source_rowcount('pages_addressables'));


-- ======================================================================
-- TABLE 2: pages
-- ======================================================================

CREATE TABLE public.pages (
    pages_id uuid DEFAULT gen_random_uuid() NOT NULL,
    pages_key_enum text NOT NULL,
    pages_label text NOT NULL,
    pages_href text NOT NULL,
    pages_icon text NOT NULL,
    pages_tag_enum text NOT NULL,
    pages_kind text NOT NULL,
    pages_pinnable boolean DEFAULT true NOT NULL,
    pages_default_pinned boolean DEFAULT false NOT NULL,
    pages_default_order integer DEFAULT 0 NOT NULL,
    pages_id_user_creator uuid,
    pages_id_subscription uuid,
    pages_created_at timestamp with time zone DEFAULT now() NOT NULL,
    pages_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pages_kind_chk CHECK ((pages_kind = ANY (ARRAY['static'::text, 'entity'::text, 'user_custom'::text])))
);

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (pages_id);

CREATE INDEX idx_pages_id_subscription
    ON public.pages USING btree (pages_id_subscription)
    WHERE (pages_id_subscription IS NOT NULL);

CREATE INDEX idx_pages_id_user_creator
    ON public.pages USING btree (pages_id_user_creator)
    WHERE (pages_id_user_creator IS NOT NULL);

CREATE INDEX idx_pages_tag_enum ON public.pages USING btree (pages_tag_enum);

CREATE UNIQUE INDEX pages_key_enum_id_subscription_id_user_creator_unique
    ON public.pages USING btree (pages_key_enum, pages_id_subscription, pages_id_user_creator)
    WHERE (pages_id_user_creator IS NOT NULL);

CREATE UNIQUE INDEX pages_key_enum_id_subscription_shared_unique
    ON public.pages USING btree (pages_key_enum, pages_id_subscription)
    WHERE ((pages_id_user_creator IS NULL) AND (pages_id_subscription IS NOT NULL));

CREATE UNIQUE INDEX pages_key_enum_system_unique
    ON public.pages USING btree (pages_key_enum)
    WHERE ((pages_id_user_creator IS NULL) AND (pages_id_subscription IS NULL));

CREATE OR REPLACE FUNCTION public.pages_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.pages_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pages_updated_at
    BEFORE UPDATE ON public.pages
    FOR EACH ROW EXECUTE FUNCTION public.pages_set_updated_at();

-- fn_pages_cascade_nav_prefs — AFTER DELETE on pages cleans up
-- users_nav_prefs + users_nav_profiles. Body operates on prefix-swept
-- columns; copy verbatim.
CREATE OR REPLACE FUNCTION public.fn_pages_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_page_key text := OLD.pages_key_enum;
    rec record;
BEGIN
    IF v_page_key IS NULL THEN
        RETURN OLD;
    END IF;

    FOR rec IN
        WITH deleted AS (
            DELETE FROM users_nav_prefs
             WHERE users_nav_prefs_item_key = v_page_key
            RETURNING users_nav_prefs_id_user         AS user_id,
                      users_nav_prefs_id_subscription AS sub_id,
                      users_nav_prefs_id_profile      AS prof_id
        ),
        cleared AS (
            UPDATE users_nav_profiles
               SET users_nav_profiles_start_page_key = NULL
             WHERE users_nav_profiles_start_page_key = v_page_key
            RETURNING users_nav_profiles_id_user         AS user_id,
                      users_nav_profiles_id_subscription AS sub_id,
                      users_nav_profiles_id              AS prof_id
        )
        SELECT DISTINCT user_id, sub_id, prof_id FROM deleted
        UNION
        SELECT DISTINCT user_id, sub_id, prof_id FROM cleared
    LOOP
        PERFORM fn_users_nav_prefs_resequence(rec.user_id, rec.sub_id, rec.prof_id);
    END LOOP;

    RETURN OLD;
END;
$$;

-- Helper invoked by both fn_pages_cascade_nav_prefs and
-- fn_users_role_change_cascade_nav_prefs. Lives in mmff_v today;
-- needs to come along.
CREATE OR REPLACE FUNCTION public.fn_users_nav_prefs_resequence(
    p_user_id uuid, p_subscription_id uuid, p_profile_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    WITH ordered AS (
        SELECT users_nav_prefs_id,
               row_number() OVER (
                   ORDER BY users_nav_prefs_position,
                            users_nav_prefs_item_key
               ) - 1 AS new_pos
          FROM users_nav_prefs
         WHERE users_nav_prefs_id_user         = p_user_id
           AND users_nav_prefs_id_subscription = p_subscription_id
           AND users_nav_prefs_id_profile      = p_profile_id
           AND users_nav_prefs_parent_item_key IS NULL
           AND users_nav_prefs_is_bookmark     = FALSE
    )
    UPDATE users_nav_prefs np
       SET users_nav_prefs_position = ordered.new_pos
      FROM ordered
     WHERE np.users_nav_prefs_id = ordered.users_nav_prefs_id
       AND np.users_nav_prefs_position IS DISTINCT FROM ordered.new_pos;
END;
$$;

CREATE TRIGGER trg_pages_cascade_nav_prefs
    AFTER DELETE ON public.pages
    FOR EACH ROW EXECUTE FUNCTION public.fn_pages_cascade_nav_prefs();

INSERT INTO public.pages (
    pages_id, pages_key_enum, pages_label, pages_href, pages_icon, pages_tag_enum,
    pages_kind, pages_pinnable, pages_default_pinned, pages_default_order,
    pages_id_user_creator, pages_id_subscription, pages_created_at, pages_updated_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT pages_id, pages_key_enum, pages_label, pages_href, pages_icon, pages_tag_enum, pages_kind, pages_pinnable, pages_default_pinned, pages_default_order, pages_id_user_creator, pages_id_subscription, pages_created_at, pages_updated_at FROM public.pages')
AS t(
    pages_id uuid, pages_key_enum text, pages_label text, pages_href text,
    pages_icon text, pages_tag_enum text, pages_kind text,
    pages_pinnable boolean, pages_default_pinned boolean, pages_default_order integer,
    pages_id_user_creator uuid, pages_id_subscription uuid,
    pages_created_at timestamp with time zone,
    pages_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('pages', _p2_source_rowcount('pages'));


-- ======================================================================
-- TABLE 3: pages_help
-- ======================================================================

CREATE TABLE public.pages_help (
    pages_help_id uuid DEFAULT gen_random_uuid() NOT NULL,
    pages_help_id_pages_addressable uuid NOT NULL,
    pages_help_locale text DEFAULT 'en'::text NOT NULL,
    pages_help_body_html text DEFAULT ''::text NOT NULL,
    pages_help_seeded_from text,
    pages_help_id_library_help_default uuid,
    pages_help_soft_archived boolean DEFAULT false NOT NULL,
    pages_help_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pages_help_id_user_updater uuid,
    pages_help_created_at timestamp with time zone DEFAULT now() NOT NULL,
    pages_help_title text,
    pages_help_video_embeds jsonb DEFAULT '[]'::jsonb NOT NULL,
    pages_help_image_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT pages_help_seeded_from_check CHECK ((pages_help_seeded_from = ANY (ARRAY['library'::text, 'manual'::text, 'sdk_manifest'::text, 'placeholder'::text])))
);

ALTER TABLE ONLY public.pages_help
    ADD CONSTRAINT page_help_pkey PRIMARY KEY (pages_help_id);

CREATE INDEX pages_help_id_pages_addressable_idx
    ON public.pages_help USING btree (pages_help_id_pages_addressable)
    WHERE (pages_help_soft_archived = false);

CREATE UNIQUE INDEX pages_help_id_pages_addressable_locale
    ON public.pages_help USING btree (pages_help_id_pages_addressable, pages_help_locale)
    WHERE (pages_help_soft_archived = false);

CREATE OR REPLACE FUNCTION public.pages_help_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.pages_help_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER pages_help_updated_at
    BEFORE UPDATE ON public.pages_help
    FOR EACH ROW EXECUTE FUNCTION public.pages_help_set_updated_at();

INSERT INTO public.pages_help (
    pages_help_id, pages_help_id_pages_addressable, pages_help_locale,
    pages_help_body_html, pages_help_seeded_from, pages_help_id_library_help_default,
    pages_help_soft_archived, pages_help_updated_at, pages_help_id_user_updater,
    pages_help_created_at, pages_help_title, pages_help_video_embeds, pages_help_image_urls
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT pages_help_id, pages_help_id_pages_addressable, pages_help_locale, pages_help_body_html, pages_help_seeded_from, pages_help_id_library_help_default, pages_help_soft_archived, pages_help_updated_at, pages_help_id_user_updater, pages_help_created_at, pages_help_title, pages_help_video_embeds, pages_help_image_urls FROM public.pages_help')
AS t(
    pages_help_id uuid, pages_help_id_pages_addressable uuid, pages_help_locale text,
    pages_help_body_html text, pages_help_seeded_from text,
    pages_help_id_library_help_default uuid, pages_help_soft_archived boolean,
    pages_help_updated_at timestamp with time zone, pages_help_id_user_updater uuid,
    pages_help_created_at timestamp with time zone, pages_help_title text,
    pages_help_video_embeds jsonb, pages_help_image_urls jsonb
);

SELECT _p2_assert_rowcount('pages_help', _p2_source_rowcount('pages_help'));


-- ======================================================================
-- TABLE 4: page_entity_refs
-- ======================================================================

CREATE TABLE public.page_entity_refs (
    page_entity_refs_id_page uuid NOT NULL,
    page_entity_refs_entity_kind text NOT NULL,
    page_entity_refs_entity_id uuid NOT NULL,
    CONSTRAINT page_entity_refs_entity_kind_check CHECK ((page_entity_refs_entity_kind = ANY (ARRAY['portfolio'::text, 'product'::text])))
);

ALTER TABLE ONLY public.page_entity_refs
    ADD CONSTRAINT page_entity_refs_pkey PRIMARY KEY (page_entity_refs_id_page);

ALTER TABLE ONLY public.page_entity_refs
    ADD CONSTRAINT page_entity_refs_entity_kind_entity_id_unique
    UNIQUE (page_entity_refs_entity_kind, page_entity_refs_entity_id);

CREATE INDEX idx_page_entity_refs_entity_kind_entity_id
    ON public.page_entity_refs USING btree (page_entity_refs_entity_kind, page_entity_refs_entity_id);

INSERT INTO public.page_entity_refs (
    page_entity_refs_id_page, page_entity_refs_entity_kind, page_entity_refs_entity_id
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT page_entity_refs_id_page, page_entity_refs_entity_kind, page_entity_refs_entity_id FROM public.page_entity_refs')
AS t(
    page_entity_refs_id_page uuid, page_entity_refs_entity_kind text,
    page_entity_refs_entity_id uuid
);

SELECT _p2_assert_rowcount('page_entity_refs', _p2_source_rowcount('page_entity_refs'));


-- ======================================================================
-- TABLE 5: users_roles_pages
-- ======================================================================

CREATE TABLE public.users_roles_pages (
    users_roles_pages_id_page uuid NOT NULL,
    users_roles_pages_id_role uuid NOT NULL
);

ALTER TABLE ONLY public.users_roles_pages
    ADD CONSTRAINT users_roles_pages_pkey
    PRIMARY KEY (users_roles_pages_id_page, users_roles_pages_id_role);

CREATE INDEX idx_users_roles_pages_id_role
    ON public.users_roles_pages USING btree (users_roles_pages_id_role);

-- fn_users_roles_pages_cascade_nav_prefs — KNOWN-BROKEN trigger
-- function copied AS-IS from mmff_v. Body references bare-column
-- names (pages.id, pages.key_enum, users.id, users.role_id) that no
-- longer exist post-Pillar-1. This is a Pillar 1 wave-6 oversight,
-- not a Pillar 2 regression. Documenting here as TD-NAV-CASCADE-BROKEN.
--
-- We install the function (and its trigger) anyway so VA mirrors
-- mmff_v's broken state — moving without copying the buggy function
-- would be a behavioral divergence. The trigger fires on DELETE,
-- which is not a normal-flow operation, so the bug is dormant.
CREATE OR REPLACE FUNCTION public.fn_users_roles_pages_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_page_key text;
    r record;
BEGIN
    SELECT key_enum INTO v_page_key
      FROM pages
     WHERE id = OLD.users_roles_pages_id_page;
    IF v_page_key IS NULL THEN
        RETURN OLD;
    END IF;

    FOR r IN
        SELECT id AS user_id
          FROM users
         WHERE role_id = OLD.users_roles_pages_id_role
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM users_roles_pages urp
              JOIN users u ON u.role_id = urp.users_roles_pages_id_role
             WHERE u.id = r.user_id
               AND urp.users_roles_pages_id_page = OLD.users_roles_pages_id_page
        ) THEN
            WITH deleted AS (
                DELETE FROM users_nav_prefs
                 WHERE users_nav_prefs_id_user   = r.user_id
                   AND users_nav_prefs_item_key  = v_page_key
                RETURNING users_nav_prefs_id_subscription AS sub_id,
                          users_nav_prefs_id_profile      AS prof_id
            ),
            cleared AS (
                UPDATE users_nav_profiles
                   SET users_nav_profiles_start_page_key = NULL
                 WHERE users_nav_profiles_id_user = r.user_id
                   AND users_nav_profiles_start_page_key = v_page_key
                RETURNING users_nav_profiles_id_subscription AS sub_id,
                          users_nav_profiles_id              AS prof_id
            ),
            distinct_profiles AS (
                SELECT DISTINCT sub_id, prof_id FROM deleted
                UNION
                SELECT DISTINCT sub_id, prof_id FROM cleared
            )
            SELECT fn_users_nav_prefs_resequence(r.user_id, sub_id, prof_id)
              FROM distinct_profiles;
        END IF;
    END LOOP;

    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_users_roles_pages_cascade_nav_prefs
    AFTER DELETE ON public.users_roles_pages
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_roles_pages_cascade_nav_prefs();

CREATE TRIGGER users_roles_pages_bump_access_version
    AFTER INSERT OR DELETE OR UPDATE ON public.users_roles_pages
    FOR EACH STATEMENT EXECUTE FUNCTION public.pages_access_version_bump();

INSERT INTO public.users_roles_pages (
    users_roles_pages_id_page, users_roles_pages_id_role
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_roles_pages_id_page, users_roles_pages_id_role FROM public.users_roles_pages')
AS t(
    users_roles_pages_id_page uuid, users_roles_pages_id_role uuid
);

SELECT _p2_assert_rowcount('users_roles_pages', _p2_source_rowcount('users_roles_pages'));

-- ---- fn_users_role_change_cascade_nav_prefs (deferred from 110) ----
-- This trigger fires on UPDATE of users.users_id_role. It needs
-- users_nav_prefs, users_nav_profiles, users_roles_pages, and pages
-- all present — only now are all four in VA. Install it now.
CREATE OR REPLACE FUNCTION public.fn_users_role_change_cascade_nav_prefs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.users_id_role IS NOT DISTINCT FROM OLD.users_id_role THEN
        RETURN NEW;
    END IF;

    WITH deleted AS (
        DELETE FROM users_nav_prefs np
         WHERE np.users_nav_prefs_id_user = NEW.users_id
           AND NOT EXISTS (
               SELECT 1
                 FROM pages p
                 JOIN users_roles_pages urp
                   ON urp.users_roles_pages_id_page = p.pages_id
                WHERE p.pages_key_enum = np.users_nav_prefs_item_key
                  AND urp.users_roles_pages_id_role = NEW.users_id_role
           )
        RETURNING users_nav_prefs_id_subscription AS sub_id,
                  users_nav_prefs_id_profile      AS prof_id
    ),
    cleared AS (
        UPDATE users_nav_profiles unp
           SET users_nav_profiles_start_page_key = NULL
         WHERE unp.users_nav_profiles_id_user = NEW.users_id
           AND unp.users_nav_profiles_start_page_key IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
                 FROM pages p
                 JOIN users_roles_pages urp
                   ON urp.users_roles_pages_id_page = p.pages_id
                WHERE p.pages_key_enum = unp.users_nav_profiles_start_page_key
                  AND urp.users_roles_pages_id_role = NEW.users_id_role
           )
        RETURNING users_nav_profiles_id_subscription AS sub_id,
                  users_nav_profiles_id              AS prof_id
    ),
    distinct_profiles AS (
        SELECT DISTINCT sub_id, prof_id FROM deleted
        UNION
        SELECT DISTINCT sub_id, prof_id FROM cleared
    )
    SELECT fn_users_nav_prefs_resequence(NEW.users_id, sub_id, prof_id)
      FROM distinct_profiles;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_role_change_cascade_nav_prefs
    AFTER UPDATE OF users_id_role ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_role_change_cascade_nav_prefs();

COMMIT;
