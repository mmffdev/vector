--
-- PostgreSQL database dump
--

\restrict UQjVPfGezuOhzLpkQUfvnEiAjgi2XjN8AyWYJJNparAOgMpyG1UsyT8cJAPGYEh

-- Dumped from database version 16.13
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: custom_view_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.custom_view_kind AS ENUM (
    'timeline',
    'board',
    'list'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'user',
    'padmin',
    'gadmin'
);


--
-- Name: dispatch_item_type_parent(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dispatch_item_type_parent(p_kind text, p_id uuid, OUT parent_subscription_id uuid, OUT parent_archived_at timestamp with time zone) RETURNS record
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    CASE p_kind
        WHEN 'portfolio' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM portfolio_item_types WHERE id = p_id;
        WHEN 'execution' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM execution_item_types WHERE id = p_id;
        ELSE
            RAISE EXCEPTION 'unknown item_type parent kind: %', p_kind
                USING ERRCODE = 'foreign_key_violation';
    END CASE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'polymorphic item_type parent not found: kind=%, id=%', p_kind, p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
END;
$$;


--
-- Name: FUNCTION dispatch_item_type_parent(p_kind text, p_id uuid, OUT parent_subscription_id uuid, OUT parent_archived_at timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.dispatch_item_type_parent(p_kind text, p_id uuid, OUT parent_subscription_id uuid, OUT parent_archived_at timestamp with time zone) IS 'Resolves an item_type_states polymorphic parent reference to (subscription_id, archived_at). Raises foreign_key_violation if missing. See docs/c_polymorphic_writes.md.';


--
-- Name: dispatch_polymorphic_parent(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dispatch_polymorphic_parent(p_kind text, p_id uuid, OUT parent_subscription_id uuid, OUT parent_archived_at timestamp with time zone) RETURNS record
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    CASE p_kind
        WHEN 'company_roadmap' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM company_roadmap WHERE id = p_id;
        WHEN 'workspace' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM workspace WHERE id = p_id;
        WHEN 'portfolio' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM portfolio WHERE id = p_id;
        WHEN 'product' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM product WHERE id = p_id;
        ELSE
            RAISE EXCEPTION 'unknown polymorphic parent kind: %', p_kind
                USING ERRCODE = 'foreign_key_violation';
    END CASE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'polymorphic parent not found: kind=%, id=%', p_kind, p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
END;
$$;


--
-- Name: FUNCTION dispatch_polymorphic_parent(p_kind text, p_id uuid, OUT parent_subscription_id uuid, OUT parent_archived_at timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.dispatch_polymorphic_parent(p_kind text, p_id uuid, OUT parent_subscription_id uuid, OUT parent_archived_at timestamp with time zone) IS 'Resolves an entity_stakeholders / page_entity_refs polymorphic parent reference to (subscription_id, archived_at). Raises foreign_key_violation if missing. See docs/c_polymorphic_writes.md.';


--
-- Name: error_events_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.error_events_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'error_events is append-only (op=%, id=%)',
        TG_OP, COALESCE(OLD.id, NEW.id)
        USING ERRCODE = 'check_violation';
END;
$$;


--
-- Name: execution_item_types_lock_name(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execution_item_types_lock_name() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
        RAISE EXCEPTION 'execution_item_types.name is immutable (id=%, old=%, new=%)',
            OLD.id, OLD.name, NEW.name
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: item_state_history_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.item_state_history_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'item_state_history is append-only (op=%, id=%)',
        TG_OP, COALESCE(OLD.id, NEW.id)
        USING ERRCODE = 'check_violation';
END;
$$;


--
-- Name: provision_on_first_gadmin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.provision_on_first_gadmin() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.role = 'gadmin' AND NEW.is_active = TRUE THEN
        IF NOT EXISTS (
            SELECT 1 FROM company_roadmap WHERE subscription_id = NEW.subscription_id
        ) THEN
            PERFORM provision_subscription_defaults(NEW.subscription_id, NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: provision_subscription_defaults(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.provision_subscription_defaults(p_subscription_id uuid, p_owner_user_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_roadmap_id     UUID;
    v_workspace_id   UUID;
    v_product_id     UUID;
BEGIN
    -- Company roadmap (ROAD-00000001) — one per subscription.
    SELECT id INTO v_roadmap_id
        FROM company_roadmap
        WHERE subscription_id = p_subscription_id;

    IF v_roadmap_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'roadmap', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO company_roadmap (subscription_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, 1, 'Company Roadmap', p_owner_user_id)
            RETURNING id INTO v_roadmap_id;
    END IF;

    -- Workspace (SPACE-00000001).
    SELECT id INTO v_workspace_id
        FROM workspace
        WHERE subscription_id = p_subscription_id AND key_num = 1;

    IF v_workspace_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'workspace', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO workspace (subscription_id, company_roadmap_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, v_roadmap_id, 1, 'My Workspace', p_owner_user_id)
            RETURNING id INTO v_workspace_id;
    END IF;

    -- Product (PROD-00000001) under SPACE-00000001.
    SELECT id INTO v_product_id
        FROM product
        WHERE subscription_id = p_subscription_id AND key_num = 1;

    IF v_product_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'product', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO product (subscription_id, workspace_id, parent_portfolio_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, v_workspace_id, NULL, 1, 'Product', p_owner_user_id)
            RETURNING id INTO v_product_id;
    END IF;

    -- Portfolio sequence counter (starts at 1 so first portfolio is PO-00000001).
    INSERT INTO subscription_sequence (subscription_id, scope, next_num)
        VALUES (p_subscription_id, 'portfolio', 1)
        ON CONFLICT (subscription_id, scope) DO NOTHING;

    -- Stakeholder audit rows.
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'company_roadmap', v_roadmap_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'workspace',       v_workspace_id, p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'product',         v_product_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;

    -- execution_item_types (locked name, editable tag).
    INSERT INTO execution_item_types (subscription_id, name, tag, sort_order) VALUES
        (p_subscription_id, 'Epic Story', 'ES', 10),
        (p_subscription_id, 'User Story', 'US', 20),
        (p_subscription_id, 'Defect',     'DE', 30),
        (p_subscription_id, 'Task',       'TA', 40)
    ON CONFLICT (subscription_id, tag) DO NOTHING;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: trg_entity_stakeholders_dispatch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_entity_stakeholders_dispatch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    parent_subscription UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT parent_subscription_id, parent_archived_at
      INTO parent_subscription, parent_archived
      FROM dispatch_polymorphic_parent(NEW.entity_kind, NEW.entity_id);

    IF parent_subscription IS DISTINCT FROM NEW.subscription_id THEN
        RAISE EXCEPTION 'cross-subscription polymorphic write rejected: entity_stakeholders.subscription_id=% does not match parent (% / %).subscription_id=%',
            NEW.subscription_id, NEW.entity_kind, NEW.entity_id, parent_subscription
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: entity_stakeholders -> (% / %) archived_at=%',
            NEW.entity_kind, NEW.entity_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: trg_item_type_states_dispatch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_item_type_states_dispatch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    parent_subscription UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT parent_subscription_id, parent_archived_at
      INTO parent_subscription, parent_archived
      FROM dispatch_item_type_parent(NEW.item_type_kind, NEW.item_type_id);

    IF parent_subscription IS DISTINCT FROM NEW.subscription_id THEN
        RAISE EXCEPTION 'cross-subscription polymorphic write rejected: item_type_states.subscription_id=% does not match parent (% / %).subscription_id=%',
            NEW.subscription_id, NEW.item_type_kind, NEW.item_type_id, parent_subscription
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: item_type_states -> (% / %) archived_at=%',
            NEW.item_type_kind, NEW.item_type_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: trg_page_entity_refs_dispatch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_page_entity_refs_dispatch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    page_subscription UUID;
    parent_subscription UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT subscription_id INTO page_subscription FROM pages WHERE id = NEW.page_id;
    IF page_subscription IS NULL THEN
        RAISE EXCEPTION 'page_entity_refs write rejected: page_id=% has no subscription -- bookmark pages must be subscription-scoped',
            NEW.page_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT parent_subscription_id, parent_archived_at
      INTO parent_subscription, parent_archived
      FROM dispatch_polymorphic_parent(NEW.entity_kind, NEW.entity_id);

    IF parent_subscription IS DISTINCT FROM page_subscription THEN
        RAISE EXCEPTION 'cross-subscription polymorphic write rejected: page_entity_refs page.subscription_id=% does not match parent (% / %).subscription_id=%',
            page_subscription, NEW.entity_kind, NEW.entity_id, parent_subscription
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: page_entity_refs -> (% / %) archived_at=%',
            NEW.entity_kind, NEW.entity_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    subscription_id uuid,
    action text NOT NULL,
    resource text,
    resource_id text,
    metadata jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: canonical_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canonical_states (
    code text NOT NULL,
    label text NOT NULL,
    clock_role text NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT canonical_states_clock_role_check CHECK ((clock_role = ANY (ARRAY['none'::text, 'lead_start'::text, 'cycle_active'::text, 'cycle_stop'::text, 'lead_stop'::text])))
);


--
-- Name: company_roadmap; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_roadmap (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    name text NOT NULL,
    owner_user_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_roadmap_key_num_check CHECK ((key_num > 0))
);


--
-- Name: entity_stakeholders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_stakeholders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    entity_kind text NOT NULL,
    entity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'stakeholder'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_stakeholders_entity_kind_check CHECK ((entity_kind = ANY (ARRAY['company_roadmap'::text, 'workspace'::text, 'portfolio'::text, 'product'::text])))
);


--
-- Name: error_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    user_id uuid,
    code text NOT NULL,
    context jsonb,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE error_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.error_events IS 'Per-subscription append-only log of reported errors. Matches item_state_history append-only pattern. UPDATE/DELETE rejected by trigger.';


--
-- Name: COLUMN error_events.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.error_events.code IS 'App-enforced FK by value to mmff_library.error_codes.code. Not a Postgres FK (cross-database). Readers should LEFT JOIN across DBs and tolerate missing matches.';


--
-- Name: COLUMN error_events.context; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.error_events.context IS 'Optional structured payload from reportError(code, context). Small JSON object (< ~4 KB) of short snake_case keys. Link out to logs/traces for anything larger.';


--
-- Name: COLUMN error_events.request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.error_events.request_id IS 'Correlation handle to logs/traces. Matches go-chi middleware.RequestID output (TEXT, not UUID).';


--
-- Name: execution_item_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_item_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    tag text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT execution_item_types_tag_check CHECK (((length(tag) >= 2) AND (length(tag) <= 4)))
);


--
-- Name: library_acknowledgements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_acknowledgements (
    subscription_id uuid NOT NULL,
    release_id uuid NOT NULL,
    acknowledged_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged_by_user_id uuid NOT NULL,
    action_taken text NOT NULL,
    CONSTRAINT library_acknowledgements_action_taken_check CHECK ((action_taken = ANY (ARRAY['upgrade_model'::text, 'review_terminology'::text, 'enable_flag'::text, 'dismissed'::text])))
);


--
-- Name: TABLE library_acknowledgements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.library_acknowledgements IS 'Per-subscription ack of a mmff_library release. release_id is an app-enforced FK into mmff_library.library_releases (no cross-DB RI). See plan §12.3.';


--
-- Name: page_entity_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_entity_refs (
    page_id uuid NOT NULL,
    entity_kind text NOT NULL,
    entity_id uuid NOT NULL,
    CONSTRAINT page_entity_refs_entity_kind_check CHECK ((entity_kind = ANY (ARRAY['portfolio'::text, 'product'::text])))
);


--
-- Name: page_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_roles (
    page_id uuid NOT NULL,
    role public.user_role NOT NULL
);


--
-- Name: page_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_tags (
    tag_enum text NOT NULL,
    display_name text NOT NULL,
    default_order integer NOT NULL,
    is_admin_menu boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key_enum text NOT NULL,
    label text NOT NULL,
    href text NOT NULL,
    icon text NOT NULL,
    tag_enum text NOT NULL,
    kind text NOT NULL,
    pinnable boolean DEFAULT true NOT NULL,
    default_pinned boolean DEFAULT false NOT NULL,
    default_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    subscription_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pages_kind_valid CHECK ((kind = ANY (ARRAY['static'::text, 'entity'::text, 'user_custom'::text])))
);


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    requested_ip inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pending_library_cleanup_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_library_cleanup_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    job_kind text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 8 NOT NULL,
    last_error text,
    visible_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pending_library_cleanup_jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT pending_library_cleanup_jobs_job_kind_check CHECK ((job_kind = ANY (ARRAY['preset_archive_propagation'::text, 'template_instance_unlink'::text, 'library_mirror_purge'::text]))),
    CONSTRAINT pending_library_cleanup_jobs_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT pending_library_cleanup_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'dead'::text])))
);


--
-- Name: TABLE pending_library_cleanup_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pending_library_cleanup_jobs IS 'Postgres-backed work queue for cross-DB cleanup of library-derived entities. Claimed via SELECT ... FOR UPDATE SKIP LOCKED. See feature_library_db_and_portfolio_presets_v3.md §4.';


--
-- Name: portfolio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    key_num bigint NOT NULL,
    name text NOT NULL,
    owner_user_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_key_num_check CHECK ((key_num > 0))
);


--
-- Name: product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    parent_portfolio_id uuid,
    key_num bigint NOT NULL,
    name text NOT NULL,
    owner_user_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_key_num_check CHECK ((key_num > 0))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address inet,
    user_agent text,
    revoked boolean DEFAULT false NOT NULL
);


--
-- Name: subscription_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    source_library_id uuid NOT NULL,
    source_library_version integer NOT NULL,
    artifact_key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_artifacts_source_library_version_check CHECK ((source_library_version > 0))
);


--
-- Name: TABLE subscription_artifacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscription_artifacts IS 'Per-subscription mirror of mmff_library.portfolio_model_artifacts. artifact_key is unique per-subscription (live rows). See migration header.';


--
-- Name: subscription_layers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_layers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    source_library_id uuid NOT NULL,
    source_library_version integer NOT NULL,
    name text NOT NULL,
    tag text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    parent_layer_id uuid,
    icon text,
    colour text,
    description_md text,
    help_md text,
    allows_children boolean DEFAULT true NOT NULL,
    is_leaf boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_layers_source_library_version_check CHECK ((source_library_version > 0)),
    CONSTRAINT subscription_layers_tag_check CHECK (((length(tag) >= 2) AND (length(tag) <= 4)))
);


--
-- Name: TABLE subscription_layers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscription_layers IS 'Per-subscription mirror of mmff_library.portfolio_model_layers, populated by the adoption orchestrator. Source row identified by (source_library_id, source_library_version) — APP-ENFORCED cross-DB reference. See feature_library_db_and_portfolio_presets_v3.md §11 (adoption saga) and c_polymorphic_writes.md (writer-rules pattern).';


--
-- Name: COLUMN subscription_layers.source_library_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscription_layers.source_library_id IS 'mmff_library.portfolio_model_layers.id at adopt time. Cross-DB; validated by the adoption handler, swept by nightly reconciler.';


--
-- Name: COLUMN subscription_layers.source_library_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscription_layers.source_library_version IS 'Snapshot of mmff_library.portfolio_models.version at adopt time. Used by the reconciler to detect upstream bundle upgrades.';


--
-- Name: subscription_portfolio_model_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_portfolio_model_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    adopted_model_id uuid NOT NULL,
    adopted_by_user_id uuid NOT NULL,
    adopted_at timestamp with time zone DEFAULT now() NOT NULL,
    status text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_portfolio_model_state_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'rolled_back'::text])))
);


--
-- Name: TABLE subscription_portfolio_model_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscription_portfolio_model_state IS 'Per-subscription adoption record for an mmff_library portfolio_models row. One non-terminal row per subscription (partial unique index). See feature_library_db_and_portfolio_presets_v3.md §11 for the adoption saga.';


--
-- Name: COLUMN subscription_portfolio_model_state.adopted_model_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscription_portfolio_model_state.adopted_model_id IS 'App-enforced FK to mmff_library.portfolio_models.id. Cross-DB FKs do not exist in Postgres; the adoption handler validates this reference at write time and the nightly reconciler sweeps for orphans. See c_polymorphic_writes.md for the writer-rules pattern.';


--
-- Name: COLUMN subscription_portfolio_model_state.adopted_by_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscription_portfolio_model_state.adopted_by_user_id IS 'Padmin user who initiated the adoption. Role enforced at the handler (padmin-only endpoint), not at the DB. RESTRICT prevents hard-delete of a user while their adoption is live.';


--
-- Name: COLUMN subscription_portfolio_model_state.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscription_portfolio_model_state.status IS 'Adoption-saga lifecycle: pending, in_progress, completed, failed, rolled_back. CHECK constraint pins the vocabulary; new values require a migration + handler update.';


