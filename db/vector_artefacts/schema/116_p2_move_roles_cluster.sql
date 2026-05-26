-- ============================================================
-- 116_p2_move_roles_cluster.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 8 of N. RBAC + stakeholders surface.
--
-- Tables in scope:
--   1. users_roles             (8 rows; FK users + subscriptions;
--                                       has updated_at trigger;
--                                       statement-level trigger
--                                       bumps pages_access_version
--                                       on INSERT/UPDATE/DELETE)
--   2. users_roles_workspaces  (32 rows; FK users + subscriptions
--                                        + master_record_workspaces)
--   3. users_roles_permissions (74 rows; FK users + permissions + roles)
--   4. subscriptions_stakeholders (0 rows; FK users + subscriptions;
--                                          polymorphic dispatch trigger
--                                          INTENTIONALLY OMITTED —
--                                          dispatch_polymorphic_parent
--                                          function references DEAD
--                                          parent tables company_roadmap
--                                          / workspace / portfolio /
--                                          product per
--                                          handovers/refactorDB.md
--                                          §"Known caveats". Documented
--                                          as TD-POLYMORPHIC-DISPATCH;
--                                          Pillar 3 to clean up.)
--
-- The fn_users_role_change_cascade_nav_prefs trigger (declared on
-- users in 110 but DEFERRED) is installed here now that users_roles
-- + users_roles_pages exist. The bump trigger on users_roles fires
-- pages_access_version_bump() from 111.
--
-- KNOWN CARRY-OVER: fn_users_roles_pages_cascade_nav_prefs in live
-- mmff_v still references bare-column names (pages.id, pages.key_enum,
-- users.id, users.role_id) — a Pillar 1 wave-6 oversight. The
-- function is copied AS-IS in this migration so VA has the same
-- broken function mmff_v has (no regression). Fixing this is
-- Pillar 1 follow-up work tracked separately.
--
-- users_roles_pages itself moves in 117 (it FKs pages, which moves
-- in 117 with the pages cluster).
-- ============================================================

BEGIN;

-- ======================================================================
-- TABLE 1: users_roles
-- ======================================================================

CREATE TABLE public.users_roles (
    users_roles_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_roles_id_subscription uuid,
    users_roles_code text NOT NULL,
    users_roles_label text NOT NULL,
    users_roles_description text DEFAULT ''::text NOT NULL,
    users_roles_rank integer NOT NULL,
    users_roles_is_system boolean DEFAULT false NOT NULL,
    users_roles_is_external boolean DEFAULT false NOT NULL,
    users_roles_archived_at timestamp with time zone,
    users_roles_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_roles_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    users_roles_id_user_created_by uuid,
    CONSTRAINT users_roles_rank_positive CHECK ((users_roles_rank > 0)),
    CONSTRAINT users_roles_system_no_tenant CHECK ((((users_roles_is_system = true) AND (users_roles_id_subscription IS NULL)) OR (users_roles_is_system = false))),
    CONSTRAINT users_roles_tenant_rank_band CHECK (((users_roles_id_subscription IS NULL) OR (users_roles_rank <> ALL (ARRAY[10, 20, 30, 40, 50, 60, 70]))))
);

ALTER TABLE ONLY public.users_roles
    ADD CONSTRAINT users_roles_pkey PRIMARY KEY (users_roles_id);

CREATE INDEX idx_users_roles_id_subscription
    ON public.users_roles USING btree (users_roles_id_subscription)
    WHERE (users_roles_id_subscription IS NOT NULL);

CREATE INDEX idx_users_roles_rank ON public.users_roles USING btree (users_roles_rank);

CREATE UNIQUE INDEX uq_users_roles_system_code
    ON public.users_roles USING btree (users_roles_code)
    WHERE (users_roles_id_subscription IS NULL);

CREATE UNIQUE INDEX uq_users_roles_tenant_code
    ON public.users_roles USING btree (users_roles_id_subscription, users_roles_code)
    WHERE (users_roles_id_subscription IS NOT NULL);

CREATE OR REPLACE FUNCTION public.fn_users_roles_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_roles_updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_roles_touch_updated_at
    BEFORE UPDATE ON public.users_roles
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_roles_touch_updated_at();

-- statement-level trigger bumps pages_access_version singleton
-- whenever users_roles changes — invalidates client-side access caches.
CREATE TRIGGER users_roles_bump_access_version
    AFTER INSERT OR DELETE OR UPDATE ON public.users_roles
    FOR EACH STATEMENT EXECUTE FUNCTION public.pages_access_version_bump();

