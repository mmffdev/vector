-- ============================================================
-- 110_p2_move_subscriptions_users.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 2 of N.
--
-- Moves the four foundational tables that everything else in the
-- mmff_v graph FKs back to:
--
--   1. subscriptions          (93 rows)
--   2. cost_centres            (1 row, self-FK on parent)
--   3. users                   (59 rows; FKs cost_centres, users_roles,
--                                          users_nav_profiles,
--                                          subscriptions)
--   4. subscriptions_sequence  (2 rows; FKs subscriptions)
--
-- FK constraints are NOT added in this migration. They are deferred
-- to 118_p2_add_all_fks.sql which installs every cross-table FK
-- once all 37 tables are present in vector_artefacts. This avoids
-- creating "FK to a table that's about to be moved" pseudo-orphans
-- during the move waves.
--
-- Triggers (set_updated_at families) ARE installed here per table,
-- because the trigger function bodies are table-local and have no
-- cross-table dependency.
--
-- Includes:
--   * Per-table trigger function bodies (copied from mmff_v).
--   * dblink INSERT … SELECT for data copy.
--   * Inline row-count parity assertion (rolls back on mismatch).
--
-- Reference: handovers/refactorDB.md § Pillar 2 — move order.
-- ============================================================

BEGIN;

-- ======================================================================
-- TABLE 1: subscriptions
-- ======================================================================

CREATE TABLE public.subscriptions (
    subscriptions_id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriptions_name text NOT NULL,
    subscriptions_slug text NOT NULL,
    subscriptions_is_active boolean DEFAULT true NOT NULL,
    subscriptions_created_at timestamp with time zone DEFAULT now() NOT NULL,
    subscriptions_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    subscriptions_tier text DEFAULT 'pro'::text NOT NULL,
    CONSTRAINT subscriptions_tier_chk CHECK ((subscriptions_tier = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])))
);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (subscriptions_id);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_slug_key UNIQUE (subscriptions_slug);

COMMENT ON COLUMN public.subscriptions.subscriptions_tier IS 'Entitlement tier for mmff_library access. Values: free, pro, enterprise. Default pro for backfilled rows; billing service will set this going forward.';

-- Trigger function (per-table, post-Pillar-1 shape) + binding.
CREATE OR REPLACE FUNCTION public.subscriptions_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.subscriptions_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.subscriptions_set_updated_at();