--
-- Name: subscription_sequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_sequence (
    subscription_id uuid NOT NULL,
    scope text NOT NULL,
    next_num bigint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_sequence_next_num_check CHECK ((next_num > 0))
);


--
-- Name: subscription_terminology; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_terminology (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    source_library_id uuid NOT NULL,
    source_library_version integer NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_terminology_source_library_version_check CHECK ((source_library_version > 0))
);


--
-- Name: TABLE subscription_terminology; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscription_terminology IS 'Per-subscription mirror of mmff_library.portfolio_model_terminology (label overrides). key is unique per-subscription (live rows). See migration header.';


--
-- Name: subscription_workflow_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_workflow_transitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    source_library_id uuid NOT NULL,
    source_library_version integer NOT NULL,
    from_state_id uuid NOT NULL,
    to_state_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_workflow_transitions_check CHECK ((from_state_id <> to_state_id)),
    CONSTRAINT subscription_workflow_transitions_source_library_version_check CHECK ((source_library_version > 0))
);


--
-- Name: TABLE subscription_workflow_transitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscription_workflow_transitions IS 'Per-subscription mirror of mmff_library.portfolio_model_workflow_transitions. from_state_id/to_state_id reference subscription_workflows (mirror) rows, NOT library rows. The orchestrator translates library_id -> mirror_id at adopt time. See migration header.';


--
-- Name: subscription_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    source_library_id uuid NOT NULL,
    source_library_version integer NOT NULL,
    layer_id uuid NOT NULL,
    state_key text NOT NULL,
    state_label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_initial boolean DEFAULT false NOT NULL,
    is_terminal boolean DEFAULT false NOT NULL,
    colour text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_workflows_source_library_version_check CHECK ((source_library_version > 0))
);


--
-- Name: TABLE subscription_workflows; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscription_workflows IS 'Per-subscription mirror of mmff_library.portfolio_model_workflows (workflow states per layer). layer_id references the mirror layer row (NOT the library layer). See migration header.';


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tier text DEFAULT 'pro'::text NOT NULL,
    CONSTRAINT subscriptions_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])))
);


--
-- Name: COLUMN subscriptions.tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriptions.tier IS 'Entitlement tier for mmff_library access. Values: free, pro, enterprise. Default pro for backfilled rows; billing service will set this going forward.';


--
-- Name: user_custom_page_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_custom_page_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    page_id uuid NOT NULL,
    label text NOT NULL,
    kind public.custom_view_kind NOT NULL,
    "position" integer NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_custom_page_views_label_nonempty CHECK ((length(btrim(label)) > 0))
);


--
-- Name: user_custom_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_custom_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    label text NOT NULL,
    icon text DEFAULT 'folder'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_custom_pages_label_nonempty CHECK ((length(btrim(label)) > 0))
);


--
-- Name: user_nav_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_nav_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_nav_groups_label_max CHECK ((length(label) <= 64)),
    CONSTRAINT user_nav_groups_label_nonempty CHECK ((length(TRIM(BOTH FROM label)) > 0))
);


--
-- Name: user_nav_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_nav_prefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    item_key text NOT NULL,
    "position" integer NOT NULL,
    is_start_page boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_item_key text,
    group_id uuid,
    icon_override text
);


--
-- Name: user_nav_profile_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_nav_profile_groups (
    profile_id uuid NOT NULL,
    group_id uuid NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_nav_profile_groups_position_nonneg CHECK (("position" >= 0))
);


--
-- Name: user_nav_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_nav_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    label text NOT NULL,
    "position" integer NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    start_page_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_nav_profiles_label_max CHECK ((length(label) <= 32)),
    CONSTRAINT user_nav_profiles_label_nonempty CHECK ((length(btrim(label)) > 0)),
    CONSTRAINT user_nav_profiles_position_nonneg CHECK (("position" >= 0))
);


--
-- Name: user_workspace_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_workspace_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    can_view boolean DEFAULT false NOT NULL,
    can_edit boolean DEFAULT false NOT NULL,
    can_admin boolean DEFAULT false NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role public.user_role DEFAULT 'user'::public.user_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auth_method text DEFAULT 'local'::text NOT NULL,
    ldap_dn text,
    force_password_change boolean DEFAULT false NOT NULL,
    password_changed_at timestamp with time zone,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    mfa_enrolled boolean DEFAULT false NOT NULL,
    mfa_secret text,
    mfa_enrolled_at timestamp with time zone,
    mfa_recovery_codes text[],
    active_nav_profile_id uuid,
    theme_pack text DEFAULT 'default'::text NOT NULL,
    CONSTRAINT users_auth_method_check CHECK ((auth_method = ANY (ARRAY['local'::text, 'ldap'::text])))
);


--
-- Name: workspace; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    company_roadmap_id uuid NOT NULL,
    key_num bigint NOT NULL,
    name text NOT NULL,
    owner_user_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_key_num_check CHECK ((key_num > 0))
);


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_log (id, user_id, subscription_id, action, resource, resource_id, metadata, ip_address, created_at) FROM stdin;
4d83f378-fd9a-4a9a-9ec6-dfc799600fa0	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 02:42:47.662066+00
ea8aacb8-a2d3-49de-9664-19225174e2fb	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 02:42:49.995321+00
163f764c-3272-4e12-85f7-a0d207b54a29	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 02:42:58.466049+00
0072294d-58ab-41a5-b02b-f512a97aed7b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 02:44:03.826614+00
b36441dd-08d1-466c-a9f7-11386aef967f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 02:44:11.540513+00
0922533e-9bc3-459f-8cec-e9ab88a3c6aa	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.password_change	\N	\N	\N	::1	2026-04-28 02:44:27.531951+00
625e606f-0bfc-4344-9470-d38b381d849b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	\N	auth.refresh_token_reuse	\N	\N	{"session_id": "bc7305d0-394d-4c8a-8326-cb81b1ec153b"}	::1	2026-04-28 02:44:27.600406+00
f406d452-f5d6-4ecf-ad67-41082cac7b97	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 02:44:30.67833+00
eabb8402-c888-4e93-b8f0-748f615e1868	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 02:45:37.361767+00
0f71f74e-f88a-4dd8-9bee-5585dc5c3703	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 02:45:37.442939+00
3d0f57db-b42b-4c01-8759-8297a0bc4685	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	\N	auth.refresh_token_reuse	\N	\N	{"session_id": "11570b7b-fc52-4517-8ff8-4ddd983aa376"}	::1	2026-04-28 02:45:37.47403+00
e2ce7b1d-c031-46a1-8362-a55d92044dbe	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 02:46:21.530934+00
281765e5-84fd-4ffd-a33f-c9bfbf8664d1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	\N	auth.logout	\N	\N	\N	::1	2026-04-28 02:46:35.444404+00
991fb949-476b-404b-81f4-6ba1f9e37a7e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.account_locked	\N	\N	\N	::1	2026-04-28 02:46:39.542738+00
0d19f4c1-3732-4945-b512-eace4f3af961	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 02:46:39.558055+00
5a9f747a-909b-4693-a4ae-1b74896590e1	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-04-28 02:46:59.810185+00
c508e118-a44b-4110-b1ea-fa3d14591365	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 02:47:29.006715+00
95fd8f04-83c1-4148-a755-d77538fb5fac	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 02:48:50.503542+00
7f8598d7-612f-44de-b83d-cbf9ed019822	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 02:50:52.24012+00
4d49763a-f24c-419a-a2c9-712683e97776	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 02:50:54.52969+00
82c91fb0-1e1d-4cca-ad39-b5625c5dd88e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 02:53:22.992197+00
a24f31d0-6450-4c00-b5d7-cf3750cff87e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 02:53:32.533684+00
1928556d-7ff0-4214-a8ad-82e8243c0c64	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 02:54:25.288347+00
55de37bf-5f0e-4fc5-a812-0dd445d613e6	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 02:55:41.196071+00
87b87af2-1987-449d-9349-351339ff7d64	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:16:22.275479+00
ee248fda-1e6c-4025-9a39-ddd80f3f6833	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:26:25.247908+00
c1145438-5620-4273-b043-d0001660a4bd	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:31:22.68471+00
f6eb2fa1-2dfb-4560-b267-dc657928f164	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:40:35.644247+00
d9968365-b569-486d-9a4b-dc9b68c20e2b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:40:35.835346+00
1ff14c50-efd3-44a8-bbef-afea217ac7a3	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:40:35.93274+00
6557c7e7-df27-4832-b10f-6089ea775b68	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:41:21.943826+00
f06b279b-bf17-432f-9596-b96cf0a978f6	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:56:33.014071+00
42b1b2b7-451a-435e-87e3-7dd1de5b6d2f	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:57:38.14692+00
16e8fb82-2c44-4cec-9778-8b4de0845f45	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:57:38.470588+00
89710ae1-3727-4948-b681-f56147706452	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:57:47.702282+00
844986b2-f066-41a5-bf34-b5888fd3a790	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:57:47.765683+00
c1fd9140-305a-49f0-bdec-6a271ce3b206	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:58:00.026834+00
d4153c91-6bcb-472e-a6e0-2c6f4aaf86d0	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:58:00.100718+00
23ca85ca-8e2d-4f6a-b8a8-15713f54f752	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:58:10.985438+00
88abe89d-dd16-4b68-8d5e-ab1bcab5d6e4	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:58:11.046521+00
fbd8c38d-a0d6-46ce-a3f1-db4d21377853	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:58:44.088574+00
21f3e93c-5ed3-4a25-8517-cf2dad9cd856	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:58:44.1538+00
5b1fa04c-0c99-4088-bd11-c1349fda2a0a	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:59:02.932354+00
a650f75f-553c-4f98-a35d-d3d2f7f265e7	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:59:03.001075+00
2d063764-6908-45bb-b812-45eceb04dadf	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:59:10.733579+00
ac172ed5-2f45-4ae7-8f6e-c65e8de63453	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 03:59:10.802645+00
de6d635f-cb4a-40a8-b0df-02d3011c4aa9	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 04:00:37.194233+00
91ccade4-6185-45a2-957a-13c0359b9fb0	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 04:08:20.912517+00
db8111f1-7423-4dc4-86d4-d46980a735d2	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 04:10:42.43112+00
308cb97f-783c-4644-8222-c4b9aa1565c7	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:01.289614+00
ff1f66fd-9f0f-45ca-8f04-a4f7dffbacd9	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:01.390758+00
49c9bbab-06ba-4876-856c-76c5a35b62e9	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:01.463198+00
85370c33-ea19-441d-815b-31380fe90cb7	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:04.452534+00
2c4e72a6-0662-4c3e-9d48-dc62cd7aa1c5	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:04.50803+00
ed03ec15-a218-4889-a81a-31480996c988	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:04.56592+00
e3d9b05d-fb26-4ad3-8d31-ed851bfadde4	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:11.446566+00
6761c303-1017-40be-8e8b-02d9de7a8f21	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:11.705426+00
c20743d8-ad18-4665-b418-98367060497e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:12.777451+00
1d5e6655-93d3-4c2b-9b4d-c9d103598e45	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:25.418944+00
2d6b0f6d-a83f-4479-9745-b77ed537e332	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:25.479039+00
1faad13c-4f40-4f2b-9065-0675ef87165f	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:25.552414+00
94f68d1f-5727-4e93-973b-4d915f139ab5	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:40.631153+00
f5d4dfcf-46f2-4fa3-b6bf-7d8627c05a27	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:40.683513+00
ae784926-f0c3-4ddf-9218-62c5324ef8d3	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:29:40.767056+00
95ce1bad-0fdd-4416-a93a-fecd78f91d46	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 05:32:57.178783+00
a87c4226-13ac-41ab-a08d-bafe59b537ab	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:02:32.340821+00
10c87ce4-3d53-4123-af02-74a24328d0ad	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:03:07.077228+00
3092f441-360d-4ff4-875f-f54dd653624a	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:03:07.255871+00
81fcdfc1-0d38-4b99-a4bb-33ad3585e2ab	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:04:53.416436+00
03682dd8-47e4-4dde-8991-2d961671df10	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:05:04.949116+00
dd7d7138-825b-43a1-a490-06192d46d4d4	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:05:41.644376+00
f858a072-4867-4ecc-8ebd-ae6d5cc62d0b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:09:30.625008+00
ceffb034-ea64-42f0-9feb-2d2e1d705e18	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:10:12.586768+00
72d7114b-86cd-44f5-84f5-59f42499c4e3	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:38:01.425822+00
fbfb9a9f-3d0e-4019-b5ec-c15b3218ccc2	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:40:31.29249+00
0bcddbaf-bb10-4fc5-8668-bfe52bb42247	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:40:31.509758+00
b0bfab44-9583-4c37-acac-210fa5c6ce6c	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:40:40.476714+00
616f6ca0-e72b-425d-a9de-5c27a7337ad0	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:40:40.5634+00
900dd35d-d527-4ed8-822b-eaad44107d1e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:46:48.504927+00
09a9fa83-3aef-40de-93b7-b64304205992	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:53:16.920816+00
5454e058-c77b-4685-9a3d-71883212a77d	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:53:45.736478+00
3d6089a7-5d7b-4079-930c-18b6b5238464	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:55:31.088807+00
295ecdc9-589c-41f3-ae99-be1dc04dd5b8	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:57:23.148009+00
bb4ffb5b-c120-4920-9207-af0f46ae9447	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 06:58:31.672338+00
8d7e78a6-d147-42ec-8c52-12e1833270eb	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:00:34.102042+00
e2aee9f1-25e2-4e07-b2bb-f53935e44477	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:17:17.81616+00
0b0930ce-39d6-4297-90ad-ecd7054f8b45	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:17:24.579856+00
e472cb68-4e3b-48c9-bd2d-bf9c587ed7f5	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:17:49.646083+00
51faed4d-7cf0-455f-b3c2-84ccc798ae63	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:17:54.920121+00
9f4c5013-3804-4429-b3de-7ba5362b5ee6	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:17:55.977145+00
dc04766e-a313-4680-a90f-24478f86b09c	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:20:45.85483+00
a5ecf362-4b8f-4463-8035-5fe7b8b0d743	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:25:24.65656+00
32030583-722e-4471-ba62-602b465ada9a	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:32:22.151689+00
e958cee9-e1d7-433d-a661-28c0925c888c	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:38:14.75248+00
60fda146-5331-40fb-be9c-2625f82b48f5	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 07:55:00.193354+00
9391d285-cf63-40f9-8a1c-75579c011a5d	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 08:21:14.131789+00
bed97816-3d85-4e06-a9df-e063c70d9181	6cabe266-b2f4-43f9-879c-06020c789a0b	\N	auth.logout	\N	\N	\N	::1	2026-04-28 08:31:00.819339+00
44aff29d-500a-43e0-8371-8048ee309d64	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 08:31:06.905464+00
71874a31-77a1-4aac-8722-ad28bd6b5094	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 08:39:32.5865+00
36b0e0cb-bdf6-4639-aaf0-683ab8fb1ca8	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	\N	auth.logout	\N	\N	\N	::1	2026-04-28 08:40:02.948824+00
506cb17a-f7e1-43aa-af0a-71de26bf9e79	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 08:40:06.419248+00
9c3b3ac5-8ac1-48fb-baee-b78113956037	6cabe266-b2f4-43f9-879c-06020c789a0b	\N	auth.logout	\N	\N	\N	::1	2026-04-28 08:42:05.485991+00
e771ea70-198f-4d22-86cc-b2b537a91349	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 08:42:07.316787+00
8775eb80-1891-4d90-a129-cc2141a32204	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 08:49:16.108159+00
badd4d64-5798-4f2b-bc6f-165ebb74d983	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 09:07:22.749462+00
a70faf5d-c027-4c9d-85cb-68c02cc55013	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 09:10:51.46576+00
d98751b8-2dc7-4b48-b4be-46d26ee6fd6c	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 09:13:17.809784+00
8919879c-0798-4bbd-b06d-1b8733281c27	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 09:19:50.14747+00
82d0fb0a-0c23-4993-8540-0254f0ca4847	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 09:19:54.789953+00
a37a6f9b-6faa-44b0-92a1-6ef039dcf546	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 09:19:55.107124+00
e9e18824-3448-4a97-804b-1e5229ee9eb5	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 09:19:55.48983+00
0d2ee2db-b1d0-4af3-a0bf-1b2aa8ab7d27	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.account_locked	\N	\N	\N	::1	2026-04-28 09:19:55.855876+00
5be5d762-bf04-4a94-97a9-2e96e5885a62	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-28 09:19:55.873016+00
f3413a49-85bc-4547-bf25-50dfe715f75e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-04-28 09:19:55.920815+00
653b60df-daca-4a4c-9379-4e418afb15b3	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-04-28 09:19:56.05128+00
7fe0a116-1d1c-4b89-83ad-5e65b5a7753e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-04-28 09:19:56.098863+00
51486928-7f81-4061-b0cc-741bda9a3d9b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-04-28 09:19:56.143782+00
0414ddbd-369a-4b4b-9371-bf52a8f8f2db	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-04-28 09:19:56.190687+00
c9440284-570d-4f55-8ec5-c0d0052bd0cf	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-04-28 09:29:43.396146+00
5986aa2e-07e5-41dd-8a2e-24522a3264ab	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 09:30:02.236826+00
e0b558d2-dbab-4130-bdae-6bbcd73e715b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 09:30:09.174863+00
2aced008-1c87-4358-a2c5-295a39c094e7	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 09:31:29.888549+00
6028ae75-26ce-4dca-9d32-18d630e7589c	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-28 09:31:56.002012+00
363c0e5a-b243-4c7b-b6fd-24d92df4a309	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 09:42:09.085587+00
37519d74-831d-4b67-ab3c-24fee8ef6a0f	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 10:22:53.548851+00
07b915eb-3db1-412d-8fbd-0ccce54e0cac	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 11:38:08.276934+00
c4277cba-783e-4e9c-81e8-db6e12169b7b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 11:47:59.932852+00
fc9e5a23-cbe3-4da1-aa0a-447727956acf	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 15:52:48.016191+00
6a32c3ea-7323-4f1f-b9bf-94d16903b73c	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 16:14:00.736079+00
b61ee73f-12b7-411e-afc7-0aa323faf523	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 16:18:13.466279+00
2c284801-e0df-4da2-8234-0eb269650578	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 23:43:38.732542+00
1ffca8af-56c1-4c0c-be12-d233fff3904b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 23:46:13.91838+00
c6e64cee-97cf-4192-bf4c-b7ee6c052acd	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 23:46:14.931149+00
1788fad1-cb0b-4a5f-9c5e-c27cb4873bdd	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 23:46:21.220737+00
8c1e68a7-ac0f-43ef-b2f5-59b26f3ea3a9	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 23:46:24.875414+00
016355b6-bf50-430c-9c0a-01bce8f623e4	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 23:50:16.785369+00
88eae8cf-63bd-4229-8463-80998df0e989	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 23:50:21.609164+00
e505b99f-0911-41dc-bb49-85442d0f58d1	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-28 23:55:09.271351+00
\.