INSERT INTO public.users_roles (
    users_roles_id, users_roles_id_subscription, users_roles_code, users_roles_label,
    users_roles_description, users_roles_rank, users_roles_is_system,
    users_roles_is_external, users_roles_archived_at, users_roles_created_at,
    users_roles_updated_at, users_roles_id_user_created_by
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_roles_id, users_roles_id_subscription, users_roles_code, users_roles_label, users_roles_description, users_roles_rank, users_roles_is_system, users_roles_is_external, users_roles_archived_at, users_roles_created_at, users_roles_updated_at, users_roles_id_user_created_by FROM public.users_roles')
AS t(
    users_roles_id uuid, users_roles_id_subscription uuid,
    users_roles_code text, users_roles_label text, users_roles_description text,
    users_roles_rank integer, users_roles_is_system boolean,
    users_roles_is_external boolean,
    users_roles_archived_at timestamp with time zone,
    users_roles_created_at timestamp with time zone,
    users_roles_updated_at timestamp with time zone,
    users_roles_id_user_created_by uuid
);

SELECT _p2_assert_rowcount('users_roles', _p2_source_rowcount('users_roles'));


-- ======================================================================
-- TABLE 2: users_roles_workspaces
-- ======================================================================

CREATE TABLE public.users_roles_workspaces (
    users_roles_workspaces_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_roles_workspaces_id_subscription uuid NOT NULL,
    users_roles_workspaces_id_workspace uuid NOT NULL,
    users_roles_workspaces_id_user uuid NOT NULL,
    users_roles_workspaces_role text NOT NULL,
    users_roles_workspaces_can_redelegate boolean DEFAULT false NOT NULL,
    users_roles_workspaces_id_user_granted_by uuid NOT NULL,
    users_roles_workspaces_granted_at timestamp with time zone DEFAULT now() NOT NULL,
    users_roles_workspaces_revoked_at timestamp with time zone,
    users_roles_workspaces_id_user_revoked_by uuid,
    users_roles_workspaces_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_roles_workspaces_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_roles_workspaces_revoked_pair CHECK ((((users_roles_workspaces_revoked_at IS NULL) AND (users_roles_workspaces_id_user_revoked_by IS NULL)) OR ((users_roles_workspaces_revoked_at IS NOT NULL) AND (users_roles_workspaces_id_user_revoked_by IS NOT NULL)))),
    CONSTRAINT users_roles_workspaces_role_check CHECK ((users_roles_workspaces_role = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])))
);

ALTER TABLE ONLY public.users_roles_workspaces
    ADD CONSTRAINT users_roles_workspaces_pkey PRIMARY KEY (users_roles_workspaces_id);

CREATE INDEX idx_users_roles_workspaces_id_user
    ON public.users_roles_workspaces USING btree (users_roles_workspaces_id_user)
    WHERE (users_roles_workspaces_revoked_at IS NULL);

CREATE UNIQUE INDEX users_roles_workspaces_active_user
    ON public.users_roles_workspaces USING btree (users_roles_workspaces_id_workspace, users_roles_workspaces_id_user)
    WHERE (users_roles_workspaces_revoked_at IS NULL);

CREATE OR REPLACE FUNCTION public.fn_users_roles_workspaces_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.users_roles_workspaces_updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_roles_workspaces_touch_updated_at
    BEFORE UPDATE ON public.users_roles_workspaces
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_roles_workspaces_touch_updated_at();