INSERT INTO public.subscriptions (
    subscriptions_id,
    subscriptions_name,
    subscriptions_slug,
    subscriptions_is_active,
    subscriptions_created_at,
    subscriptions_updated_at,
    subscriptions_tier
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT subscriptions_id, subscriptions_name, subscriptions_slug, subscriptions_is_active, subscriptions_created_at, subscriptions_updated_at, subscriptions_tier FROM public.subscriptions')
AS t(
    subscriptions_id uuid,
    subscriptions_name text,
    subscriptions_slug text,
    subscriptions_is_active boolean,
    subscriptions_created_at timestamp with time zone,
    subscriptions_updated_at timestamp with time zone,
    subscriptions_tier text
);

SELECT _p2_assert_rowcount('subscriptions', _p2_source_rowcount('subscriptions'));


-- ======================================================================
-- TABLE 2: cost_centres
-- ======================================================================

CREATE TABLE public.cost_centres (
    cost_centres_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cost_centres_id_subscription uuid NOT NULL,
    cost_centres_id_parent uuid,
    cost_centres_code text NOT NULL,
    cost_centres_name text NOT NULL,
    cost_centres_is_active boolean DEFAULT true NOT NULL,
    cost_centres_archived_at timestamp with time zone,
    cost_centres_created_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_centres_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cost_centres_code_chk CHECK ((length(TRIM(BOTH FROM cost_centres_code)) > 0)),
    CONSTRAINT cost_centres_name_chk CHECK ((length(TRIM(BOTH FROM cost_centres_name)) > 0))
);

ALTER TABLE ONLY public.cost_centres
    ADD CONSTRAINT cost_centres_pkey PRIMARY KEY (cost_centres_id);

CREATE UNIQUE INDEX cost_centres_id_subscription_code_unique
    ON public.cost_centres USING btree (cost_centres_id_subscription, cost_centres_code)
    WHERE (cost_centres_archived_at IS NULL);

CREATE INDEX idx_cost_centres_id_parent
    ON public.cost_centres USING btree (cost_centres_id_parent)
    WHERE (cost_centres_archived_at IS NULL);

CREATE INDEX idx_cost_centres_id_subscription
    ON public.cost_centres USING btree (cost_centres_id_subscription)
    WHERE (cost_centres_archived_at IS NULL);

CREATE OR REPLACE FUNCTION public.cost_centres_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.cost_centres_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cost_centres_updated_at
    BEFORE UPDATE ON public.cost_centres
    FOR EACH ROW EXECUTE FUNCTION public.cost_centres_set_updated_at();

INSERT INTO public.cost_centres (
    cost_centres_id,
    cost_centres_id_subscription,
    cost_centres_id_parent,
    cost_centres_code,
    cost_centres_name,
    cost_centres_is_active,
    cost_centres_archived_at,
    cost_centres_created_at,
    cost_centres_updated_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT cost_centres_id, cost_centres_id_subscription, cost_centres_id_parent, cost_centres_code, cost_centres_name, cost_centres_is_active, cost_centres_archived_at, cost_centres_created_at, cost_centres_updated_at FROM public.cost_centres')
AS t(
    cost_centres_id uuid,
    cost_centres_id_subscription uuid,
    cost_centres_id_parent uuid,
    cost_centres_code text,
    cost_centres_name text,
    cost_centres_is_active boolean,
    cost_centres_archived_at timestamp with time zone,
    cost_centres_created_at timestamp with time zone,
    cost_centres_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('cost_centres', _p2_source_rowcount('cost_centres'));


-- ======================================================================
-- TABLE 3: users
--
-- Uses enum public.user_role (created in 109). 44 columns.
-- ======================================================================

CREATE TABLE public.users (
    users_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_id_subscription uuid NOT NULL,
    users_email text NOT NULL,
    users_password_hash text NOT NULL,
    users_role public.user_role DEFAULT 'user'::public.user_role NOT NULL,
    users_is_active boolean DEFAULT true NOT NULL,
    users_last_login timestamp with time zone,
    users_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    users_auth_method text DEFAULT 'local'::text NOT NULL,
    users_ldap_dn text,
    users_force_password_change boolean DEFAULT false NOT NULL,
    users_password_changed_at timestamp with time zone,
    users_failed_login_count integer DEFAULT 0 NOT NULL,
    users_locked_until timestamp with time zone,
    users_mfa_enrolled boolean DEFAULT false NOT NULL,
    users_mfa_secret text,
    users_mfa_enrolled_at timestamp with time zone,
    users_mfa_recovery_codes text[],
    users_id_active_nav_profile uuid,
    users_theme_pack text DEFAULT 'default'::text NOT NULL,
    users_first_name text,
    users_last_name text,
    users_department text,
    users_id_role uuid NOT NULL,
    users_id_active_scope_node uuid,
    users_preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    users_middle_name text,
    users_display_name text,
    users_phone_work text,
    users_phone_mobile text,
    users_timezone text,
    users_date_format text,
    users_datetime_format text,
    users_email_notifications_enabled boolean DEFAULT true NOT NULL,
    users_password_reset_required boolean DEFAULT false NOT NULL,
    users_id_cost_centre uuid,
    users_id_office_location uuid,
    users_profile_image_url text,
    users_id_default_focus_node uuid,
    users_sentinel_scope_up_default boolean DEFAULT true NOT NULL,
    users_sentinel_scope_down_default boolean DEFAULT true NOT NULL,
    users_home_location_follow_mode boolean DEFAULT false NOT NULL,
    CONSTRAINT users_auth_method_chk CHECK ((users_auth_method = ANY (ARRAY['local'::text, 'ldap'::text])))
);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (users_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_id_subscription_unique UNIQUE (users_email, users_id_subscription);

CREATE INDEX idx_users_department_btree ON public.users USING btree (users_department);
CREATE INDEX idx_users_email_btree ON public.users USING btree (users_email);
CREATE INDEX idx_users_id_active_nav_profile ON public.users USING btree (users_id_active_nav_profile) WHERE (users_id_active_nav_profile IS NOT NULL);
CREATE INDEX idx_users_id_active_scope_node ON public.users USING btree (users_id_active_scope_node) WHERE (users_id_active_scope_node IS NOT NULL);
CREATE INDEX idx_users_id_default_focus_node ON public.users USING btree (users_id, users_id_default_focus_node) WHERE (users_is_active = true);
CREATE INDEX idx_users_id_role ON public.users USING btree (users_id_role);
CREATE INDEX idx_users_id_subscription ON public.users USING btree (users_id_subscription);
CREATE INDEX idx_users_last_name_btree ON public.users USING btree (users_last_name);

CREATE OR REPLACE FUNCTION public.users_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.users_set_updated_at();

-- Note: trigger trg_users_role_change_cascade_nav_prefs depends on
-- function fn_users_role_change_cascade_nav_prefs, which itself
-- references users_nav_prefs (moved later in 114). We defer this
-- trigger (and its function) to 118_p2_add_all_fks.sql so it is
-- installed after all dependent tables exist.

-- Note: users.users_role is enum public.user_role. dblink can only marshal
-- scalar types over the wire, so we pull it as text and cast at INSERT time.
INSERT INTO public.users (
    users_id, users_id_subscription, users_email, users_password_hash,
    users_role, users_is_active, users_last_login, users_created_at,
    users_updated_at, users_auth_method, users_ldap_dn,
    users_force_password_change, users_password_changed_at,
    users_failed_login_count, users_locked_until, users_mfa_enrolled,
    users_mfa_secret, users_mfa_enrolled_at, users_mfa_recovery_codes,
    users_id_active_nav_profile, users_theme_pack, users_first_name,
    users_last_name, users_department, users_id_role,
    users_id_active_scope_node, users_preferences, users_middle_name,
    users_display_name, users_phone_work, users_phone_mobile,
    users_timezone, users_date_format, users_datetime_format,
    users_email_notifications_enabled, users_password_reset_required,
    users_id_cost_centre, users_id_office_location, users_profile_image_url,
    users_id_default_focus_node, users_sentinel_scope_up_default,
    users_sentinel_scope_down_default, users_home_location_follow_mode
)
SELECT
    users_id, users_id_subscription, users_email, users_password_hash,
    users_role::public.user_role, users_is_active, users_last_login, users_created_at,
    users_updated_at, users_auth_method, users_ldap_dn,
    users_force_password_change, users_password_changed_at,
    users_failed_login_count, users_locked_until, users_mfa_enrolled,
    users_mfa_secret, users_mfa_enrolled_at, users_mfa_recovery_codes,
    users_id_active_nav_profile, users_theme_pack, users_first_name,
    users_last_name, users_department, users_id_role,
    users_id_active_scope_node, users_preferences, users_middle_name,
    users_display_name, users_phone_work, users_phone_mobile,
    users_timezone, users_date_format, users_datetime_format,
    users_email_notifications_enabled, users_password_reset_required,
    users_id_cost_centre, users_id_office_location, users_profile_image_url,
    users_id_default_focus_node, users_sentinel_scope_up_default,
    users_sentinel_scope_down_default, users_home_location_follow_mode
FROM dblink(_p2_source_conn(),
    'SELECT users_id, users_id_subscription, users_email, users_password_hash, users_role::text, users_is_active, users_last_login, users_created_at, users_updated_at, users_auth_method, users_ldap_dn, users_force_password_change, users_password_changed_at, users_failed_login_count, users_locked_until, users_mfa_enrolled, users_mfa_secret, users_mfa_enrolled_at, users_mfa_recovery_codes, users_id_active_nav_profile, users_theme_pack, users_first_name, users_last_name, users_department, users_id_role, users_id_active_scope_node, users_preferences, users_middle_name, users_display_name, users_phone_work, users_phone_mobile, users_timezone, users_date_format, users_datetime_format, users_email_notifications_enabled, users_password_reset_required, users_id_cost_centre, users_id_office_location, users_profile_image_url, users_id_default_focus_node, users_sentinel_scope_up_default, users_sentinel_scope_down_default, users_home_location_follow_mode FROM public.users')
AS t(
    users_id uuid, users_id_subscription uuid, users_email text, users_password_hash text,
    users_role text, users_is_active boolean, users_last_login timestamp with time zone,
    users_created_at timestamp with time zone, users_updated_at timestamp with time zone,
    users_auth_method text, users_ldap_dn text, users_force_password_change boolean,
    users_password_changed_at timestamp with time zone, users_failed_login_count integer,
    users_locked_until timestamp with time zone, users_mfa_enrolled boolean,
    users_mfa_secret text, users_mfa_enrolled_at timestamp with time zone,
    users_mfa_recovery_codes text[], users_id_active_nav_profile uuid,
    users_theme_pack text, users_first_name text, users_last_name text,
    users_department text, users_id_role uuid, users_id_active_scope_node uuid,
    users_preferences jsonb, users_middle_name text, users_display_name text,
    users_phone_work text, users_phone_mobile text, users_timezone text,
    users_date_format text, users_datetime_format text,
    users_email_notifications_enabled boolean, users_password_reset_required boolean,
    users_id_cost_centre uuid, users_id_office_location uuid, users_profile_image_url text,
    users_id_default_focus_node uuid, users_sentinel_scope_up_default boolean,
    users_sentinel_scope_down_default boolean, users_home_location_follow_mode boolean
);

SELECT _p2_assert_rowcount('users', _p2_source_rowcount('users'));


-- ======================================================================
-- TABLE 4: subscriptions_sequence
-- ======================================================================

CREATE TABLE public.subscriptions_sequence (
    subscriptions_sequence_id_subscription uuid NOT NULL,
    subscriptions_sequence_scope text NOT NULL,
    subscriptions_sequence_next_num bigint DEFAULT 1 NOT NULL,
    subscriptions_sequence_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_sequence_next_num_check CHECK ((subscriptions_sequence_next_num > 0))
);

ALTER TABLE ONLY public.subscriptions_sequence
    ADD CONSTRAINT subscription_sequence_pkey
    PRIMARY KEY (subscriptions_sequence_id_subscription, subscriptions_sequence_scope);

CREATE OR REPLACE FUNCTION public.subscriptions_sequence_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.subscriptions_sequence_updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_sequence_set_updated_at
    BEFORE UPDATE ON public.subscriptions_sequence
    FOR EACH ROW EXECUTE FUNCTION public.subscriptions_sequence_set_updated_at();

INSERT INTO public.subscriptions_sequence (
    subscriptions_sequence_id_subscription,
    subscriptions_sequence_scope,
    subscriptions_sequence_next_num,
    subscriptions_sequence_updated_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT subscriptions_sequence_id_subscription, subscriptions_sequence_scope, subscriptions_sequence_next_num, subscriptions_sequence_updated_at FROM public.subscriptions_sequence')
AS t(
    subscriptions_sequence_id_subscription uuid,
    subscriptions_sequence_scope text,
    subscriptions_sequence_next_num bigint,
    subscriptions_sequence_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('subscriptions_sequence', _p2_source_rowcount('subscriptions_sequence'));

COMMIT;