--
-- Data for Name: canonical_states; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.canonical_states (code, label, clock_role, sort_order, created_at) FROM stdin;
defined	Defined	none	10	2026-04-27 10:56:55.469971+00
ready	Ready	lead_start	20	2026-04-27 10:56:55.469971+00
in_progress	In Progress	cycle_active	30	2026-04-27 10:56:55.469971+00
completed	Completed	cycle_stop	40	2026-04-27 10:56:55.469971+00
accepted	Accepted	lead_stop	50	2026-04-27 10:56:55.469971+00
\.


--
-- Data for Name: company_roadmap; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.company_roadmap (id, subscription_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: entity_stakeholders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.entity_stakeholders (id, subscription_id, entity_kind, entity_id, user_id, role, created_at) FROM stdin;
\.


--
-- Data for Name: error_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.error_events (id, subscription_id, user_id, code, context, occurred_at, request_id, created_at) FROM stdin;
\.


--
-- Data for Name: execution_item_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.execution_item_types (id, subscription_id, name, tag, sort_order, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: library_acknowledgements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_acknowledgements (subscription_id, release_id, acknowledged_at, acknowledged_by_user_id, action_taken) FROM stdin;
\.


--
-- Data for Name: page_entity_refs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_entity_refs (page_id, entity_kind, entity_id) FROM stdin;
\.


--
-- Data for Name: page_roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_roles (page_id, role) FROM stdin;
d3492b72-1391-4b5a-8014-e07903b665bb	user
285ff8fa-40ce-40c8-b517-4fd9a0993912	user
6c4838e8-59ac-45ce-955d-e7f04bd0b13b	user
71ce157a-906d-458a-875e-d83f8ef1b940	user
6b9fa7fc-4856-4f14-82af-56ff6e102388	user
c54501d6-b33b-4ac6-946b-b3f0971eae3b	user
25e69690-1513-4e65-ac75-b1f43865dd30	user
4e194f2f-e029-4de0-9ce7-86d36ea59513	user
8bfc6b19-162f-47d1-bbbf-89a750ca90ae	user
d3492b72-1391-4b5a-8014-e07903b665bb	padmin
285ff8fa-40ce-40c8-b517-4fd9a0993912	padmin
6c4838e8-59ac-45ce-955d-e7f04bd0b13b	padmin
71ce157a-906d-458a-875e-d83f8ef1b940	padmin
6b9fa7fc-4856-4f14-82af-56ff6e102388	padmin
c54501d6-b33b-4ac6-946b-b3f0971eae3b	padmin
25e69690-1513-4e65-ac75-b1f43865dd30	padmin
4e194f2f-e029-4de0-9ce7-86d36ea59513	padmin
8bfc6b19-162f-47d1-bbbf-89a750ca90ae	padmin
d3492b72-1391-4b5a-8014-e07903b665bb	gadmin
285ff8fa-40ce-40c8-b517-4fd9a0993912	gadmin
6c4838e8-59ac-45ce-955d-e7f04bd0b13b	gadmin
71ce157a-906d-458a-875e-d83f8ef1b940	gadmin
6b9fa7fc-4856-4f14-82af-56ff6e102388	gadmin
c54501d6-b33b-4ac6-946b-b3f0971eae3b	gadmin
25e69690-1513-4e65-ac75-b1f43865dd30	gadmin
4e194f2f-e029-4de0-9ce7-86d36ea59513	gadmin
8bfc6b19-162f-47d1-bbbf-89a750ca90ae	gadmin
88088499-9bd1-4d61-8d92-d1d74cb6197b	padmin
88088499-9bd1-4d61-8d92-d1d74cb6197b	gadmin
51edf618-9dab-4afa-92bb-1db54809954b	gadmin
4c07a460-cbd4-422c-b477-c00c561d4aac	user
4c07a460-cbd4-422c-b477-c00c561d4aac	padmin
4c07a460-cbd4-422c-b477-c00c561d4aac	gadmin
ce130a78-1be2-46b4-9a98-de0ac2d35c11	padmin
47bde2be-0b8e-4dcc-a6bd-16d13833bf37	gadmin
5e409713-fe14-410b-a6e3-2213065dadb3	user
5e409713-fe14-410b-a6e3-2213065dadb3	padmin
5e409713-fe14-410b-a6e3-2213065dadb3	gadmin
\.


--
-- Data for Name: page_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_tags (tag_enum, display_name, default_order, is_admin_menu, created_at) FROM stdin;
personal_settings	Personal Settings	5	t	2026-04-27 10:56:56.549827+00
bookmarks	Bookmarks	0	f	2026-04-27 10:56:56.944636+00
personal	Personal	0	f	2026-04-27 10:56:56.549827+00
admin_settings	Admin Settings	1	f	2026-04-27 10:56:56.549827+00
planning	Planning	2	f	2026-04-27 10:56:56.549827+00
strategic	Strategic	3	f	2026-04-27 10:56:56.549827+00
\.


--
-- Data for Name: pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pages (id, key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id, created_at, updated_at) FROM stdin;
d3492b72-1391-4b5a-8014-e07903b665bb	dashboard	Dashboard	/dashboard	home	personal	static	t	t	0	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
285ff8fa-40ce-40c8-b517-4fd9a0993912	my-vista	My Vista	/my-vista	eye	personal	static	t	t	1	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
6c4838e8-59ac-45ce-955d-e7f04bd0b13b	backlog	Backlog	/backlog	clipboard	planning	static	t	t	0	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
71ce157a-906d-458a-875e-d83f8ef1b940	planning	Planning	/planning	list	planning	static	t	t	1	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
6b9fa7fc-4856-4f14-82af-56ff6e102388	portfolio	Portfolio	/portfolio	briefcase	planning	static	t	t	2	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
c54501d6-b33b-4ac6-946b-b3f0971eae3b	favourites	Favourites	/favourites	star	personal	static	t	t	2	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
25e69690-1513-4e65-ac75-b1f43865dd30	risk	Risk	/risk	warning	strategic	static	t	t	0	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
51edf618-9dab-4afa-92bb-1db54809954b	workspace-settings	Workspace Settings	/workspace-settings	cog	admin_settings	static	t	t	0	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
88088499-9bd1-4d61-8d92-d1d74cb6197b	portfolio-settings	Portfolio Settings	/portfolio-settings	briefcase	admin_settings	static	t	t	1	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
8bfc6b19-162f-47d1-bbbf-89a750ca90ae	dev	Dev Setup	/dev	wrench	personal	static	f	f	99	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:56:56.549827+00
ce130a78-1be2-46b4-9a98-de0ac2d35c11	portfolio-model	Portfolio Model	/portfolio-model	package	admin_settings	static	t	t	2	\N	\N	2026-04-27 10:57:00.352033+00	2026-04-27 10:57:00.352033+00
47bde2be-0b8e-4dcc-a6bd-16d13833bf37	library-releases	Library Releases	/library-releases	bell	admin_settings	static	t	t	3	\N	\N	2026-04-27 10:57:00.75998+00	2026-04-27 10:57:00.75998+00
4e194f2f-e029-4de0-9ce7-86d36ea59513	account-settings	Account Settings	/account-settings	user	personal_settings	static	f	f	0	\N	\N	2026-04-27 10:56:56.549827+00	2026-04-27 10:57:01.30252+00
5e409713-fe14-410b-a6e3-2213065dadb3	dev-library	Library	/dev/library	book-open	personal	static	f	f	101	\N	\N	2026-04-27 10:57:03.18217+00	2026-04-27 10:57:03.18217+00
4c07a460-cbd4-422c-b477-c00c561d4aac	theme	Theme	/theme	theme	personal	static	t	f	99	\N	\N	2026-04-27 10:56:58.117089+00	2026-04-28 05:31:02.401892+00
\.


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_resets (id, user_id, token_hash, expires_at, used_at, requested_ip, created_at) FROM stdin;
\.


--
-- Data for Name: pending_library_cleanup_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pending_library_cleanup_jobs (id, subscription_id, job_kind, payload, status, attempts, max_attempts, last_error, visible_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: portfolio; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio (id, subscription_id, workspace_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: product; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.product (id, subscription_id, workspace_id, parent_portfolio_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (filename, applied_at) FROM stdin;
001_init.sql	2026-04-28 06:54:35.899556+00
002_auth_permissions.sql	2026-04-28 06:54:35.899556+00
003_mfa_scaffold.sql	2026-04-28 06:54:35.899556+00
004_portfolio_stack.sql	2026-04-28 06:54:35.899556+00
005_item_types.sql	2026-04-28 06:54:35.899556+00
006_states.sql	2026-04-28 06:54:35.899556+00
007_rename_permissions.sql	2026-04-28 06:54:35.899556+00
008_user_nav_prefs.sql	2026-04-28 06:54:35.899556+00
009_page_registry.sql	2026-04-28 06:54:35.899556+00
010_nav_entity_bookmarks.sql	2026-04-28 06:54:35.899556+00
011_nav_subpages_custom_groups.sql	2026-04-28 06:54:35.899556+00
012_pages_partial_unique.sql	2026-04-28 06:54:35.899556+00
013_polymorphic_dispatch_triggers.sql	2026-04-28 06:54:35.899556+00
014_page_theme.sql	2026-04-28 06:54:35.899556+00
015_user_nav_icon_override.sql	2026-04-28 06:54:35.899556+00
016_user_custom_pages.sql	2026-04-28 06:54:35.899556+00
017_subscriptions_rename.sql	2026-04-28 06:54:35.899556+00
018_subscription_tier.sql	2026-04-28 06:54:35.899556+00
019_pending_library_cleanup_jobs.sql	2026-04-28 06:54:35.899556+00
020_portfolio_model_page.sql	2026-04-28 06:54:35.899556+00
021_library_acknowledgements.sql	2026-04-28 06:54:35.899556+00
022_library_releases_page.sql	2026-04-28 06:54:35.899556+00
023_backfill_library_releases_pin.sql	2026-04-28 06:54:35.899556+00
024_backfill_portfolio_model_pin.sql	2026-04-28 06:54:35.899556+00
025_nav_group_reorder.sql	2026-04-28 06:54:35.899556+00
026_subscription_portfolio_model_state.sql	2026-04-28 06:54:35.899556+00
028_error_events.sql	2026-04-28 06:54:35.899556+00
029_adoption_mirror_tables.sql	2026-04-28 06:54:35.899556+00
030_unpin_gadmin_portfolio_model.sql	2026-04-28 06:54:35.899556+00
031_nav_dev_library.sql	2026-04-28 06:54:35.899556+00
032_drop_pre_adoption_item_types.sql	2026-04-28 06:54:35.899556+00
033_theme_unpinnable_product_strategic.sql	2026-04-28 06:54:35.899556+00
034_user_nav_profiles.sql	2026-04-28 06:54:35.899556+00
035_user_nav_profiles_links.sql	2026-04-28 06:54:35.899556+00
036_backfill_default_profiles.sql	2026-04-28 06:54:35.899556+00
037_user_nav_prefs_position_per_parent.sql	2026-04-28 06:54:35.899556+00
038_pin_product_entity_bookmark.sql	2026-04-28 06:54:35.899556+00
039_user_theme_pack.sql	2026-04-28 06:54:35.899556+00
040_theme_page_library.sql	2026-04-28 06:54:35.899556+00
041_fix_subscription_layer_sort_order.sql	2026-04-28 06:54:40.091376+00
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (id, user_id, token_hash, created_at, expires_at, last_used_at, ip_address, user_agent, revoked) FROM stdin;
4e4ed645-de7f-4000-94cd-d50a836b7f94	6cabe266-b2f4-43f9-879c-06020c789a0b	46db563cdecc898974736083aa8223fd712ff367aab8024f045804b0a7f65aad	2026-04-28 03:16:22.183187+00	2026-05-05 03:16:22.210919+00	2026-04-28 03:16:22.183187+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7f4c42dd-c792-4f17-9685-ab46657b34d8	6cabe266-b2f4-43f9-879c-06020c789a0b	96d24a095575bb189d5be681b1dbe1c7dd51028d9afb17191b4e39ab8d4aa0e3	2026-04-28 03:26:25.138345+00	2026-05-05 03:26:25.171759+00	2026-04-28 03:26:25.138345+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bc7305d0-394d-4c8a-8326-cb81b1ec153b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	bb1a8cd8fb56242812fc24f4d0526259a0960347a89f5dcbb623505fe712e459	2026-04-28 02:44:11.524828+00	2026-05-05 02:44:11.492951+00	2026-04-28 02:44:11.524828+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a2d08b5e-f372-4f93-849e-ae5f815b4081	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	12d71a01038d8b261f2d56552d246b3e56debe08127d6f4932a702120ce94067	2026-04-28 02:45:37.321011+00	2026-05-05 02:45:37.383832+00	2026-04-28 02:45:37.321011+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
11570b7b-fc52-4517-8ff8-4ddd983aa376	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	c6bec5a777dca6a97a187b9620080ef7e3c564427d56ef70f9bd4260e1fd3203	2026-04-28 02:44:30.663776+00	2026-05-05 02:44:30.645645+00	2026-04-28 02:44:30.663776+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
13f13d88-3106-4df7-80d7-18c5c68ff464	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	7eed9fcef5287689dcb440596d789ead9e6be18b096374e3d4f8cef3a56ed3c7	2026-04-28 02:45:37.221263+00	2026-05-05 02:45:37.246116+00	2026-04-28 02:45:37.221263+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6900ca5b-e02e-49f0-b5a5-e6c6656172ab	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	6955dda9b7fae2f5326327cadee848b4215a3f99f5fce06c8a6fc50ffe13d980	2026-04-28 02:46:21.51576+00	2026-05-05 02:46:21.497933+00	2026-04-28 02:46:21.51576+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1efa0819-6bd0-44fb-ac8b-157b2d2c5262	6cabe266-b2f4-43f9-879c-06020c789a0b	e0125b380aa5eeae97ece653bb4ab46e57d7b06cfda17313507c299327704eb8	2026-04-28 02:47:28.970888+00	2026-05-05 02:47:28.804443+00	2026-04-28 02:47:28.970888+00	::1	curl/8.7.1	f
200f3af7-b355-4fd0-bbc7-5df70b0226e1	6cabe266-b2f4-43f9-879c-06020c789a0b	6e1fad2c284072771f3ec582499fcaf12138ccbab5fad5f41107f08ce482e6f2	2026-04-28 02:48:50.478168+00	2026-05-05 02:48:50.461228+00	2026-04-28 02:48:50.478168+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c02479ff-cf28-47e6-949b-ddbcbf2a1056	6cabe266-b2f4-43f9-879c-06020c789a0b	1a187bc3782cce8c6b247650dc2504467ea7321710b435c9da2edfa38cc12fe7	2026-04-28 02:50:52.155145+00	2026-05-05 02:50:52.194487+00	2026-04-28 02:50:52.155145+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
8177e418-b1ab-4a1d-94ba-a91a258e97bd	6cabe266-b2f4-43f9-879c-06020c789a0b	00795a5578007dfaf0328423fa5de70220ee71d991c58d6eebc87620499c3efc	2026-04-28 02:50:54.425765+00	2026-05-05 02:50:54.407908+00	2026-04-28 02:50:54.425765+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
7050e1c1-98c8-4860-ae7d-4b70ddec78fc	6cabe266-b2f4-43f9-879c-06020c789a0b	0feec8e3bbbd8cdff55c30fdc748e261d8870abb6080c87b92b8950230ec1423	2026-04-28 02:53:32.518159+00	2026-05-05 02:53:32.501004+00	2026-04-28 02:53:32.518159+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7d4c29c4-a387-4e14-9f18-c12b2c80338a	6cabe266-b2f4-43f9-879c-06020c789a0b	d9607c9094297b32d35863f9b46a91eed38a27fbf91d543aa1cf691ef94e5fe0	2026-04-28 02:54:25.224342+00	2026-05-05 02:54:25.240247+00	2026-04-28 02:54:25.224342+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2481b16e-697a-4f7f-bde1-67c9c08cc530	6cabe266-b2f4-43f9-879c-06020c789a0b	0002a9383eff11e064d68d2bee3ae3a06adbbf6945d48b55e8734cc3b37a3e1e	2026-04-28 02:55:41.132359+00	2026-05-05 02:55:41.147814+00	2026-04-28 02:55:41.132359+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
3a5555f0-8da3-4d16-b28f-c8188dfa7df9	6cabe266-b2f4-43f9-879c-06020c789a0b	cadc690368f16df9e8fc4b4dea5733031b5266152f1de5497d4cfefcaedf107d	2026-04-28 03:41:21.779935+00	2026-05-05 03:41:21.897441+00	2026-04-28 03:41:21.779935+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
095b13ff-a58e-4d9a-ad3e-298f13a9b3ee	6cabe266-b2f4-43f9-879c-06020c789a0b	6dc9d2f4e4cfacda521066cc69221eafac7c181f1980adfafd7e2624d8dcf619	2026-04-28 03:40:35.550106+00	2026-05-05 03:40:35.585416+00	2026-04-28 03:40:35.550106+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
3d783997-1160-47b5-8f46-11a149afb144	6cabe266-b2f4-43f9-879c-06020c789a0b	f5b49e2f077933d58f9644f520435b55e6328ca4dd5e9a93d019f1891d05a20a	2026-04-28 03:40:35.5331+00	2026-05-05 03:40:35.642161+00	2026-04-28 03:40:35.5331+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
bc242516-360d-4d65-865a-dc6845477b3f	6cabe266-b2f4-43f9-879c-06020c789a0b	8ed1e416bef1e628a1d8fff6e826a2c5250eded59dbd6de8bd45fe3370c28e72	2026-04-28 03:31:22.579581+00	2026-05-05 03:31:22.609445+00	2026-04-28 03:31:22.579581+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
03ba955e-defc-4782-80cc-8a75b2bbd505	6cabe266-b2f4-43f9-879c-06020c789a0b	ee31f982ecf3f609adb0b1af7312d9fd25007a4f37ce1dc83e5591b3f6bd4764	2026-04-28 03:40:35.576177+00	2026-05-05 03:40:35.805407+00	2026-04-28 03:40:35.576177+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
8d5ad9f9-9be7-4d1b-82ea-c4b5ae477bbe	6cabe266-b2f4-43f9-879c-06020c789a0b	18095fe3180faced453215197a2610d7b6e78ba717619c2394d42de958fc75d4	2026-04-28 03:57:38.025169+00	2026-05-05 03:57:38.067835+00	2026-04-28 03:57:38.025169+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
e7a75cac-7041-44a8-9938-f4d8b5f4af9d	6cabe266-b2f4-43f9-879c-06020c789a0b	c2a9eb977bb6fcf9e1fde0ec1b621020013a9abfe6d9b3ca4d18313407aa4426	2026-04-28 03:56:32.94788+00	2026-05-05 03:56:32.965849+00	2026-04-28 03:56:32.94788+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
fe36ff89-5fff-4d56-91d5-2353110b61d6	6cabe266-b2f4-43f9-879c-06020c789a0b	5e4b4e8e6fc13508d137b41524213a9b82bf825eba3d8fc9d11474629fbc96a4	2026-04-28 03:57:47.503911+00	2026-05-05 03:57:47.547238+00	2026-04-28 03:57:47.503911+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
5d9edc3f-92b9-4e52-971e-a9d431a484e9	6cabe266-b2f4-43f9-879c-06020c789a0b	74d7e4442fe4f5848fb2f314eaf7b1b01896131cc03a3732d391c653e1c9af1d	2026-04-28 03:57:38.278023+00	2026-05-05 03:57:38.31631+00	2026-04-28 03:57:38.278023+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5e70dcbb-1b95-46f6-83a4-44dd74db9bd7	6cabe266-b2f4-43f9-879c-06020c789a0b	ba207e413e59f71126827c253e972eb529b88a5ca447b869c99e500c9e6bb2b0	2026-04-28 03:57:59.937974+00	2026-05-05 03:57:59.974248+00	2026-04-28 03:57:59.937974+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
e6a5a211-0073-4f84-bfd9-6c71e09bbee6	6cabe266-b2f4-43f9-879c-06020c789a0b	6566093c3c53cdd6d3f561f1a4e7923476a00da55c9f009e7771f1e0b82ebb42	2026-04-28 03:57:47.548392+00	2026-05-05 03:57:47.701676+00	2026-04-28 03:57:47.548392+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4328d822-990a-4148-95dd-05832e6b2f0a	6cabe266-b2f4-43f9-879c-06020c789a0b	c9aa3ed6087acc8aed4a894ebbf9954cd49012d430acff1ea9ff357cdf1c1b06	2026-04-28 03:57:59.938012+00	2026-05-05 03:58:00.024996+00	2026-04-28 03:57:59.938012+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5d68bb71-2897-466b-bf3d-eb4ac00fa791	6cabe266-b2f4-43f9-879c-06020c789a0b	2bceb435e3ee52bcf7d73378219fd3813d9b53629f34414761dfef2a035721e6	2026-04-28 03:58:10.824089+00	2026-05-05 03:58:10.981514+00	2026-04-28 03:58:10.824089+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2236932c-6e08-4a8b-b7ce-57ef5a1eb1ca	6cabe266-b2f4-43f9-879c-06020c789a0b	32162a84756424d6b24c50d7d3f31dda57b370b03a498a266b0df48a3e260a70	2026-04-28 03:58:10.80109+00	2026-05-05 03:58:10.928114+00	2026-04-28 03:58:10.80109+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
04f43d36-ed44-42b3-863e-45e2faa99d2c	6cabe266-b2f4-43f9-879c-06020c789a0b	24f2c2eb83da05186c13d694cd43a0370d39c6e7adaa93c0531114f8b3d7d4f1	2026-04-28 03:58:43.986851+00	2026-05-05 03:58:44.038235+00	2026-04-28 03:58:43.986851+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
4fc53785-c80e-4f54-80a3-f376f22a9336	6cabe266-b2f4-43f9-879c-06020c789a0b	74c0fa55431116dc182a951df041447e9c527f2e2332d29d1319773b2c0eb59b	2026-04-28 03:59:02.752703+00	2026-05-05 03:59:02.882019+00	2026-04-28 03:59:02.752703+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
1e3e4473-2ddd-48c5-90f8-930bbf2fe2c7	6cabe266-b2f4-43f9-879c-06020c789a0b	6def5588934c52396ea9d40760d6af51df002a6de117b99846c2f19e83fc3df3	2026-04-28 03:58:44.003639+00	2026-05-05 03:58:44.084886+00	2026-04-28 03:58:44.003639+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
366c2c57-f986-403e-8ea7-ba1215d8ab32	6cabe266-b2f4-43f9-879c-06020c789a0b	fdc7ad7cbeefd10d6f72d2e6fa12a8e33e4c00824bc3655ae45bc796dcee1bb2	2026-04-28 05:29:11.385691+00	2026-05-05 05:29:11.398833+00	2026-04-28 05:29:11.385691+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
36ecba6d-e89d-4f0c-b83c-6a658f976679	6cabe266-b2f4-43f9-879c-06020c789a0b	76276cf90b1befbfcf13cb93b58fd35309cbc64722709ad77e159b5e63e7958c	2026-04-28 03:59:10.546075+00	2026-05-05 03:59:10.601998+00	2026-04-28 03:59:10.546075+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
810e0160-c85a-4e85-a671-4013109b204b	6cabe266-b2f4-43f9-879c-06020c789a0b	684a432c87e124d45142826096259634852a5a40af2086476cab297494cffdbf	2026-04-28 03:59:02.849425+00	2026-05-05 03:59:02.929844+00	2026-04-28 03:59:02.849425+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d9c20b2f-48f3-48a9-971a-d12475ce57bd	6cabe266-b2f4-43f9-879c-06020c789a0b	e72af3e1be3dc1cf35dc271c944bd744cd51845224d49c60dd2f980b0a9ac4be	2026-04-28 03:59:10.564236+00	2026-05-05 03:59:10.732694+00	2026-04-28 03:59:10.564236+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
63228173-af6f-4642-b0ee-b13d46cf6ce3	6cabe266-b2f4-43f9-879c-06020c789a0b	ce0de0ae21dab33b80adb7fe890dd750651baa40f3cacff4077caf49b129840c	2026-04-28 04:00:37.117222+00	2026-05-05 04:00:37.142043+00	2026-04-28 04:00:37.117222+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5272b2b9-2891-4926-8b7e-ff086675e7ef	6cabe266-b2f4-43f9-879c-06020c789a0b	0c83e1679cd3bfe9f89e20147c6800f95d1952c6bd168d1ecce8d3621cf15c49	2026-04-28 04:08:20.843727+00	2026-05-05 04:08:20.862171+00	2026-04-28 04:08:20.843727+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
711ad36b-372c-4163-a322-2ef3eca5639c	6cabe266-b2f4-43f9-879c-06020c789a0b	4a0463bff85b78f790bcc3f7594b3019370fc90327f9b7e1ce9bc1080ad8555c	2026-04-28 05:29:01.002998+00	2026-05-05 05:29:01.16547+00	2026-04-28 05:29:01.002998+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
da1db324-bbb8-4535-80a6-b151d144f051	6cabe266-b2f4-43f9-879c-06020c789a0b	d0c051391b3593b155225e5464d0733e3f6d62a6e2507bddbcb1b629ee25eb58	2026-04-28 05:29:11.50423+00	2026-05-05 05:29:11.63533+00	2026-04-28 05:29:11.50423+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
83c30474-1b95-4ad0-a01a-def0124f768b	6cabe266-b2f4-43f9-879c-06020c789a0b	92bfe52aaf252685ad1d425a164e5b46cf0cfa8bf047ab5f80ee790c2c81cf89	2026-04-28 05:29:01.223078+00	2026-05-05 05:29:01.287514+00	2026-04-28 05:29:01.223078+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
afeb1bc8-4a8b-4145-a998-df9143aee90a	6cabe266-b2f4-43f9-879c-06020c789a0b	10c19a10687a474d4027cdf64c779fc4094054da2ec5e474685dc4e10d499292	2026-04-28 04:10:42.37374+00	2026-05-05 04:10:42.384823+00	2026-04-28 04:10:42.37374+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ebaa5950-e092-4cb2-a524-c748cc7eac4e	6cabe266-b2f4-43f9-879c-06020c789a0b	f0091ff92d8c2092b3a68fcf0f6e17d136df75e5cfadd673625965e950d97e71	2026-04-28 05:29:25.33628+00	2026-05-05 05:29:25.373814+00	2026-04-28 05:29:25.33628+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
18bcda7a-5ec3-42cd-ab32-c6c1e5694b00	6cabe266-b2f4-43f9-879c-06020c789a0b	736c352d9220ee1c1e3807fb0db59ffef1cbdf3d3ea28e604805835455ca1bbb	2026-04-28 05:29:04.368967+00	2026-05-05 05:29:04.407366+00	2026-04-28 05:29:04.368967+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
21fc59a6-2882-49c6-8ca3-5ff96eb8fea5	6cabe266-b2f4-43f9-879c-06020c789a0b	7745e7653508fc3aa4e9c1527a57da9d0ee620277920ba2d387c09396f8782d6	2026-04-28 05:29:25.336243+00	2026-05-05 05:29:25.41793+00	2026-04-28 05:29:25.336243+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
fc6952a9-df0d-4f8e-8e5f-ecdf53545ccf	6cabe266-b2f4-43f9-879c-06020c789a0b	714dd6ff12bd74ea1ae6ef2fd1cd76c699d6aba8a1d5a415b1cebfde7b01f47a	2026-04-28 05:29:04.382135+00	2026-05-05 05:29:04.44901+00	2026-04-28 05:29:04.382135+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
73ba5fcd-e04a-4f43-bd8a-e8e070838712	6cabe266-b2f4-43f9-879c-06020c789a0b	54f2c95aa9cc3d28485a91cf0c1c6a3914b3eca96ef439cef8a5f800d6e9f4ed	2026-04-28 05:29:40.547891+00	2026-05-05 05:29:40.629686+00	2026-04-28 05:29:40.547891+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
4bcc8785-a830-47b2-964f-bfe148656595	6cabe266-b2f4-43f9-879c-06020c789a0b	83d106240b052ad4c89535714b27c803b0a008b14b45eb40a896a431fac4fba7	2026-04-28 05:32:57.118595+00	2026-05-05 05:32:57.132392+00	2026-04-28 05:32:57.118595+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
927b948c-abe0-4dcd-a6f1-1e5430cd1990	6cabe266-b2f4-43f9-879c-06020c789a0b	c1c9935c26a8fe30eeb6426bbd9129f0aea0c9a46c97ad1438ff65203b234e67	2026-04-28 05:29:01.223093+00	2026-05-05 05:29:01.359603+00	2026-04-28 05:29:01.223093+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a54e2cfc-828e-4042-9531-6be1874a9838	6cabe266-b2f4-43f9-879c-06020c789a0b	03610387666eca1bddc0d03747de8955a9b4dcfba85dccc181a674df2bb92af3	2026-04-28 05:29:04.382111+00	2026-05-05 05:29:04.505792+00	2026-04-28 05:29:04.382111+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
46a26bc3-11f1-41f4-b00a-0cb161b20ff8	6cabe266-b2f4-43f9-879c-06020c789a0b	c2ff6bead0413100af13569afb2ebd0f22c7b9cce7f927a2925fc233a9b1803a	2026-04-28 06:05:41.585839+00	2026-05-05 06:05:41.599943+00	2026-04-28 06:05:41.585839+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0c1294e5-c7d3-4d79-bc20-f2a6b9b8a62a	6cabe266-b2f4-43f9-879c-06020c789a0b	55369552d944dc421f8d7b2b994ab867cf7b27ca227b462885f9f04a147a6727	2026-04-28 05:29:12.577451+00	2026-05-05 05:29:12.70733+00	2026-04-28 05:29:12.577451+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
53b43a88-09ae-43b4-894b-ea4e73deafd6	6cabe266-b2f4-43f9-879c-06020c789a0b	aa54f0b2f5b645778bd0ebca42880956a1401ade6fc15a52afbad60d3e4fd368	2026-04-28 06:09:30.565648+00	2026-05-05 06:09:30.580034+00	2026-04-28 06:09:30.565648+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
cf73453a-1fcc-4ecf-b0d5-d1459d5321fa	6cabe266-b2f4-43f9-879c-06020c789a0b	ecfbeb6eefbde02c180e5a233b2d108a43364b4219a58f80d97f6dbb8af1792e	2026-04-28 05:29:40.547897+00	2026-05-05 05:29:40.58556+00	2026-04-28 05:29:40.547897+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
51a1021e-cc8e-4dbd-828c-40b265ca161e	6cabe266-b2f4-43f9-879c-06020c789a0b	b813739c1c5e2748619bba630ed9c585f19510b3c07df8b74063c4985c9e7e9b	2026-04-28 05:29:25.349102+00	2026-05-05 05:29:25.478714+00	2026-04-28 05:29:25.349102+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6703a489-e488-4a18-ba4d-ffb966ca40ce	6cabe266-b2f4-43f9-879c-06020c789a0b	eefa7cfc0ef6b0de1edd8f0ede35882313567fca26be0f1d2cf46fb3daab936e	2026-04-28 05:29:40.531675+00	2026-05-05 05:29:40.682567+00	2026-04-28 05:29:40.531675+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1d4ffcde-f8df-4d40-8e16-29f4431aed39	6cabe266-b2f4-43f9-879c-06020c789a0b	dde65ad7a863df3b1daaac85e6f05dfc3d387651dfd947f45f400233118859e3	2026-04-28 06:10:12.486054+00	2026-05-05 06:10:12.512807+00	2026-04-28 06:10:12.486054+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9c11771b-860c-4351-9ba8-d93961d629a4	6cabe266-b2f4-43f9-879c-06020c789a0b	bf6b58ab6f99519953ac156355da93467b43182dd0bf04bee154da922dbdacbb	2026-04-28 06:03:06.962594+00	2026-05-05 06:03:07.003386+00	2026-04-28 06:03:06.962594+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
749b1be8-4dc0-4d38-bddf-12e414af7302	6cabe266-b2f4-43f9-879c-06020c789a0b	4ae617317503853fbe6ee864efd82e5595b8b153e9b02f7744dee9f3188316c3	2026-04-28 06:02:32.280623+00	2026-05-05 06:02:32.29512+00	2026-04-28 06:02:32.280623+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
3642cbfc-630d-4efe-8e41-1a39f3f60352	6cabe266-b2f4-43f9-879c-06020c789a0b	7fe97badafa4dcbfebfaf1bf7e3008888c4698c62f710c4af8b55574af25be65	2026-04-28 06:03:07.004746+00	2026-05-05 06:03:07.07408+00	2026-04-28 06:03:07.004746+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
44a33d18-25f6-4f13-a2e6-eec9d335f6d1	6cabe266-b2f4-43f9-879c-06020c789a0b	2d5c9ec8879a1993c2fbfe22cad1d8b8af12d1954c94eb8ef064cf1a5675787f	2026-04-28 06:04:53.339226+00	2026-05-05 06:04:53.373293+00	2026-04-28 06:04:53.339226+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
45fc3ba8-e18c-49f3-bc6c-a67b803b5ccc	6cabe266-b2f4-43f9-879c-06020c789a0b	d42fdba77417b88853c61044c55be27f79c569a41f4924ba2c2a44e411ea4e23	2026-04-28 06:05:04.888187+00	2026-05-05 06:05:04.903961+00	2026-04-28 06:05:04.888187+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
306f763c-d3f6-456e-b80a-08ee87467322	6cabe266-b2f4-43f9-879c-06020c789a0b	c7628add66bda3e7376374fc365f2b814c6c82d8d41c533aa4cf72fd3d8c4de6	2026-04-28 06:40:40.243671+00	2026-05-05 06:40:40.448026+00	2026-04-28 06:40:40.243671+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
31a1a6c3-5989-471b-8543-025dc1ede075	6cabe266-b2f4-43f9-879c-06020c789a0b	68986ffec0a6bfd0e33d9595f13878dc25fc477220d8edeb83077e3fb341d637	2026-04-28 06:40:31.184051+00	2026-05-05 06:40:31.221914+00	2026-04-28 06:40:31.184051+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
8351dd99-d96b-4c9e-bf8e-e46584aa1424	6cabe266-b2f4-43f9-879c-06020c789a0b	6d7b448141197d4e3596dfdec03c22bdf04b0d2014dca13c9f23e8b7a432d139	2026-04-28 06:38:01.313751+00	2026-05-05 06:38:01.349531+00	2026-04-28 06:38:01.313751+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d3a308bb-0cac-46c8-8c33-914b7ebadbec	6cabe266-b2f4-43f9-879c-06020c789a0b	8590ae511ab5f1a840e0202673aac4298bf635bb0dfd0e06e90e4dbfefe9e181	2026-04-28 06:40:40.23073+00	2026-05-05 06:40:40.389058+00	2026-04-28 06:40:40.23073+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
c986c9bb-5595-4729-bc04-38c56aa150d4	6cabe266-b2f4-43f9-879c-06020c789a0b	53ceb8433936dbc96691a3cc4a56fb6db47a030ca1c62786386546c0eccd3141	2026-04-28 06:40:31.22377+00	2026-05-05 06:40:31.290479+00	2026-04-28 06:40:31.22377+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
04a6e84c-54e2-4b6d-bc19-f4f593f25fd9	6cabe266-b2f4-43f9-879c-06020c789a0b	abab92bb29df763c27fc9a60caa09ded5e4aa04cfff6c9a1b6cd9e887fbcc589	2026-04-28 06:46:48.445722+00	2026-05-05 06:46:48.458985+00	2026-04-28 06:46:48.445722+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b30ca361-e0f7-44b7-bb34-5150befd4d50	6cabe266-b2f4-43f9-879c-06020c789a0b	7cac6a7b49a8a812234a387ff6bb99af5012be307b73e1834a2c839ce08386c8	2026-04-28 06:53:16.857225+00	2026-05-05 06:53:16.87116+00	2026-04-28 06:53:16.857225+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c225b5d9-c171-47ca-9e1c-a47b3371f281	6cabe266-b2f4-43f9-879c-06020c789a0b	38588e7a28a7ce8af24df71b7d1969254175cb2d0896186f94f922843106bbe0	2026-04-28 06:53:45.674132+00	2026-05-05 06:53:45.688989+00	2026-04-28 06:53:45.674132+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b6d8bd50-690f-422f-abe5-6ba4214378db	6cabe266-b2f4-43f9-879c-06020c789a0b	c591a7283eeb0b579b9005da46067a068b504428b06c6dce8e0ffe057751c757	2026-04-28 06:55:31.030527+00	2026-05-05 06:55:31.043086+00	2026-04-28 06:55:31.030527+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4d3b28c8-2f47-4095-916d-7741a3c1c85f	6cabe266-b2f4-43f9-879c-06020c789a0b	49bc60bf695470ebfa378fde43b7aa491cbfda11491afe5502fafef2d321e721	2026-04-28 06:57:23.086247+00	2026-05-05 06:57:23.102501+00	2026-04-28 06:57:23.086247+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ffba0264-bdf4-4435-a781-5d99aaaca35c	6cabe266-b2f4-43f9-879c-06020c789a0b	561f3673baccb0ea76181a5068a56d8ab115c6ef78e26d8111905f96bb7139ee	2026-04-28 06:58:31.570012+00	2026-05-05 06:58:31.597764+00	2026-04-28 06:58:31.570012+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
aa5138a7-edde-49b6-b1d8-92ecb894b8b1	6cabe266-b2f4-43f9-879c-06020c789a0b	c2cca0947fa524cc38b2e071a927b6d893e6b488ff8d3bbbacccb1e3ce5b8af8	2026-04-28 07:00:34.043873+00	2026-05-05 07:00:34.057934+00	2026-04-28 07:00:34.043873+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ed2e8465-0151-4b36-8e87-a97d91d22a9b	6cabe266-b2f4-43f9-879c-06020c789a0b	29b3d1670f20448543356dcd72bb1bbbcaa53578a3455ab8144cd11733bb2abb	2026-04-28 07:17:17.605414+00	2026-05-05 07:17:17.727833+00	2026-04-28 07:17:17.605414+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f4767ffe-d924-48f8-a8b3-b097522128ea	6cabe266-b2f4-43f9-879c-06020c789a0b	b4dc788c376a38e395e402b044cbe5123575700dd887ff0aee51ed3adc475d5f	2026-04-28 07:17:24.428345+00	2026-05-05 07:17:24.518918+00	2026-04-28 07:17:24.428345+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c1a16fae-7d47-4124-b60a-4ba6bcf613a2	6cabe266-b2f4-43f9-879c-06020c789a0b	840dc45ec23afd7e9f38736dff53242637bb843118cdfa4197dabe75730686da	2026-04-28 07:17:49.510045+00	2026-05-05 07:17:49.551582+00	2026-04-28 07:17:49.510045+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
58753d70-bea3-4650-b7a3-3bff1adfb512	6cabe266-b2f4-43f9-879c-06020c789a0b	68f331ed2e61fe0482dd12094c8ffbfa1fc3012faee1b3e0a94dd845ae73e38b	2026-04-28 07:17:54.837937+00	2026-05-05 07:17:54.869927+00	2026-04-28 07:17:54.837937+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
126a1d3f-08c0-4d10-a9ec-0e4f3b534752	6cabe266-b2f4-43f9-879c-06020c789a0b	42ef9915962b867dcc6c8922f643f80812fd27e38954f2b9fbba0c173d04547f	2026-04-28 07:17:55.891352+00	2026-05-05 07:17:55.927747+00	2026-04-28 07:17:55.891352+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d51283e6-866f-48c1-a6d4-2e8562243223	6cabe266-b2f4-43f9-879c-06020c789a0b	79f839ccd6f0e77f9f248337453d67bd075bc21fce58a051ba18686d4b0e0628	2026-04-28 07:20:45.785388+00	2026-05-05 07:20:45.805474+00	2026-04-28 07:20:45.785388+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
249fb15a-cd4d-4ddd-ac5c-dc153df08861	6cabe266-b2f4-43f9-879c-06020c789a0b	6f8f61fcac96135d6e39126f4bb4de7a6a65840f8595298001e67073527570ea	2026-04-28 07:25:24.521285+00	2026-05-05 07:25:24.56146+00	2026-04-28 07:25:24.521285+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
387ae493-745a-4860-a349-74b03c980864	6cabe266-b2f4-43f9-879c-06020c789a0b	6ca52e4371e7ad3b7ef323ae8ffd4327c88921947c08096db3bf9055e76cad1e	2026-04-28 07:32:21.997489+00	2026-05-05 07:32:22.010492+00	2026-04-28 07:32:21.997489+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
085a9e01-e9cd-4a3a-859d-3cf0dbb4a91e	6cabe266-b2f4-43f9-879c-06020c789a0b	f8f8c28da535a4c986a2460218ab65191bf6538365d4e8c1e18a26f8090386b0	2026-04-28 07:38:14.593615+00	2026-05-05 07:38:14.697233+00	2026-04-28 07:38:14.593615+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
3b50d047-a2e4-4735-93e5-d549c30b0093	6cabe266-b2f4-43f9-879c-06020c789a0b	430ff6d406a226947f66a75560c5ad3ea3d54e844b2b3848a7965c917ba242be	2026-04-28 07:55:00.032477+00	2026-05-05 07:55:00.130902+00	2026-04-28 07:55:00.032477+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
46f0e2d8-718e-4325-881b-8a3fda78046f	6cabe266-b2f4-43f9-879c-06020c789a0b	c8ee1f14dc2b6a7501e0204b05fd9d4383ef0f7fe6c77a9bb608254726fcf202	2026-04-28 08:21:13.927813+00	2026-05-05 08:21:13.954992+00	2026-04-28 08:21:13.927813+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
043dbad1-bba5-4f87-bd5e-5170e4b8f791	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	6b619ead55c572fc83bd24a08b45ed503c727c44d32bc21cb3343d7592da9db1	2026-04-28 08:31:06.885973+00	2026-05-05 08:31:06.869299+00	2026-04-28 08:31:06.885973+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
07567e4f-f084-4c67-86f7-ce9d9eafc003	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	33d0b102da8cbd72c87739aac0dda3e72d0376e79205e11d6225fbdab08d5dfb	2026-04-28 08:39:32.396462+00	2026-05-05 08:39:32.519291+00	2026-04-28 08:39:32.396462+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5fe6d56b-2861-419a-9407-cc700a2d6197	6cabe266-b2f4-43f9-879c-06020c789a0b	2f2696d2eceeeefb9528b45b7d5afce3f67a73a279e4840e8b62eebd03f3854e	2026-04-28 08:40:06.400917+00	2026-05-05 08:40:06.382715+00	2026-04-28 08:40:06.400917+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
947ed630-1ce1-4b70-af1d-bc36d5f229d0	6cabe266-b2f4-43f9-879c-06020c789a0b	bf4a8266866c825f1bf38dbe59785e339c2bb9db31da70873084403b34ca3622	2026-04-28 08:42:07.300661+00	2026-05-05 08:42:07.284559+00	2026-04-28 08:42:07.300661+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
956b5248-a785-45ab-be75-46a4025d0565	6cabe266-b2f4-43f9-879c-06020c789a0b	6167775a3d0ccd6bd471f5df2ed6c752a9adde6a6c9482a4f894fdbd76c38c0e	2026-04-28 08:49:16.040131+00	2026-05-05 08:49:16.064841+00	2026-04-28 08:49:16.040131+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ef35169f-a496-48ee-892f-80c79ac76289	6cabe266-b2f4-43f9-879c-06020c789a0b	12cd74732d25dded1c48c8817512b938958d8c98dcce17b33d4dce3e7181260f	2026-04-28 09:07:22.645378+00	2026-05-05 09:07:22.671965+00	2026-04-28 09:07:22.645378+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
04c5d713-aca1-45ce-a93f-d08353430429	6cabe266-b2f4-43f9-879c-06020c789a0b	e6af9d636e4de73f504b6859146f11ded96cced8617025189dfa0774d3e5597b	2026-04-28 09:10:51.259069+00	2026-05-05 09:10:51.277378+00	2026-04-28 09:10:51.259069+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2bea0922-0615-4cc7-acc6-f8fd3dbd612d	6cabe266-b2f4-43f9-879c-06020c789a0b	4572ac086bef02780a5fa88c238c2aef7c2f5c98d8b51753275156f248229527	2026-04-28 09:30:02.21939+00	2026-05-05 09:30:02.202384+00	2026-04-28 09:30:02.21939+00	::1	curl/8.7.1	f
4f3e03e3-1312-496a-b2f6-536a031584c2	6cabe266-b2f4-43f9-879c-06020c789a0b	ae8f7a76e4b8cc7428f920d57501ee91468fbc2548e89f60d737f16d4394f692	2026-04-28 09:30:09.158799+00	2026-05-05 09:30:09.141689+00	2026-04-28 09:30:09.158799+00	::1	curl/8.7.1	f
bfe3b538-5ab2-4b92-b8e1-5dd97b9ee1db	6cabe266-b2f4-43f9-879c-06020c789a0b	508505eef85d788a043f17baf8cfeff3aa93d9cc8145913fa185e018e461c67e	2026-04-28 09:13:17.687643+00	2026-05-05 09:13:17.724866+00	2026-04-28 09:13:17.687643+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
aae5161a-aed5-4206-92ab-c67e604c7864	6cabe266-b2f4-43f9-879c-06020c789a0b	6417a3c3f647366b908d72fc18cbc47f309682aa1f94acb0763bc5ac2d3d6bd8	2026-04-28 09:31:55.970164+00	2026-05-05 09:31:55.939929+00	2026-04-28 09:31:55.970164+00	::1	curl/8.7.1	f
07d1ae3f-ad4f-4c59-9cbd-42710be3abd9	6cabe266-b2f4-43f9-879c-06020c789a0b	d9485159dba2d33771add8f4a59314a027d492ce247528e60df970b018e8710f	2026-04-28 09:31:29.81472+00	2026-05-05 09:31:29.831847+00	2026-04-28 09:31:29.81472+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
80b17180-b203-4fae-854b-9b41683de1de	6cabe266-b2f4-43f9-879c-06020c789a0b	15920718b35c426dc985c13f23346e8f8543be75ba4381fce3e651c940888f04	2026-04-28 09:42:09.013864+00	2026-05-05 09:42:09.040058+00	2026-04-28 09:42:09.013864+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9df2a265-6ea3-431d-b55c-766ca13b71d4	6cabe266-b2f4-43f9-879c-06020c789a0b	255623abfd77ca0cfb9e7f2f08653e2c2cf35c3015e73b88b910fd21ea9535ef	2026-04-28 10:22:53.457561+00	2026-05-05 10:22:53.484301+00	2026-04-28 10:22:53.457561+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
93b774a3-a34c-4faf-8adb-e3df1fb6d4b6	6cabe266-b2f4-43f9-879c-06020c789a0b	5eb311b33be67ba4ab2e6112947f5a59953b868b1ab5ceb0096040d648afb630	2026-04-28 11:38:08.159106+00	2026-05-05 11:38:08.191642+00	2026-04-28 11:38:08.159106+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
325dfd44-8510-4fcc-9f0f-0edfa13b6d7d	6cabe266-b2f4-43f9-879c-06020c789a0b	6db65b49838f87fa9d67ef5af173e155d5717c91167519779c40a1f7b51324b2	2026-04-28 11:47:59.822566+00	2026-05-05 11:47:59.849936+00	2026-04-28 11:47:59.822566+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
52523e69-857e-486a-ab77-e95b1f9f7af2	6cabe266-b2f4-43f9-879c-06020c789a0b	811ff02e4ca49510accfec5e255392301c71d3e0ec609bedc85bbd881cbaedb6	2026-04-28 15:52:47.90006+00	2026-05-05 15:52:47.935311+00	2026-04-28 15:52:47.90006+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
841829a0-c6b8-4079-a9e9-450a9acf6a42	6cabe266-b2f4-43f9-879c-06020c789a0b	1235bb539d3032919431d917ea716c7bd52c232733a39e4d077bdac9c0117096	2026-04-28 16:14:00.623918+00	2026-05-05 16:14:00.65528+00	2026-04-28 16:14:00.623918+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
8746c1f4-b55b-4060-89d7-2623589964f7	6cabe266-b2f4-43f9-879c-06020c789a0b	b785a1cf3fc5fa2158e11a2c5cc2367a4d98192ede7965bc53b136bba7e56b22	2026-04-28 16:18:13.38712+00	2026-05-05 16:18:13.418054+00	2026-04-28 16:18:13.38712+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bd0ed9c2-493b-4e42-9f15-d22c4cbd6352	6cabe266-b2f4-43f9-879c-06020c789a0b	35b9925f54d53e25e7f1bf8b9ab3f23b0429dfc0f09c5535bb2543f839e4a618	2026-04-28 23:43:38.618359+00	2026-05-05 23:43:38.648701+00	2026-04-28 23:43:38.618359+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bc89ff0e-34fe-4340-a436-e1882a6824bb	6cabe266-b2f4-43f9-879c-06020c789a0b	175dfed19f9344d3321adc44fcac7680242da3b2338a5d2784c0095a6052a88f	2026-04-28 23:46:13.858488+00	2026-05-05 23:46:13.870012+00	2026-04-28 23:46:13.858488+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a640795e-f919-4dc4-aecb-9c21fb433a14	6cabe266-b2f4-43f9-879c-06020c789a0b	702aa9ce6b97a4f2daf82ea6073db575f416f8252e8cddd2372375aa204e1d8e	2026-04-28 23:46:14.823339+00	2026-05-05 23:46:14.852721+00	2026-04-28 23:46:14.823339+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
45257f29-f9c7-42f3-bb23-8cd7303f3d58	6cabe266-b2f4-43f9-879c-06020c789a0b	706d560ecc3639a52c20e7a80bc78dbc11beddef4f911e6a330d9375f4742c0b	2026-04-28 23:46:21.115974+00	2026-05-05 23:46:21.142566+00	2026-04-28 23:46:21.115974+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
65615908-1b8f-494d-b6de-00da07bba232	6cabe266-b2f4-43f9-879c-06020c789a0b	93c10532cd7ca6f685820a28e9391621d25134121599819ace590a6fe15eab06	2026-04-28 23:46:24.799614+00	2026-05-05 23:46:24.825027+00	2026-04-28 23:46:24.799614+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b6924506-6325-4c23-b74b-5c2407596fe9	6cabe266-b2f4-43f9-879c-06020c789a0b	9c1ca5c5a915fdce9e4956b9c6f37a2c8834043902e2f38461e24cfbe1e9d2e6	2026-04-28 23:50:16.723556+00	2026-05-05 23:50:16.735264+00	2026-04-28 23:50:16.723556+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
fd34d56d-ca5d-4b77-9791-62c36f7d2b4f	6cabe266-b2f4-43f9-879c-06020c789a0b	a7c40f705311c6f25ebdce95c01f2239125dbae9e19d23b4671f31313aed4b7d	2026-04-28 23:50:21.546554+00	2026-05-05 23:50:21.559122+00	2026-04-28 23:50:21.546554+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
763f0ad1-7473-482d-9f71-f7286f210ac0	6cabe266-b2f4-43f9-879c-06020c789a0b	ca0339bc8f0c6f3c1b56dfdc91e5cbbdf27c86b321d162c7d62e9855af340f12	2026-04-28 23:55:09.211828+00	2026-05-05 23:55:09.222926+00	2026-04-28 23:55:09.211828+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
\.


--
-- Data for Name: subscription_artifacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_artifacts (id, subscription_id, source_library_id, source_library_version, artifact_key, enabled, config, archived_at, created_at, updated_at) FROM stdin;
0dae65ca-dbfa-4d50-8ad0-8899bb715c05	00000000-0000-0000-0000-000000000001	0069458c-b656-459f-b02d-20d6eb97b767	1	board	t	{"default_columns": ["draft", "active", "done"]}	\N	2026-04-28 08:40:32.588726+00	2026-04-28 08:40:32.588726+00
380d4ef4-dab9-4913-909c-c440494e2f0f	00000000-0000-0000-0000-000000000001	05989598-c837-46fa-9713-b714416e3a45	1	pi	f	{}	\N	2026-04-28 08:40:32.588726+00	2026-04-28 08:40:32.588726+00
d8108658-1b7a-4149-b1fe-00b015ba8033	00000000-0000-0000-0000-000000000001	e2bf24c0-6717-4cae-a7a7-cf8006d57274	1	sprint	f	{}	\N	2026-04-28 08:40:32.588726+00	2026-04-28 08:40:32.588726+00
\.


--
-- Data for Name: subscription_layers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_layers (id, subscription_id, source_library_id, source_library_version, name, tag, sort_order, parent_layer_id, icon, colour, description_md, help_md, allows_children, is_leaf, archived_at, created_at, updated_at) FROM stdin;
8e6fddb1-2631-4f37-9fb1-0cec658d20e9	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ab01	1	Portfolio Runway	PRW	50	\N	route	\N	Strategic horizon — multi-year programme of intent.	\N	t	f	\N	2026-04-28 08:40:31.493015+00	2026-04-28 08:40:31.493015+00
a0e7d15c-c70d-418a-9e38-8e4934dfb577	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ab05	1	Feature	FT	10	d8353daf-0e10-42cd-96ac-dfaf3024a6cf	star	\N	Adoptable user-facing change. The leaf of the portfolio stack.	\N	t	t	\N	2026-04-28 08:40:31.493015+00	2026-04-28 08:40:31.493015+00
d8353daf-0e10-42cd-96ac-dfaf3024a6cf	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ab04	1	Theme	TH	20	1f4e6ed5-8dff-4528-833e-70e2ce638f88	layers	\N	Release-sized scope: a coherent slice of work that ships together.	\N	t	f	\N	2026-04-28 08:40:31.493015+00	2026-04-28 08:40:31.493015+00
1f4e6ed5-8dff-4528-833e-70e2ce638f88	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ab03	1	Business Objective	BO	30	633ad047-b1fc-4c69-a2da-64de3d1ad2b3	target	\N	Measurable outcome the product is pursuing this period.	\N	t	f	\N	2026-04-28 08:40:31.493015+00	2026-04-28 08:40:31.493015+00
633ad047-b1fc-4c69-a2da-64de3d1ad2b3	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ab02	1	Product	PR	40	8e6fddb1-2631-4f37-9fb1-0cec658d20e9	package	\N	Long-lived value stream owned by a product team.	\N	t	f	\N	2026-04-28 08:40:31.493015+00	2026-04-28 08:40:31.493015+00
\.


--
-- Data for Name: subscription_portfolio_model_state; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_portfolio_model_state (id, subscription_id, adopted_model_id, adopted_by_user_id, adopted_at, status, archived_at, created_at, updated_at) FROM stdin;
9f54be2f-0487-4dab-bde2-1e21361db730	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000aa01	6cabe266-b2f4-43f9-879c-06020c789a0b	2026-04-28 08:40:32.927081+00	completed	\N	2026-04-28 08:40:31.474279+00	2026-04-28 08:40:32.927081+00
\.


--
-- Data for Name: subscription_sequence; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_sequence (subscription_id, scope, next_num, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_terminology; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_terminology (id, subscription_id, source_library_id, source_library_version, key, value, archived_at, created_at, updated_at) FROM stdin;
81c97f83-f507-4fb5-8252-c3c5eaa461c7	00000000-0000-0000-0000-000000000001	a26aaff5-6ff5-49f8-920b-027f13416d8f	1	portfolio.feature	Feature	\N	2026-04-28 08:40:32.690881+00	2026-04-28 08:40:32.690881+00
ec33e411-477b-4993-b182-a613a1d4df2a	00000000-0000-0000-0000-000000000001	f2161f12-1200-4cee-8736-e334cd15826c	1	portfolio.objective	Business Objective	\N	2026-04-28 08:40:32.690881+00	2026-04-28 08:40:32.690881+00
49b70ecf-0bd8-402d-9241-64caf7564044	00000000-0000-0000-0000-000000000001	008ab428-10d0-4748-aff3-cdb4e26bfe44	1	portfolio.product	Product	\N	2026-04-28 08:40:32.690881+00	2026-04-28 08:40:32.690881+00
6a25b47c-cb7c-4354-8293-5b6b762be9cd	00000000-0000-0000-0000-000000000001	bb65e293-2d1e-4dbe-a5a8-a9ee62e407a4	1	portfolio.runway	Portfolio Runway	\N	2026-04-28 08:40:32.690881+00	2026-04-28 08:40:32.690881+00
3047d7d3-5e71-464e-8663-296a5356e981	00000000-0000-0000-0000-000000000001	8a5072f9-0559-433b-91a7-2d72ad0ae247	1	portfolio.theme	Theme	\N	2026-04-28 08:40:32.690881+00	2026-04-28 08:40:32.690881+00
\.


--
-- Data for Name: subscription_workflow_transitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_workflow_transitions (id, subscription_id, source_library_id, source_library_version, from_state_id, to_state_id, archived_at, created_at, updated_at) FROM stdin;
b976574c-6595-443b-a19c-ae6d8a1c322d	00000000-0000-0000-0000-000000000001	9ac74c39-4446-4580-92f9-5edee8b76ac0	1	0f3bfe38-f892-4ebd-a28c-0dc83f9ec283	b1c4c376-e3fe-4c0e-9798-fdaafab8a2d9	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
38c69f65-b9f0-4d5e-aa51-688c878a6123	00000000-0000-0000-0000-000000000001	c16dac6f-8c35-4904-8a2f-5c47036602fa	1	b1c4c376-e3fe-4c0e-9798-fdaafab8a2d9	3f9e39db-9c89-4ab8-9537-dbd1ccc950df	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
7e70f159-fc28-4c53-b44c-e08486a1528f	00000000-0000-0000-0000-000000000001	8d5a46e2-dd92-43de-bf6a-9ca5e2859d24	1	435fb051-4946-4643-968b-d1d2091e00f8	ab3e0126-038e-48a8-ba36-46c4dafc8211	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
5f2d8e1a-35e0-4e94-85dd-484a7d511f96	00000000-0000-0000-0000-000000000001	6516a65f-900c-4b7a-97b4-2a891d3ba500	1	ab3e0126-038e-48a8-ba36-46c4dafc8211	7f7141f7-36b9-4afe-9d05-ced62c3ec7a8	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
ad241e88-8630-4b90-a8bd-43ee66010deb	00000000-0000-0000-0000-000000000001	5c5e7977-d98d-4d9b-9ad6-362d6662d538	1	0e34b59b-a5e2-4cb5-afef-99307efab60e	85123d89-cfde-41ea-b5e1-51f881c0acad	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
b8cca126-063b-4fc3-8dbe-d38424af5607	00000000-0000-0000-0000-000000000001	e34aeb73-aa8b-4b58-9a0b-748903235fff	1	85123d89-cfde-41ea-b5e1-51f881c0acad	1c60cd53-fc8d-4256-9582-84680738ce1f	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
3810807a-2034-4567-82c0-9143dcecf064	00000000-0000-0000-0000-000000000001	bd75648b-0ba1-4658-a049-60fa58a5fcd3	1	b490c338-0cbd-47b8-9b84-1be38f9f199f	430d52b4-d483-4da7-931b-d5d55209518a	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
9fd1a560-d6f2-4e89-b244-ec93ed147987	00000000-0000-0000-0000-000000000001	416a353d-f8e8-4b30-a395-399674836e77	1	430d52b4-d483-4da7-931b-d5d55209518a	e1c40da8-a9e4-4a64-9d8d-1814a08c26bd	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
79134a3d-d8ad-4f80-8a77-f3d702c90545	00000000-0000-0000-0000-000000000001	498d9c97-9f9a-4717-b421-594b4619b445	1	1c438564-8c23-47de-a0c0-3ddbcffc7e42	4f80a084-8ec1-4627-8c9b-3f275c2de513	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
9e9c0897-ad8f-45c4-af93-19ee77a61956	00000000-0000-0000-0000-000000000001	8c3d03d2-fa08-4e98-a7a8-9af2bfb01ce9	1	4f80a084-8ec1-4627-8c9b-3f275c2de513	db76a077-ea0c-477e-879d-9a9460bd2dee	\N	2026-04-28 08:40:32.28787+00	2026-04-28 08:40:32.28787+00
\.


--
-- Data for Name: subscription_workflows; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_workflows (id, subscription_id, source_library_id, source_library_version, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour, archived_at, created_at, updated_at) FROM stdin;
0f3bfe38-f892-4ebd-a28c-0dc83f9ec283	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac11	1	8e6fddb1-2631-4f37-9fb1-0cec658d20e9	draft	Draft	10	t	f	#94a3b8	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
b1c4c376-e3fe-4c0e-9798-fdaafab8a2d9	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac12	1	8e6fddb1-2631-4f37-9fb1-0cec658d20e9	active	Active	20	f	f	#3b82f6	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
3f9e39db-9c89-4ab8-9537-dbd1ccc950df	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac13	1	8e6fddb1-2631-4f37-9fb1-0cec658d20e9	done	Done	30	f	t	#10b981	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
435fb051-4946-4643-968b-d1d2091e00f8	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac21	1	633ad047-b1fc-4c69-a2da-64de3d1ad2b3	draft	Draft	10	t	f	#94a3b8	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
ab3e0126-038e-48a8-ba36-46c4dafc8211	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac22	1	633ad047-b1fc-4c69-a2da-64de3d1ad2b3	active	Active	20	f	f	#3b82f6	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
7f7141f7-36b9-4afe-9d05-ced62c3ec7a8	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac23	1	633ad047-b1fc-4c69-a2da-64de3d1ad2b3	done	Done	30	f	t	#10b981	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
0e34b59b-a5e2-4cb5-afef-99307efab60e	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac31	1	1f4e6ed5-8dff-4528-833e-70e2ce638f88	draft	Draft	10	t	f	#94a3b8	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
85123d89-cfde-41ea-b5e1-51f881c0acad	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac32	1	1f4e6ed5-8dff-4528-833e-70e2ce638f88	active	Active	20	f	f	#3b82f6	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
1c60cd53-fc8d-4256-9582-84680738ce1f	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac33	1	1f4e6ed5-8dff-4528-833e-70e2ce638f88	done	Done	30	f	t	#10b981	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
b490c338-0cbd-47b8-9b84-1be38f9f199f	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac41	1	d8353daf-0e10-42cd-96ac-dfaf3024a6cf	draft	Draft	10	t	f	#94a3b8	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
430d52b4-d483-4da7-931b-d5d55209518a	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac42	1	d8353daf-0e10-42cd-96ac-dfaf3024a6cf	active	Active	20	f	f	#3b82f6	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
e1c40da8-a9e4-4a64-9d8d-1814a08c26bd	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac43	1	d8353daf-0e10-42cd-96ac-dfaf3024a6cf	done	Done	30	f	t	#10b981	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
1c438564-8c23-47de-a0c0-3ddbcffc7e42	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac51	1	a0e7d15c-c70d-418a-9e38-8e4934dfb577	draft	Draft	10	t	f	#94a3b8	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
4f80a084-8ec1-4627-8c9b-3f275c2de513	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac52	1	a0e7d15c-c70d-418a-9e38-8e4934dfb577	active	Active	20	f	f	#3b82f6	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
db76a077-ea0c-477e-879d-9a9460bd2dee	00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-00000000ac53	1	a0e7d15c-c70d-418a-9e38-8e4934dfb577	done	Done	30	f	t	#10b981	\N	2026-04-28 08:40:31.874141+00	2026-04-28 08:40:31.874141+00
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscriptions (id, name, slug, is_active, created_at, updated_at, tier) FROM stdin;
00000000-0000-0000-0000-000000000001	MMFFDev	mmffdev	t	2026-04-27 10:56:53.904029+00	2026-04-27 10:56:53.904029+00	pro
\.


--
-- Data for Name: user_custom_page_views; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_custom_page_views (id, page_id, label, kind, "position", config, created_at, updated_at) FROM stdin;
8a989eb2-95db-4eb3-b0aa-34bdecc9faf3	19f62bcc-82c0-44b2-b878-388041ff7b5d	Timeline	timeline	0	{}	2026-04-28 08:47:42.924883+00	2026-04-28 08:47:42.924883+00
bd5ae9d3-5410-4e85-b819-766a8126bb36	0980b2ae-c2e0-44cd-be16-05f156ded545	Timeline	timeline	0	{}	2026-04-28 08:48:01.621157+00	2026-04-28 08:48:01.621157+00
bf1076de-73ca-4ffa-b922-554758bde892	df41f0d9-ed1d-43bf-8cbe-c36cfb789380	Timeline	timeline	0	{}	2026-04-28 08:48:06.354794+00	2026-04-28 08:48:06.354794+00
\.


--
-- Data for Name: user_custom_pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_custom_pages (id, user_id, subscription_id, label, icon, created_at, updated_at) FROM stdin;
19f62bcc-82c0-44b2-b878-388041ff7b5d	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	Megans Test Page 001	folder	2026-04-28 08:47:42.924883+00	2026-04-28 08:47:42.924883+00
0980b2ae-c2e0-44cd-be16-05f156ded545	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	Megans Test Page 002	folder	2026-04-28 08:48:01.621157+00	2026-04-28 08:48:01.621157+00
df41f0d9-ed1d-43bf-8cbe-c36cfb789380	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	Megans Test Page 003	folder	2026-04-28 08:48:06.354794+00	2026-04-28 08:48:06.354794+00
\.


--
-- Data for Name: user_nav_groups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_nav_groups (id, user_id, label, "position", created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_nav_prefs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_nav_prefs (id, user_id, subscription_id, profile_id, item_key, "position", is_start_page, created_at, updated_at, parent_item_key, group_id, icon_override) FROM stdin;
1fb0b667-7ffb-41df-8732-b86dcaef0bb4	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	library-releases	0	f	2026-04-27 10:57:00.944917+00	2026-04-27 10:57:04.352689+00	\N	\N	\N
fc061ac7-f9b4-449c-bb5a-7042354c26ed	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	backlog	1	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
2c59c7ab-34da-40ce-93fc-7504a3a508c6	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	dashboard	2	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
93b72793-c9a6-43da-8825-444118043608	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	risk	3	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
5df3bde7-a8e4-4014-a0ab-cabb10d1421f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	workspace-settings	4	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
b0f0592e-8fec-498a-9bd2-26e76f8894d7	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	my-vista	5	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
01282150-534a-4d09-b729-4d19bc1e86b4	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	planning	6	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
9aaba60a-c070-4e98-89e9-a41a2f75800b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	portfolio-settings	7	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
f82bbb6a-9721-41af-bf4d-0becace678d0	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	favourites	8	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
bb802c30-c5b0-4c70-ae46-3bc64a35bcfa	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	portfolio	9	f	2026-04-28 02:44:32.877903+00	2026-04-28 02:44:32.877903+00	\N	\N	\N
fa8c66fc-4baf-4726-a14b-72af44b838a4	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	portfolio-model	0	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
b613de56-de71-403d-a806-b6779abd14d0	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	portfolio-settings	1	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
b27dfa50-8641-4849-8638-25dcd235bc25	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	backlog	2	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
e78001b2-1c04-4e26-8c3c-e47b6a5ecad4	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	planning	3	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
4e54a37e-85fb-4328-8671-563b2fbf2604	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	portfolio	4	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
e4b0df16-91fa-4eeb-b147-fd0570ea441e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	dashboard	5	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
59e3f030-bfc0-42fc-add0-e3b34507237b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	theme	6	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
fdf70017-a581-40bf-a81c-cdee3aed1c7b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	my-vista	7	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
21a75c8e-ff1e-4b18-abff-bfa33f08e730	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	favourites	8	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
fa6b9de3-a570-44bc-aee2-eadc99cbbf38	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	custom:19f62bcc-82c0-44b2-b878-388041ff7b5d	9	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
635b1cdd-27cf-4e54-a42d-a6f8b8daf37e	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	custom:0980b2ae-c2e0-44cd-be16-05f156ded545	10	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
cc01ce14-d9aa-41cd-b2a8-43ae9a04c522	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	custom:df41f0d9-ed1d-43bf-8cbe-c36cfb789380	11	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
88a38bb6-c3c2-4588-84ba-0744f5d48ada	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	risk	12	f	2026-04-28 10:27:17.520273+00	2026-04-28 10:27:17.520273+00	\N	\N	\N
\.


--
-- Data for Name: user_nav_profile_groups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_nav_profile_groups (profile_id, group_id, "position", created_at) FROM stdin;
\.


--
-- Data for Name: user_nav_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_nav_profiles (id, user_id, subscription_id, label, "position", is_default, start_page_key, created_at, updated_at) FROM stdin;
bdba043f-5196-4c89-94fd-3bb7893e1bf1	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	Default	0	t	\N	2026-04-27 10:57:04.352689+00	2026-04-27 10:57:04.352689+00
7a3b1532-92c1-4bd8-af12-6d176cb5f238	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	Default	0	t	\N	2026-04-27 10:57:04.352689+00	2026-04-27 10:57:04.352689+00
77df245f-7b05-4d52-90d4-956bd23b1d4f	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	Themes	1	f	\N	2026-04-28 06:12:31.199335+00	2026-04-28 06:12:31.199335+00
4c0505f9-c9dd-47aa-b7d3-030d27d20c0f	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	Megans Group	2	f	\N	2026-04-28 08:48:47.439637+00	2026-04-28 08:48:47.439637+00
\.


--
-- Data for Name: user_workspace_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_workspace_permissions (id, user_id, workspace_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, subscription_id, email, password_hash, role, is_active, last_login, created_at, updated_at, auth_method, ldap_dn, force_password_change, password_changed_at, failed_login_count, locked_until, mfa_enrolled, mfa_secret, mfa_enrolled_at, mfa_recovery_codes, active_nav_profile_id, theme_pack) FROM stdin;
583b8276-092f-4645-8e79-367fdcb5c4b6	00000000-0000-0000-0000-000000000001	user@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	user	t	\N	2026-04-27 10:56:53.920205+00	2026-04-27 10:56:53.920205+00	local	\N	f	\N	0	\N	f	\N	\N	\N	\N	default
4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	gadmin@mmffdev.com	$2a$12$c5bqRYJr1TqLc5MN3cP2j.AnFofNIl/X00u3aDAFlMiSY/fv9TwBK	gadmin	t	2026-04-28 08:31:06.868256+00	2026-04-27 10:56:53.920205+00	2026-04-28 08:31:06.868256+00	local	\N	f	2026-04-28 02:44:27.437598+00	0	\N	f	\N	\N	\N	7a3b1532-92c1-4bd8-af12-6d176cb5f238	vector-mono
6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	padmin@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	padmin	t	2026-04-28 09:31:55.940123+00	2026-04-27 10:56:53.920205+00	2026-04-28 10:27:39.329812+00	local	\N	f	\N	0	\N	f	\N	\N	\N	bdba043f-5196-4c89-94fd-3bb7893e1bf1	coral-tide
\.


--
-- Data for Name: workspace; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workspace (id, subscription_id, company_roadmap_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: canonical_states canonical_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_states
    ADD CONSTRAINT canonical_states_pkey PRIMARY KEY (code);


--
-- Name: company_roadmap company_roadmap_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: company_roadmap company_roadmap_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_pkey PRIMARY KEY (id);


--
-- Name: company_roadmap company_roadmap_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_subscription_id_key UNIQUE (subscription_id);


--
-- Name: entity_stakeholders entity_stakeholders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_stakeholders
    ADD CONSTRAINT entity_stakeholders_pkey PRIMARY KEY (id);


--
-- Name: error_events error_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_events
    ADD CONSTRAINT error_events_pkey PRIMARY KEY (id);


--
-- Name: execution_item_types execution_item_types_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_item_types
    ADD CONSTRAINT execution_item_types_name_unique UNIQUE (subscription_id, name);


--
-- Name: execution_item_types execution_item_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_item_types
    ADD CONSTRAINT execution_item_types_pkey PRIMARY KEY (id);


--
-- Name: execution_item_types execution_item_types_tag_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_item_types
    ADD CONSTRAINT execution_item_types_tag_unique UNIQUE (subscription_id, tag);


--
-- Name: library_acknowledgements library_acknowledgements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_acknowledgements
    ADD CONSTRAINT library_acknowledgements_pkey PRIMARY KEY (subscription_id, release_id);


--
-- Name: page_entity_refs page_entity_refs_entity_kind_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_entity_refs
    ADD CONSTRAINT page_entity_refs_entity_kind_entity_id_key UNIQUE (entity_kind, entity_id);


--
-- Name: page_entity_refs page_entity_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_entity_refs
    ADD CONSTRAINT page_entity_refs_pkey PRIMARY KEY (page_id);


--
-- Name: page_roles page_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_roles
    ADD CONSTRAINT page_roles_pkey PRIMARY KEY (page_id, role);


--
-- Name: page_tags page_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_tags
    ADD CONSTRAINT page_tags_pkey PRIMARY KEY (tag_enum);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_token_hash_key UNIQUE (token_hash);


--
-- Name: pending_library_cleanup_jobs pending_library_cleanup_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_library_cleanup_jobs
    ADD CONSTRAINT pending_library_cleanup_jobs_pkey PRIMARY KEY (id);


--
-- Name: portfolio portfolio_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: portfolio portfolio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_pkey PRIMARY KEY (id);


--
-- Name: product product_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: product product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: entity_stakeholders stakeholder_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_stakeholders
    ADD CONSTRAINT stakeholder_unique UNIQUE (entity_kind, entity_id, user_id, role);


--
-- Name: subscription_artifacts subscription_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_artifacts
    ADD CONSTRAINT subscription_artifacts_pkey PRIMARY KEY (id);


--
-- Name: subscription_layers subscription_layers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_layers
    ADD CONSTRAINT subscription_layers_pkey PRIMARY KEY (id);


--
-- Name: subscription_portfolio_model_state subscription_portfolio_model_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_portfolio_model_state
    ADD CONSTRAINT subscription_portfolio_model_state_pkey PRIMARY KEY (id);


--
-- Name: subscription_sequence subscription_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_sequence
    ADD CONSTRAINT subscription_sequence_pkey PRIMARY KEY (subscription_id, scope);


--
-- Name: subscription_terminology subscription_terminology_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_terminology
    ADD CONSTRAINT subscription_terminology_pkey PRIMARY KEY (id);


--
-- Name: subscription_workflow_transitions subscription_workflow_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_workflow_transitions
    ADD CONSTRAINT subscription_workflow_transitions_pkey PRIMARY KEY (id);


--
-- Name: subscription_workflows subscription_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_workflows
    ADD CONSTRAINT subscription_workflows_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_slug_key UNIQUE (slug);


--
-- Name: user_custom_page_views user_custom_page_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_page_views
    ADD CONSTRAINT user_custom_page_views_pkey PRIMARY KEY (id);


--
-- Name: user_custom_page_views user_custom_page_views_unique_label; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_page_views
    ADD CONSTRAINT user_custom_page_views_unique_label UNIQUE (page_id, label);


--
-- Name: user_custom_page_views user_custom_page_views_unique_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_page_views
    ADD CONSTRAINT user_custom_page_views_unique_position UNIQUE (page_id, "position") DEFERRABLE INITIALLY DEFERRED;


--
-- Name: user_custom_pages user_custom_pages_label_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_pages
    ADD CONSTRAINT user_custom_pages_label_unique UNIQUE (user_id, subscription_id, label);


--
-- Name: user_custom_pages user_custom_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_pages
    ADD CONSTRAINT user_custom_pages_pkey PRIMARY KEY (id);


--
-- Name: user_nav_groups user_nav_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_groups
    ADD CONSTRAINT user_nav_groups_pkey PRIMARY KEY (id);


--
-- Name: user_nav_groups user_nav_groups_unique_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_groups
    ADD CONSTRAINT user_nav_groups_unique_position UNIQUE (user_id, "position") DEFERRABLE INITIALLY DEFERRED;


--
-- Name: user_nav_prefs user_nav_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_prefs
    ADD CONSTRAINT user_nav_prefs_pkey PRIMARY KEY (id);


--
-- Name: user_nav_prefs user_nav_prefs_unique_item; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_prefs
    ADD CONSTRAINT user_nav_prefs_unique_item UNIQUE (user_id, subscription_id, profile_id, item_key);


--
-- Name: user_nav_profile_groups user_nav_profile_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_profile_groups
    ADD CONSTRAINT user_nav_profile_groups_pkey PRIMARY KEY (profile_id, group_id);


--
-- Name: user_nav_profile_groups user_nav_profile_groups_unique_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_profile_groups
    ADD CONSTRAINT user_nav_profile_groups_unique_position UNIQUE (profile_id, "position") DEFERRABLE INITIALLY DEFERRED;


--
-- Name: user_nav_profiles user_nav_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_profiles
    ADD CONSTRAINT user_nav_profiles_pkey PRIMARY KEY (id);


--
-- Name: user_nav_profiles user_nav_profiles_unique_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_profiles
    ADD CONSTRAINT user_nav_profiles_unique_position UNIQUE (user_id, subscription_id, "position") DEFERRABLE INITIALLY DEFERRED;


--
-- Name: user_workspace_permissions user_project_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_permissions
    ADD CONSTRAINT user_project_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_workspace_permissions user_workspace_permissions_user_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_permissions
    ADD CONSTRAINT user_workspace_permissions_user_id_workspace_id_key UNIQUE (user_id, workspace_id);


--
-- Name: users users_email_subscription_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_subscription_unique UNIQUE (email, subscription_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace workspace_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: workspace workspace_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_log_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_action ON public.audit_log USING btree (action);


--
-- Name: idx_audit_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created ON public.audit_log USING btree (created_at);


--
-- Name: idx_audit_log_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_subscription_id ON public.audit_log USING btree (subscription_id);


--
-- Name: idx_audit_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_user_id ON public.audit_log USING btree (user_id);


--
-- Name: idx_error_events_subscription_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_events_subscription_code ON public.error_events USING btree (subscription_id, code, occurred_at DESC);


--
-- Name: idx_error_events_subscription_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_events_subscription_occurred ON public.error_events USING btree (subscription_id, occurred_at DESC);


--
-- Name: idx_execution_item_types_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_item_types_active ON public.execution_item_types USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_execution_item_types_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_item_types_subscription_id ON public.execution_item_types USING btree (subscription_id);


--
-- Name: idx_library_acks_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_acks_release ON public.library_acknowledgements USING btree (release_id);


--
-- Name: idx_library_acks_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_acks_subscription ON public.library_acknowledgements USING btree (subscription_id, acknowledged_at DESC);


--
-- Name: idx_page_entity_refs_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_entity_refs_lookup ON public.page_entity_refs USING btree (entity_kind, entity_id);


--
-- Name: idx_page_roles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_roles_role ON public.page_roles USING btree (role);


--
-- Name: idx_pages_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_creator ON public.pages USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: idx_pages_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_subscription ON public.pages USING btree (subscription_id) WHERE (subscription_id IS NOT NULL);


--
-- Name: idx_pages_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pages_tag ON public.pages USING btree (tag_enum);


--
-- Name: idx_password_resets_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_resets_expires_at ON public.password_resets USING btree (expires_at);


--
-- Name: idx_password_resets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_resets_user_id ON public.password_resets USING btree (user_id);


--
-- Name: idx_pending_library_cleanup_jobs_claimable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_library_cleanup_jobs_claimable ON public.pending_library_cleanup_jobs USING btree (visible_at) WHERE (status = 'pending'::text);


--
-- Name: idx_pending_library_cleanup_jobs_dead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_library_cleanup_jobs_dead ON public.pending_library_cleanup_jobs USING btree (subscription_id, updated_at DESC) WHERE (status = 'dead'::text);


--
-- Name: idx_portfolio_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_active ON public.portfolio USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_subscription_id ON public.portfolio USING btree (subscription_id);


--
-- Name: idx_portfolio_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_workspace_id ON public.portfolio USING btree (workspace_id);


--
-- Name: idx_product_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_active ON public.product USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_product_parent_portfolio_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_parent_portfolio_id ON public.product USING btree (parent_portfolio_id);


--
-- Name: idx_product_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_subscription_id ON public.product USING btree (subscription_id);


--
-- Name: idx_product_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_workspace_id ON public.product USING btree (workspace_id);


--
-- Name: idx_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at);


--
-- Name: idx_sessions_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_token_hash ON public.sessions USING btree (token_hash);


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);


--
-- Name: idx_stakeholders_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stakeholders_entity ON public.entity_stakeholders USING btree (entity_kind, entity_id);


--
-- Name: idx_stakeholders_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stakeholders_subscription_id ON public.entity_stakeholders USING btree (subscription_id);


--
-- Name: idx_stakeholders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stakeholders_user ON public.entity_stakeholders USING btree (user_id);


--
-- Name: idx_subscription_artifacts_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_artifacts_key_unique ON public.subscription_artifacts USING btree (subscription_id, artifact_key) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_artifacts_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_artifacts_source ON public.subscription_artifacts USING btree (subscription_id, source_library_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_artifacts_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_artifacts_subscription_id ON public.subscription_artifacts USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_layers_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_layers_name_unique ON public.subscription_layers USING btree (subscription_id, name) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_layers_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_layers_parent ON public.subscription_layers USING btree (parent_layer_id) WHERE ((parent_layer_id IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: idx_subscription_layers_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_layers_source ON public.subscription_layers USING btree (subscription_id, source_library_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_layers_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_layers_subscription_id ON public.subscription_layers USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_layers_tag_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_layers_tag_unique ON public.subscription_layers USING btree (subscription_id, tag) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_portfolio_model_state_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_portfolio_model_state_active_unique ON public.subscription_portfolio_model_state USING btree (subscription_id) WHERE ((archived_at IS NULL) AND (status <> ALL (ARRAY['failed'::text, 'rolled_back'::text])));


--
-- Name: idx_subscription_portfolio_model_state_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_portfolio_model_state_status ON public.subscription_portfolio_model_state USING btree (subscription_id, status) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_portfolio_model_state_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_portfolio_model_state_subscription_id ON public.subscription_portfolio_model_state USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_terminology_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_terminology_key_unique ON public.subscription_terminology USING btree (subscription_id, key) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_terminology_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_terminology_source ON public.subscription_terminology USING btree (subscription_id, source_library_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_terminology_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_terminology_subscription_id ON public.subscription_terminology USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_workflow_transitions_pair_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_workflow_transitions_pair_unique ON public.subscription_workflow_transitions USING btree (subscription_id, from_state_id, to_state_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_workflow_transitions_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_workflow_transitions_source ON public.subscription_workflow_transitions USING btree (subscription_id, source_library_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_workflow_transitions_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_workflow_transitions_subscription_id ON public.subscription_workflow_transitions USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_workflows_layer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_workflows_layer ON public.subscription_workflows USING btree (layer_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_workflows_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_workflows_source ON public.subscription_workflows USING btree (subscription_id, source_library_id) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_workflows_state_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_workflows_state_unique ON public.subscription_workflows USING btree (subscription_id, layer_id, state_key) WHERE (archived_at IS NULL);


--
-- Name: idx_subscription_workflows_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_workflows_subscription_id ON public.subscription_workflows USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_user_custom_page_views_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_custom_page_views_page ON public.user_custom_page_views USING btree (page_id, "position");


--
-- Name: idx_user_custom_pages_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_custom_pages_owner ON public.user_custom_pages USING btree (user_id, subscription_id);


--
-- Name: idx_user_nav_groups_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_nav_groups_user ON public.user_nav_groups USING btree (user_id, "position");


--
-- Name: idx_user_nav_prefs_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_nav_prefs_group ON public.user_nav_prefs USING btree (user_id, subscription_id, profile_id, group_id, "position") WHERE (group_id IS NOT NULL);


--
-- Name: idx_user_nav_prefs_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_nav_prefs_lookup ON public.user_nav_prefs USING btree (user_id, subscription_id, profile_id, "position");


--
-- Name: idx_user_nav_prefs_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_nav_prefs_parent ON public.user_nav_prefs USING btree (user_id, subscription_id, profile_id, parent_item_key, "position") WHERE (parent_item_key IS NOT NULL);


--
-- Name: idx_user_nav_profile_groups_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_nav_profile_groups_group ON public.user_nav_profile_groups USING btree (group_id);


--
-- Name: idx_user_nav_profile_groups_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_nav_profile_groups_profile ON public.user_nav_profile_groups USING btree (profile_id, "position");


--
-- Name: idx_user_nav_profiles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_nav_profiles_user ON public.user_nav_profiles USING btree (user_id, subscription_id, "position");


--
-- Name: idx_users_active_nav_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active_nav_profile ON public.users USING btree (active_nav_profile_id) WHERE (active_nav_profile_id IS NOT NULL);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_subscription_id ON public.users USING btree (subscription_id);


--
-- Name: idx_uwp_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uwp_user_id ON public.user_workspace_permissions USING btree (user_id);


--
-- Name: idx_uwp_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uwp_workspace_id ON public.user_workspace_permissions USING btree (workspace_id);


--
-- Name: idx_workspace_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_active ON public.workspace USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_workspace_company_roadmap_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_company_roadmap_id ON public.workspace USING btree (company_roadmap_id);


--
-- Name: idx_workspace_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_subscription_id ON public.workspace USING btree (subscription_id);


--
-- Name: pages_unique_key_shared_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pages_unique_key_shared_subscription ON public.pages USING btree (key_enum, subscription_id) WHERE ((created_by IS NULL) AND (subscription_id IS NOT NULL));


--
-- Name: pages_unique_key_system; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pages_unique_key_system ON public.pages USING btree (key_enum) WHERE ((created_by IS NULL) AND (subscription_id IS NULL));


--
-- Name: pages_unique_key_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pages_unique_key_user ON public.pages USING btree (key_enum, subscription_id, created_by) WHERE (created_by IS NOT NULL);


--
-- Name: uq_user_nav_groups_user_label_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_nav_groups_user_label_ci ON public.user_nav_groups USING btree (user_id, lower(label));


--
-- Name: uq_user_nav_profiles_default_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_nav_profiles_default_per_user ON public.user_nav_profiles USING btree (user_id, subscription_id) WHERE (is_default = true);


--
-- Name: uq_user_nav_profiles_label_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_nav_profiles_label_ci ON public.user_nav_profiles USING btree (user_id, subscription_id, lower(label));


--
-- Name: user_nav_prefs_one_start_page; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_nav_prefs_one_start_page ON public.user_nav_prefs USING btree (user_id, subscription_id, profile_id) WHERE (is_start_page = true);


--
-- Name: user_nav_prefs_unique_position_nested; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_nav_prefs_unique_position_nested ON public.user_nav_prefs USING btree (user_id, subscription_id, profile_id, parent_item_key, "position") WHERE (parent_item_key IS NOT NULL);


--
-- Name: user_nav_prefs_unique_position_top; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_nav_prefs_unique_position_top ON public.user_nav_prefs USING btree (user_id, subscription_id, profile_id, "position") WHERE (parent_item_key IS NULL);


--
-- Name: company_roadmap trg_company_roadmap_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_company_roadmap_updated_at BEFORE UPDATE ON public.company_roadmap FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: entity_stakeholders trg_entity_stakeholders_dispatch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_entity_stakeholders_dispatch BEFORE INSERT OR UPDATE OF entity_kind, entity_id, subscription_id ON public.entity_stakeholders FOR EACH ROW EXECUTE FUNCTION public.trg_entity_stakeholders_dispatch();


--
-- Name: error_events trg_error_events_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_error_events_no_delete BEFORE DELETE ON public.error_events FOR EACH ROW EXECUTE FUNCTION public.error_events_append_only();


--
-- Name: error_events trg_error_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_error_events_no_update BEFORE UPDATE ON public.error_events FOR EACH ROW EXECUTE FUNCTION public.error_events_append_only();


--
-- Name: execution_item_types trg_execution_item_types_lock_name; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_execution_item_types_lock_name BEFORE UPDATE ON public.execution_item_types FOR EACH ROW EXECUTE FUNCTION public.execution_item_types_lock_name();


--
-- Name: execution_item_types trg_execution_item_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_execution_item_types_updated_at BEFORE UPDATE ON public.execution_item_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: page_entity_refs trg_page_entity_refs_dispatch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_page_entity_refs_dispatch BEFORE INSERT OR UPDATE OF entity_kind, entity_id, page_id ON public.page_entity_refs FOR EACH ROW EXECUTE FUNCTION public.trg_page_entity_refs_dispatch();


--
-- Name: pages trg_pages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pending_library_cleanup_jobs trg_pending_library_cleanup_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pending_library_cleanup_jobs_updated_at BEFORE UPDATE ON public.pending_library_cleanup_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio trg_portfolio_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_updated_at BEFORE UPDATE ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product trg_product_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_updated_at BEFORE UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_artifacts trg_subscription_artifacts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscription_artifacts_updated_at BEFORE UPDATE ON public.subscription_artifacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_layers trg_subscription_layers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscription_layers_updated_at BEFORE UPDATE ON public.subscription_layers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_portfolio_model_state trg_subscription_portfolio_model_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscription_portfolio_model_state_updated_at BEFORE UPDATE ON public.subscription_portfolio_model_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_sequence trg_subscription_sequence_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscription_sequence_updated_at BEFORE UPDATE ON public.subscription_sequence FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_terminology trg_subscription_terminology_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscription_terminology_updated_at BEFORE UPDATE ON public.subscription_terminology FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_workflow_transitions trg_subscription_workflow_transitions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscription_workflow_transitions_updated_at BEFORE UPDATE ON public.subscription_workflow_transitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_workflows trg_subscription_workflows_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscription_workflows_updated_at BEFORE UPDATE ON public.subscription_workflows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions trg_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_custom_page_views trg_user_custom_page_views_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_custom_page_views_updated_at BEFORE UPDATE ON public.user_custom_page_views FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_custom_pages trg_user_custom_pages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_custom_pages_updated_at BEFORE UPDATE ON public.user_custom_pages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_nav_groups trg_user_nav_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_nav_groups_updated_at BEFORE UPDATE ON public.user_nav_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_nav_prefs trg_user_nav_prefs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_nav_prefs_updated_at BEFORE UPDATE ON public.user_nav_prefs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_nav_profiles trg_user_nav_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_nav_profiles_updated_at BEFORE UPDATE ON public.user_nav_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_workspace_permissions trg_uwp_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_uwp_updated_at BEFORE UPDATE ON public.user_workspace_permissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace trg_workspace_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspace_updated_at BEFORE UPDATE ON public.workspace FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_log audit_log_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: company_roadmap company_roadmap_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: company_roadmap company_roadmap_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: entity_stakeholders entity_stakeholders_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_stakeholders
    ADD CONSTRAINT entity_stakeholders_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: entity_stakeholders entity_stakeholders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_stakeholders
    ADD CONSTRAINT entity_stakeholders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: error_events error_events_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_events
    ADD CONSTRAINT error_events_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: error_events error_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_events
    ADD CONSTRAINT error_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: execution_item_types execution_item_types_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_item_types
    ADD CONSTRAINT execution_item_types_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: user_nav_prefs fk_user_nav_prefs_profile; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_prefs
    ADD CONSTRAINT fk_user_nav_prefs_profile FOREIGN KEY (profile_id) REFERENCES public.user_nav_profiles(id) ON DELETE CASCADE;


--
-- Name: library_acknowledgements library_acknowledgements_acknowledged_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_acknowledgements
    ADD CONSTRAINT library_acknowledgements_acknowledged_by_user_id_fkey FOREIGN KEY (acknowledged_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: library_acknowledgements library_acknowledgements_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_acknowledgements
    ADD CONSTRAINT library_acknowledgements_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: page_entity_refs page_entity_refs_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_entity_refs
    ADD CONSTRAINT page_entity_refs_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_roles page_roles_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_roles
    ADD CONSTRAINT page_roles_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: pages pages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pages pages_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: pages pages_tag_enum_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_tag_enum_fkey FOREIGN KEY (tag_enum) REFERENCES public.page_tags(tag_enum);


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pending_library_cleanup_jobs pending_library_cleanup_jobs_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_library_cleanup_jobs
    ADD CONSTRAINT pending_library_cleanup_jobs_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: portfolio portfolio_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: portfolio portfolio_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: portfolio portfolio_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: product product_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: product product_parent_portfolio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_parent_portfolio_id_fkey FOREIGN KEY (parent_portfolio_id) REFERENCES public.portfolio(id) ON DELETE RESTRICT;


--
-- Name: product product_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: product product_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscription_artifacts subscription_artifacts_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_artifacts
    ADD CONSTRAINT subscription_artifacts_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: subscription_layers subscription_layers_parent_layer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_layers
    ADD CONSTRAINT subscription_layers_parent_layer_id_fkey FOREIGN KEY (parent_layer_id) REFERENCES public.subscription_layers(id) ON DELETE RESTRICT;


--
-- Name: subscription_layers subscription_layers_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_layers
    ADD CONSTRAINT subscription_layers_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: subscription_portfolio_model_state subscription_portfolio_model_state_adopted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_portfolio_model_state
    ADD CONSTRAINT subscription_portfolio_model_state_adopted_by_user_id_fkey FOREIGN KEY (adopted_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: subscription_portfolio_model_state subscription_portfolio_model_state_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_portfolio_model_state
    ADD CONSTRAINT subscription_portfolio_model_state_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: subscription_sequence subscription_sequence_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_sequence
    ADD CONSTRAINT subscription_sequence_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: subscription_terminology subscription_terminology_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_terminology
    ADD CONSTRAINT subscription_terminology_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: subscription_workflow_transitions subscription_workflow_transitions_from_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_workflow_transitions
    ADD CONSTRAINT subscription_workflow_transitions_from_state_id_fkey FOREIGN KEY (from_state_id) REFERENCES public.subscription_workflows(id) ON DELETE CASCADE;


--
-- Name: subscription_workflow_transitions subscription_workflow_transitions_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_workflow_transitions
    ADD CONSTRAINT subscription_workflow_transitions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: subscription_workflow_transitions subscription_workflow_transitions_to_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_workflow_transitions
    ADD CONSTRAINT subscription_workflow_transitions_to_state_id_fkey FOREIGN KEY (to_state_id) REFERENCES public.subscription_workflows(id) ON DELETE CASCADE;


--
-- Name: subscription_workflows subscription_workflows_layer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_workflows
    ADD CONSTRAINT subscription_workflows_layer_id_fkey FOREIGN KEY (layer_id) REFERENCES public.subscription_layers(id) ON DELETE CASCADE;


--
-- Name: subscription_workflows subscription_workflows_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_workflows
    ADD CONSTRAINT subscription_workflows_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: user_custom_page_views user_custom_page_views_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_page_views
    ADD CONSTRAINT user_custom_page_views_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.user_custom_pages(id) ON DELETE CASCADE;


--
-- Name: user_custom_pages user_custom_pages_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_pages
    ADD CONSTRAINT user_custom_pages_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: user_custom_pages user_custom_pages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_pages
    ADD CONSTRAINT user_custom_pages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_nav_groups user_nav_groups_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_groups
    ADD CONSTRAINT user_nav_groups_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_nav_prefs user_nav_prefs_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_prefs
    ADD CONSTRAINT user_nav_prefs_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.user_nav_groups(id) ON DELETE SET NULL;


--
-- Name: user_nav_prefs user_nav_prefs_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_prefs
    ADD CONSTRAINT user_nav_prefs_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: user_nav_prefs user_nav_prefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_prefs
    ADD CONSTRAINT user_nav_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_nav_profile_groups user_nav_profile_groups_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_profile_groups
    ADD CONSTRAINT user_nav_profile_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.user_nav_groups(id) ON DELETE CASCADE;


--
-- Name: user_nav_profile_groups user_nav_profile_groups_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_profile_groups
    ADD CONSTRAINT user_nav_profile_groups_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.user_nav_profiles(id) ON DELETE CASCADE;


--
-- Name: user_nav_profiles user_nav_profiles_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_profiles
    ADD CONSTRAINT user_nav_profiles_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: user_nav_profiles user_nav_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_profiles
    ADD CONSTRAINT user_nav_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_workspace_permissions user_project_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_permissions
    ADD CONSTRAINT user_project_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_workspace_permissions user_project_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_permissions
    ADD CONSTRAINT user_project_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_workspace_permissions user_workspace_permissions_workspace_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_permissions
    ADD CONSTRAINT user_workspace_permissions_workspace_fk FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;


--
-- Name: users users_active_nav_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_active_nav_profile_id_fkey FOREIGN KEY (active_nav_profile_id) REFERENCES public.user_nav_profiles(id) ON DELETE SET NULL;


--
-- Name: users users_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: workspace workspace_company_roadmap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_company_roadmap_id_fkey FOREIGN KEY (company_roadmap_id) REFERENCES public.company_roadmap(id) ON DELETE RESTRICT;


--
-- Name: workspace workspace_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workspace workspace_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict UQjVPfGezuOhzLpkQUfvnEiAjgi2XjN8AyWYJJNparAOgMpyG1UsyT8cJAPGYEh