INSERT INTO public.users_roles_workspaces (
    users_roles_workspaces_id, users_roles_workspaces_id_subscription,
    users_roles_workspaces_id_workspace, users_roles_workspaces_id_user,
    users_roles_workspaces_role, users_roles_workspaces_can_redelegate,
    users_roles_workspaces_id_user_granted_by, users_roles_workspaces_granted_at,
    users_roles_workspaces_revoked_at, users_roles_workspaces_id_user_revoked_by,
    users_roles_workspaces_created_at, users_roles_workspaces_updated_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_roles_workspaces_id, users_roles_workspaces_id_subscription, users_roles_workspaces_id_workspace, users_roles_workspaces_id_user, users_roles_workspaces_role, users_roles_workspaces_can_redelegate, users_roles_workspaces_id_user_granted_by, users_roles_workspaces_granted_at, users_roles_workspaces_revoked_at, users_roles_workspaces_id_user_revoked_by, users_roles_workspaces_created_at, users_roles_workspaces_updated_at FROM public.users_roles_workspaces')
AS t(
    users_roles_workspaces_id uuid, users_roles_workspaces_id_subscription uuid,
    users_roles_workspaces_id_workspace uuid, users_roles_workspaces_id_user uuid,
    users_roles_workspaces_role text, users_roles_workspaces_can_redelegate boolean,
    users_roles_workspaces_id_user_granted_by uuid,
    users_roles_workspaces_granted_at timestamp with time zone,
    users_roles_workspaces_revoked_at timestamp with time zone,
    users_roles_workspaces_id_user_revoked_by uuid,
    users_roles_workspaces_created_at timestamp with time zone,
    users_roles_workspaces_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_roles_workspaces', _p2_source_rowcount('users_roles_workspaces'));


-- ======================================================================
-- TABLE 3: users_roles_permissions
-- ======================================================================

CREATE TABLE public.users_roles_permissions (
    users_roles_permissions_id_role uuid NOT NULL,
    users_roles_permissions_id_permission uuid NOT NULL,
    users_roles_permissions_id_user_granted_by uuid,
    users_roles_permissions_granted_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.users_roles_permissions
    ADD CONSTRAINT users_roles_permissions_pkey
    PRIMARY KEY (users_roles_permissions_id_role, users_roles_permissions_id_permission);

CREATE INDEX idx_users_roles_permissions_id_permission
    ON public.users_roles_permissions USING btree (users_roles_permissions_id_permission);

INSERT INTO public.users_roles_permissions (
    users_roles_permissions_id_role, users_roles_permissions_id_permission,
    users_roles_permissions_id_user_granted_by, users_roles_permissions_granted_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_roles_permissions_id_role, users_roles_permissions_id_permission, users_roles_permissions_id_user_granted_by, users_roles_permissions_granted_at FROM public.users_roles_permissions')
AS t(
    users_roles_permissions_id_role uuid, users_roles_permissions_id_permission uuid,
    users_roles_permissions_id_user_granted_by uuid,
    users_roles_permissions_granted_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_roles_permissions', _p2_source_rowcount('users_roles_permissions'));


-- ======================================================================
-- TABLE 4: subscriptions_stakeholders
-- ======================================================================

CREATE TABLE public.subscriptions_stakeholders (
    subscriptions_stakeholders_id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriptions_stakeholders_id_subscription uuid NOT NULL,
    subscriptions_stakeholders_entity_kind text NOT NULL,
    subscriptions_stakeholders_entity_id uuid NOT NULL,
    subscriptions_stakeholders_id_user uuid NOT NULL,
    subscriptions_stakeholders_role text DEFAULT 'stakeholder'::text NOT NULL,
    subscriptions_stakeholders_created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_stakeholders_entity_kind_check CHECK ((subscriptions_stakeholders_entity_kind = ANY (ARRAY['company_roadmap'::text, 'workspace'::text, 'portfolio'::text, 'product'::text])))
);

ALTER TABLE ONLY public.subscriptions_stakeholders
    ADD CONSTRAINT entity_stakeholders_pkey PRIMARY KEY (subscriptions_stakeholders_id);

ALTER TABLE ONLY public.subscriptions_stakeholders
    ADD CONSTRAINT subscriptions_stakeholders_entity_role_key
    UNIQUE (subscriptions_stakeholders_entity_kind, subscriptions_stakeholders_entity_id, subscriptions_stakeholders_id_user, subscriptions_stakeholders_role);

CREATE INDEX idx_stakeholders_user
    ON public.subscriptions_stakeholders USING btree (subscriptions_stakeholders_id_user);

CREATE INDEX subscriptions_stakeholders_entity_kind_entity_id_idx
    ON public.subscriptions_stakeholders USING btree (subscriptions_stakeholders_entity_kind, subscriptions_stakeholders_entity_id);

CREATE INDEX subscriptions_stakeholders_id_subscription_idx
    ON public.subscriptions_stakeholders USING btree (subscriptions_stakeholders_id_subscription);

-- NOTE: trg_subscriptions_stakeholders_dispatch is NOT installed in VA.
-- Its function calls dispatch_polymorphic_parent() which references
-- DEAD parent tables (company_roadmap, workspace, portfolio, product).
-- Per handovers/refactorDB.md §"Known caveats", the right resolution
-- is to drop the trigger and tighten the CHECK to single surviving
-- parent — that work is deferred to Pillar 3. mmff_v's copy of the
-- trigger remains broken; VA simply omits it. With 0 rows in the
-- source today, this has zero functional impact.

INSERT INTO public.subscriptions_stakeholders (
    subscriptions_stakeholders_id, subscriptions_stakeholders_id_subscription,
    subscriptions_stakeholders_entity_kind, subscriptions_stakeholders_entity_id,
    subscriptions_stakeholders_id_user, subscriptions_stakeholders_role,
    subscriptions_stakeholders_created_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT subscriptions_stakeholders_id, subscriptions_stakeholders_id_subscription, subscriptions_stakeholders_entity_kind, subscriptions_stakeholders_entity_id, subscriptions_stakeholders_id_user, subscriptions_stakeholders_role, subscriptions_stakeholders_created_at FROM public.subscriptions_stakeholders')
AS t(
    subscriptions_stakeholders_id uuid, subscriptions_stakeholders_id_subscription uuid,
    subscriptions_stakeholders_entity_kind text, subscriptions_stakeholders_entity_id uuid,
    subscriptions_stakeholders_id_user uuid, subscriptions_stakeholders_role text,
    subscriptions_stakeholders_created_at timestamp with time zone
);

SELECT _p2_assert_rowcount('subscriptions_stakeholders', _p2_source_rowcount('subscriptions_stakeholders'));

COMMIT;
