--
-- PostgreSQL database dump
--

\restrict eJBgebJGQvy7fyy5vu5TpJJarhdgZB9kipcnhnvhSSrIxJDmxXQTc2vh7jym1Vb

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

    INSERT INTO subscription_sequence (subscription_id, scope, next_num)
        VALUES (p_subscription_id, 'portfolio', 1)
        ON CONFLICT (subscription_id, scope) DO NOTHING;

    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'company_roadmap', v_roadmap_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'workspace',       v_workspace_id, p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'product',         v_product_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;

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
    profile_id uuid,
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
9f1c209e-3f9b-413f-a64e-0a1118b20c67	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:46:45.122533+00
dfcf4b45-09b1-40dc-93c9-fccd19971a70	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:46:51.642286+00
f27becc8-f614-404c-a6ec-8fa5ee926944	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.password_change	\N	\N	\N	::1	2026-04-21 01:46:52.339283+00
32270191-87f9-4689-8c52-e8e50c9d8337	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:46:57.640995+00
5982740c-cf3f-40f1-8f1c-76fe9d210b5e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:47:55.943929+00
62c1f9cb-8b18-45af-8b2f-c3549a44feff	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:48:03.126609+00
59be35e0-3336-43c3-9c88-f4868a76a1ce	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:48:45.576057+00
d0dc9008-2b02-47f0-92ad-c6769fc94376	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:48:54.804463+00
69cedfaf-9c39-4213-8be5-1fb2e6e5575a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	user.created	user	d26800bb-63b7-4866-9531-d3acbf8570bc	{"role": "padmin", "email": "bob@mmffdev.com"}	::1	2026-04-21 01:48:55.156879+00
eac025ac-4092-4926-ab0d-8aca6778c9f5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:49:02.706853+00
c50ea0c8-f17a-4183-ae1c-cee0799308c1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	permission.granted	project	11111111-1111-1111-1111-111111111111	{"can_edit": true, "can_view": true, "can_admin": false, "target_user": "d26800bb-63b7-4866-9531-d3acbf8570bc"}	::1	2026-04-21 01:49:02.79117+00
f731e4cf-3318-4042-8cb4-9bb5f511fc26	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:55:42.896145+00
3e011970-b89f-4982-b28d-379c14b05f56	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-21 01:55:50.250003+00
89c478c2-5521-45fb-bd83-2be6a251795e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:55:52.744543+00
c7fa8ce5-79b8-4f63-9b6f-ad6da5ae2ce9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:56:49.75263+00
420c1008-ab04-42dd-b90c-8f76f014b525	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	user.created	user	31c74efc-432c-4d51-8da8-9e603bbd2778	{"role": "user", "email": "user@mmffdev.com"}	::1	2026-04-21 01:56:50.26262+00
3d135a22-40bc-41dc-9771-1b58bf6bf053	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 01:57:14.090806+00
16e5c10c-0746-4245-8108-a95ff7675a68	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.password_reset_completed	\N	\N	\N	::1	2026-04-21 01:57:45.930557+00
995809f7-af05-4b06-9a3e-338f5278ebf8	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:58:03.834352+00
d26405cd-c786-4039-8270-a5eb12a889ac	31c74efc-432c-4d51-8da8-9e603bbd2778	\N	auth.logout	\N	\N	\N	::1	2026-04-21 01:58:10.123051+00
7cf3ce62-1e3f-4c82-8395-a1b4b2112246	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 01:58:14.217979+00
9e5895b0-49fa-4212-b845-d77d1ed7eca6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-21 01:58:20.370733+00
30535c4c-f335-401d-bbc6-ffda79dd795f	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.password_reset_requested	\N	\N	\N	::1	2026-04-21 01:58:56.202977+00
682a903e-a573-48e4-893a-cf246d8e18ff	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.password_reset_requested	\N	\N	\N	::1	2026-04-21 01:58:56.329721+00
db48d0d6-6e1a-4669-8a12-0d89acaf773e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.password_reset_completed	\N	\N	\N	::1	2026-04-21 01:59:46.721965+00
f09c2102-6ece-45a6-b67f-4197fbb6753f	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 01:59:57.443646+00
232a7d67-c017-490d-9057-7682ce58dc99	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:00:12.20756+00
85f2c7a9-d16d-42b5-abde-cb8db5d7e27c	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:00:20.919435+00
cef99ed1-11d7-4112-99d3-de6bb7645781	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:01:10.92369+00
f42a6e8b-4512-4e26-a06a-fdfbb9bd34df	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:01:19.897341+00
85ee0a0c-7f80-429c-856c-0caa121218ce	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:05:22.320898+00
dd89bd93-b0c1-4d8f-b990-3088b9c4578c	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:11:23.032673+00
31f69f57-d407-442a-83cc-24cf5d9a352d	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:11:23.353036+00
d71d1ce1-e8f6-49a2-a94e-60c9559e6ca3	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.password_reset_requested	\N	\N	\N	::1	2026-04-21 02:11:37.958466+00
a36e8678-def6-49e0-8203-d2ca6cf709b3	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.password_reset_completed	\N	\N	\N	::1	2026-04-21 02:11:39.480188+00
b7828e9e-6124-45e6-a8e3-abc49683e140	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:11:39.845021+00
9e62af44-9cfd-464d-ad15-82e1edb51f77	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 02:12:13.831278+00
1017a08c-f845-4eb3-978e-ddae792b01f5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:12:22.590098+00
13ce2b6d-f0eb-4e13-8769-032dd646fb5c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:12:24.700627+00
ce29cd1d-9e76-4f57-8e8f-da34aff40517	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.password_reset_requested	\N	\N	\N	::1	2026-04-21 02:12:48.330182+00
56ca0cdc-7aa0-4d6f-841d-78a9a00fddb8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.password_reset_completed	\N	\N	\N	::1	2026-04-21 02:12:49.783706+00
2d29119a-7f6d-4652-a6a4-26341f19a4e6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:12:50.106104+00
e48c224f-6de8-46ff-9513-91df2a42c0d9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.refresh_token_reuse	\N	\N	{"session_id": "02376ee4-2df4-489c-91eb-1795d6f6a436"}	::1	2026-04-21 02:15:54.758875+00
aa63c8cf-1a00-4ba7-b4e9-04e0cb81c175	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:15:58.17836+00
8738a55f-495a-48a2-a5e0-52fde79ae2b3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-21 02:16:27.54877+00
51bd7c69-c496-4ec7-a7d2-2b9212dc5027	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:16:38.320076+00
b975178c-4e33-401d-a2c5-fc428e0118c6	\N	00000000-0000-0000-0000-000000000001	auth.password_reset_requested	\N	\N	\N	::1	2026-04-21 01:58:56.271742+00
b10d4156-68d5-4075-bebc-00c204dfe00a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.password_reset_requested	\N	\N	\N	::1	2026-04-21 02:18:28.456515+00
b55f5c47-2f94-421f-a3b6-f20e4306d27c	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.password_reset_completed	\N	\N	\N	::1	2026-04-21 02:18:29.884556+00
0fe99256-66c2-4c7a-83e4-c3a652c09424	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:18:30.204061+00
a1b8fdd0-bdac-456a-920d-f2c631d3b338	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:18:30.519785+00
d5850b26-3541-43de-978a-29de92534bbf	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:18:30.832508+00
f1f95fac-be51-4dfa-b2ba-91229a24afce	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:19:13.435799+00
184bf183-3234-4a84-8b71-3a3285d187e0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-21 02:19:19.474709+00
137d6cdb-a093-4a2a-b70c-e8a1bf215db2	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:19:32.141731+00
6eebfcb4-0d80-4ded-9ff4-c1e935b0a1f1	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-21 02:19:50.858751+00
10254a22-b9bc-4907-8927-f6b1e3f7809d	\N	\N	auth.login_failed	\N	\N	{"email": "admin@mmffdev.com", "reason": "no_user"}	::1	2026-04-21 02:20:47.334448+00
e6190764-ea06-4b55-97e0-cfe3606ad829	\N	\N	auth.login_failed	\N	\N	{"email": "admin@mmffdev.com", "reason": "no_user"}	::1	2026-04-21 02:21:10.754183+00
ce640bea-ac1d-4869-9734-e1e69183b0b7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-22 02:15:31.535025+00
b6234ff2-21ca-479f-afb6-49ddf45a400e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-22 02:15:36.223828+00
979ebb48-8634-4bb7-bcee-7a50cc0c9cd4	\N	\N	auth.login_failed	\N	\N	{"email": "admin@mmffdev.com", "reason": "no_user"}	::1	2026-04-21 02:21:33.940045+00
caeeffa9-1ed7-4012-987f-f03182b5b74f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:22:27.757601+00
0079623e-3c2d-4bad-ae57-1b4bd7df8bc2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:22:28.804146+00
ed34d705-3210-41f9-b587-04c69b06b5d6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-21 02:22:34.970375+00
699909d3-6010-424d-a843-071820519e2e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:22:37.63583+00
6a01b71e-4884-45fe-b355-a352cf348021	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:22:42.559914+00
e822188c-a42c-447c-880d-629b64830484	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-21 02:23:09.036528+00
7dbbc712-09d5-4d9d-980d-e95ac3356cb8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:23:11.720844+00
0cf602ed-41fc-4535-81ca-c964d24e2cd7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:23:53.198888+00
37c9c4ee-ea70-4fb5-9457-fa27ca581bd0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:24:01.419204+00
8f9592f5-521e-4f18-823e-a6175e9c1c2c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-21 02:24:05.44183+00
1ffac11b-c3be-47a1-a128-83f34cb02c8d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:24:24.12385+00
58aa1700-4faf-4651-9941-065be83c8d42	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:26:13.658644+00
07423aa9-2ebb-417c-b6ce-da6da9b6e224	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:26:13.976213+00
62412224-5265-4932-9d39-5e4a72a264a8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 02:57:18.53835+00
b4a1bca0-af9d-4285-a185-9d32208d33b3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 02:57:20.600504+00
f45610a1-db6a-4c15-8520-e63ea999cca7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 04:46:59.09352+00
5deaa778-2057-4e21-a680-a0e229b03bbc	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 04:47:20.852081+00
16340021-41f3-4c81-af26-996af55f30b5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 04:47:22.833687+00
1e058cd1-3407-4e4d-8471-432ab9998d01	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 04:48:27.070408+00
c1d93716-97b8-408c-9bc6-5c3d2d331a7e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 04:48:28.491131+00
a741a9e8-0177-4014-8eaa-526a9002cece	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:01:28.160539+00
c22375d3-9414-4adf-94b8-205602c5cc21	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:05:32.11305+00
5568a81a-fd62-4d5d-8a67-eb1dbb55b5a2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:08:04.5907+00
900e54cb-c7e9-4698-8763-5be58d757185	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:11:48.663408+00
90539b76-241d-4b1d-a5fc-4b6d3638ea3b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:12:00.206255+00
e3c4a1f2-f297-4c2d-baa8-b904049fcd15	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:19:06.14012+00
fdc58020-80a7-42cc-b868-1756f3e8d7e1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:22:57.703178+00
eb9e65b4-9fe6-4acf-882a-d109501b14a0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:23:00.553729+00
008d6ea7-9ee7-4009-bcf5-7b367ef51e25	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:26:06.678063+00
87572c3a-1c20-4c3c-a96a-3effd60f1828	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:26:10.203068+00
7452395d-eed8-41d5-97c7-42901326b016	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:32:51.159262+00
e367e33b-8ded-4d4d-8e63-338ce6afd40b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:32:54.477547+00
264e42af-7945-410e-a8c0-5d4ef1eab2a0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:33:34.016518+00
0d2b7b12-5fe5-43b7-a9be-16e9f9aef7e9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 06:41:12.672724+00
0aca2fb1-357e-4351-a8c0-643d748ab1ab	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 20:34:13.999997+00
7425c40c-e368-4a7c-b2c2-8f52a9239f95	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 20:38:56.268674+00
1bfc19b7-e959-46b8-8af9-49fc84dafe23	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 20:42:00.798015+00
06b57486-5372-4e04-95e0-0b1580db4335	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 20:42:02.39462+00
781b9b7e-7411-4baa-be85-6022e4c8a107	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.refresh_token_reuse	\N	\N	{"session_id": "23295587-b614-4237-be8b-c3268a6c9d86"}	::1	2026-04-21 20:42:03.25357+00
1e8b5f6f-69ec-4e2f-b904-9785d4112410	\N	\N	auth.login_failed	\N	\N	{"email": "cookra@me.com", "reason": "no_user"}	::1	2026-04-21 20:52:46.026544+00
48ce8496-ec4b-4586-a291-d2376f4d44b5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 22:37:23.870898+00
d5c65146-7b18-4238-9248-dc6c33694aa9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 22:38:04.511508+00
9fe750b1-f666-4c1f-8aba-c105ea245c63	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 22:50:02.230633+00
87afca19-d76d-43e1-a008-77d6fa14d20c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 22:56:20.033541+00
1e202493-4f7a-4f4e-856a-bfa22b8debe4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 22:56:26.219964+00
e59c7232-d4c6-47d8-a3d9-36ca285e4118	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:08:08.388199+00
9f21b8f5-87a7-4a5a-890f-47b06fbed93c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.refresh_token_reuse	\N	\N	{"session_id": "b0816bc8-21e4-4b9e-9fbd-c186c8a8c064"}	::1	2026-04-21 23:08:09.028896+00
c58d6415-7334-483c-bccd-e42f90817d4f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-21 23:08:18.22176+00
68bf6950-c0be-43fa-a7d5-a02f0d22d343	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:19:38.494609+00
55efefaf-6da5-41c2-9690-c15124b26d77	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:20:32.598726+00
98dd94bc-c566-41d8-9405-b1bec37a9489	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:28:12.637124+00
35ade3ce-512e-4327-9441-21291b686f2f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:33:58.809051+00
05186fe4-2b16-4855-b385-9b5f4d15a314	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:35:44.005144+00
0811f41b-8a93-47c1-99d3-05f2ff5a6a10	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:40:08.956038+00
e21aac89-2168-4767-ad70-02110778c765	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:42:59.430647+00
0761da78-3c46-4126-8d7b-efcf770a622a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:44:03.14312+00
61ee32a6-1c4b-4328-bb4a-764d0db2d726	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:45:48.280523+00
491f7b1a-357a-4343-a46d-7e949a23986b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-21 23:47:22.50266+00
c1c6d619-9ee5-47eb-af5f-b56f9dd598b5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 01:41:21.52563+00
87e64cef-119f-4070-b84b-b6b1fef4eb1b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-22 01:43:21.579322+00
c6996afb-50e0-4293-a0e8-36928105c121	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-22 02:01:44.522072+00
cf4dc893-74c7-40e5-b5d7-af53e76d885d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 02:26:28.868462+00
93c38e48-f41d-4c54-b5b4-9c6ad7eef298	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 02:28:44.311325+00
3bd03286-abf8-43db-8db6-8b4ac6ae47a2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 02:28:48.682693+00
f95b2223-c025-4272-a0d6-7b4e9b2a8307	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 03:24:56.026263+00
32b9e1a0-3363-4784-8aef-dae0324218ac	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 03:25:01.249524+00
a1e6ff5a-4dab-499c-938f-1af0a3b202ae	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 03:25:07.551038+00
5e6fec82-3c4a-43bc-969a-0675c585570d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 03:29:10.213363+00
c923eb6b-a0fc-4ce6-b696-fe087dd7d4a8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-22 03:32:05.748375+00
1b1130db-6704-4b0f-9ef0-a4c619d4b95d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-22 03:34:34.919478+00
cfb0b0c5-654f-4643-aac2-e85bd6b38f9c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 03:37:04.709749+00
cdce4c35-b218-4b2c-be01-a5759b76dabb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-22 03:41:48.410888+00
4f339e97-d20c-4d22-a972-a96284fd563d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-22 03:41:50.498918+00
f4e311d4-80c5-4497-ae66-4d79ce989bde	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 03:43:46.405207+00
03fec770-a89e-43ae-897a-474a054098e3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 03:43:50.377198+00
72159691-2902-4763-a81e-2af490462831	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-22 03:43:52.655301+00
2fa05d95-1250-4895-a20d-ed676bc1e66a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-22 03:43:54.436271+00
54c6d4da-f5ad-4e28-bd47-cc881e46817b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-22 03:44:10.5901+00
861bfbf4-3237-43d2-bed4-845f82938241	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-22 03:44:12.624607+00
7fbc9646-0ab6-446c-a387-ade73d0029ce	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:02:42.315812+00
9d7e9960-1007-4888-aef2-0a47a602b741	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:02:46.739187+00
61f3b80a-6c23-4eeb-863a-046aa42f434a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:02:49.82609+00
b4f9da75-cf22-445e-a6db-1ec4ed26bcd5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:02:52.555872+00
9721d148-cd11-4c23-9827-c036dd0b0645	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:03:54.20157+00
09dd2953-dff3-48ca-863f-1cdc06152601	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:11:49.644897+00
4558e31e-53b5-4c25-a121-01e39549c834	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:12:38.180649+00
349b124b-78a8-48ca-b4f2-f846b519bb19	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:14:38.830112+00
dbfd6454-0630-4f4c-ba41-f866245516a3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:15:29.425864+00
1071a487-723f-4448-9e5f-7c8e4d868a58	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:22:17.488997+00
a0739dac-671f-4b05-98ca-f601a25939c2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:23:13.700724+00
f3581678-e7d7-48fe-b61c-ba700904531e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:26:51.272497+00
57a5b023-4c9f-47c1-8fe6-2c55f85282c9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 04:38:32.836485+00
d6d9ef73-9f06-4ab3-a81b-36d4357eb501	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 22:40:25.995744+00
eef72469-b87e-4796-8139-662f68679c50	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 23:49:34.056045+00
888ca11e-adc2-42fb-a3c1-46d5168021a4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 23:49:39.615273+00
029e4c09-f51b-419c-997e-56ae59f1a531	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 23:49:45.179326+00
099b6f26-5a5b-41ec-b1ac-dd457f2d8ac6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 23:49:53.020119+00
41142e2e-e32c-4ff4-bb88-c4bc38027b60	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 23:49:58.540506+00
ccdaae9f-9fea-4973-b4bf-be66e9c59ac2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-22 23:50:20.930571+00
77c2d6b0-1dc0-4a81-9573-75a591c1c983	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-22 23:51:24.590373+00
8e18a94d-1884-4cde-9072-489cb868765e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-22 23:56:25.039276+00
c54db310-70b5-4f07-b3f5-7e8c8ea0b2d1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:04:41.531025+00
fdc8a7ec-ac7f-4b30-9609-686ebf6f9246	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:06:23.539139+00
aa7ab07b-7eae-49b1-859d-08d209f23d07	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:06:25.97609+00
a05f0704-04d8-41c1-a341-5c2ddd17102f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:08:26.479065+00
e6274ae4-4564-447c-bd07-280fe3890fbd	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:10:18.764955+00
f8363ed2-73df-4616-8be6-c4661cce33b3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:10:22.729937+00
798dbef7-2d64-4470-bd56-53a5438b33b2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:10:28.875322+00
ba858c9d-eb66-488f-86fc-dcb8e644aff7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:10:33.074304+00
e8ac0173-15ab-4cc5-b88d-d603ee41b347	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:15:20.652612+00
9ca9f831-d41a-493d-acb5-d222c846d222	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:15:28.615909+00
84c2efcd-2ccf-4edc-9180-1f57c3f222ab	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:15:30.812177+00
e5826781-71cd-4ca5-99fd-805bca346920	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:17:01.753773+00
78b86709-d723-4a53-8e51-6b544f13b8b8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:17:28.689881+00
5be8d76a-6d2d-4a7c-9b20-65d21b4f5401	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:21:21.275177+00
057f6b1b-0119-4677-8393-2ff0198d6ac5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:22:26.809892+00
084eecc4-6b05-4602-be0d-f56fd307939a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:22:28.443479+00
2bb1a911-fb28-4eeb-90d4-958113568e91	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:22:31.270698+00
6beb069e-2322-41c9-9929-9c0c8077d1fa	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-23 00:22:48.982842+00
4ed8f74a-3d6c-4d2d-841d-2b74ede17af2	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:22:51.477065+00
356fcde2-b57e-4e70-8380-c7a904f481af	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:23:04.957363+00
7fa769bc-875f-467d-91c8-54d7549bcf89	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:23:07.397186+00
42d65b43-c092-4ccf-8152-0ba81c665672	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:23:09.75841+00
3ddf8381-26ce-49a4-913e-4859a8707f9d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:23:14.164218+00
35f77110-35d7-4c51-ad62-175eac03775f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:23:29.771318+00
e19f83cb-8473-4c87-b6fb-cd9c620e79df	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:23:33.622204+00
787645cf-1c10-4d43-b26d-290bd8b9b46e	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:23:40.042717+00
2f8d5149-4dee-441c-bef2-68c02018f700	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:23:43.589845+00
5fe39e74-b5c0-4c21-a705-2acdc0c0b32a	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:24:12.557385+00
0daf60ca-9418-49ec-910f-a97fa2f51e80	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:25:24.023642+00
3087ce9e-3261-4e6a-acd8-6aabdd015761	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:25:25.904014+00
c7634c40-037c-473c-9c3a-d11883638e33	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:26:01.922143+00
374fbed3-70f4-4e67-b083-52438d33bfa2	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:26:03.614536+00
3c355026-cbe2-4bea-9364-25d0e5f2ae67	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:26:49.619578+00
03096222-0ea5-4611-8c5f-20124ed0af80	31c74efc-432c-4d51-8da8-9e603bbd2778	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:28:23.406945+00
cd424d2f-3e70-48c8-8f9f-ec815b52b131	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:28:27.021031+00
a937c4bf-3e2a-4b90-98cd-836fa97a2667	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:36:51.057902+00
13b8c24b-1858-4d51-b556-d370161f1bb2	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:36:55.25695+00
4a519c14-2ccf-4bc2-ab4b-415e4e91beea	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:24:14.80518+00
038e7e07-5e90-490f-9cef-8c8d748ff1be	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:24:32.366361+00
00e32c61-f3a4-4235-811f-1da103ba41e8	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:24:34.053672+00
ec20215a-d4e9-4c05-b581-08a260817aa7	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:24:50.753307+00
ee7b7d35-8f9c-4f83-b152-05805faf747a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:24:52.724247+00
b92d170f-4a00-4cab-a8be-27a22a04b16c	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:25:41.420492+00
54446e73-38d1-4834-bc6a-5fae5545b314	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:25:43.402865+00
05fbb4f2-870b-4617-881a-d8db8f4d67bf	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:27:18.976315+00
b2fe1d69-c9c0-400e-8f3a-bc635c6e7108	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:27:40.194499+00
2582800e-2e06-4647-8814-8d86055d035f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:28:31.073198+00
504e2c1c-5872-4a48-80ce-1b041188fd2a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:28:34.88456+00
20ad8ce0-ec93-492b-8f35-71c956d09bff	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:36:49.720989+00
b88daf02-64bd-499c-927d-daba8e96e34f	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:39:46.471135+00
2026c982-4ad7-4298-a914-c62e55db461d	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 00:39:50.721581+00
e375dad9-e34c-46cd-b4b1-8513e4534341	31c74efc-432c-4d51-8da8-9e603bbd2778	\N	auth.logout	\N	\N	\N	::1	2026-04-23 00:40:38.474654+00
4f981097-33a5-40a7-9379-9d6cd0a959e2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 00:40:43.398739+00
ecec1e87-9af6-4cf8-883f-e2584a493c4d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 01:41:59.54965+00
9dba8f32-21bb-4151-ba99-34e55df90ea4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 01:42:53.116573+00
25d09e6e-b6fe-4de5-b7dd-5e2fb006eaa4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:43:51.985498+00
df0725aa-5e1b-41c5-8d4f-9478685238e3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:45:21.323823+00
9d482413-5b14-428d-a43d-9587847570b0	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 01:46:02.173638+00
4958844b-245e-4489-be9f-48ec0cea845a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:46:41.957262+00
cee73db0-aca0-4746-ba32-4c603f4309bd	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:46:58.723697+00
fdbf4b56-9e4f-49cb-a1ed-980188a43fed	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:47:14.536726+00
eb1e0ede-51ba-44d8-aff3-462b607c3295	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 01:47:27.802996+00
e807de4d-de19-43f9-832c-9f0c4f2e6414	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:48:10.891934+00
72d0056e-86af-4ae9-a8d9-292a1547755f	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:48:30.530217+00
466268d9-d733-4103-bacd-83e89e4e2176	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:49:13.526445+00
4fcdf589-ef05-4ae0-9226-bc070a9651d8	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:50:09.881812+00
7a6e1f96-ae4b-4bb0-a8b0-fe02e7462047	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 01:50:36.484714+00
66daf96d-9758-4456-98ab-b9e40352f370	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:50:42.37375+00
5a44fe2c-1980-4218-b591-b7169cce838b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:51:11.244219+00
f95ebf7f-2095-4b90-9d2d-091a896465c3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	user.created	user	33fdabb7-f6c4-4e40-9b45-b7cfc3d8007f	{"role": "user", "email": ""}	::1	2026-04-23 01:51:38.462021+00
1a996d09-de42-499c-8482-b4671a3f81bd	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:53:37.281086+00
5175849b-0ff5-473b-b754-b55cec51ab2b	\N	\N	auth.login_failed	\N	\N	{"email": "phase8test@mmffdev.com", "reason": "no_user"}	::1	2026-04-23 01:53:59.433882+00
7c13173b-60b2-4f14-950b-498a2f3a0dfb	\N	00000000-0000-0000-0000-000000000001	auth.password_reset_completed	\N	\N	\N	::1	2026-04-23 01:53:46.543818+00
076603f0-5a97-4f71-ba8d-b77b8ac5d71c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:56:04.364844+00
40f6880a-4e0d-462a-ac6d-6d5d9b73912f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 01:56:12.649725+00
e7e8d9fd-c676-4629-99e2-f95eedea9e2f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:56:17.504289+00
a4a73e50-3315-4fcf-8f50-c3fa0ee31698	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	user.created	user	bf2abdfb-5eb3-4dc8-b623-2b6566118ed6	{"role": "user", "email": "phase8b@mmffdev.com"}	::1	2026-04-23 01:56:57.642317+00
1cdd1bb8-51b0-49de-bd53-8191218cb5ec	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:57:14.405097+00
0e388fee-cb2b-46d2-899e-7cb1a25fcee4	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 02:01:27.860262+00
a6448575-8564-4a1b-8037-bcc40c350afe	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 02:01:32.648+00
515d0dc7-bb53-432f-ba92-4969b9de4f84	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 02:01:44.522444+00
a8e547d0-8de9-4073-96ff-f49d0dca28b1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 02:01:50.25014+00
11e6fcd0-dd8d-4d72-b582-1dd3e5b9b58e	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 02:26:26.844522+00
2bfe02ae-6917-49a3-a038-63f52980defb	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 02:26:39.358363+00
7676d159-d0ce-4208-b8bf-d682d93f38fa	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 02:27:03.964597+00
e41d2660-e46a-4171-8d79-ed6161084467	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 02:48:29.763715+00
a9449735-a358-403f-912b-c7279a5fcdc4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 02:48:29.891515+00
4c8ed30c-143a-4290-a539-2c917e1bf84d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 02:49:04.147188+00
6fc18c3c-358a-414e-b26e-7c51b76967b9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 02:49:04.1636+00
66b585bf-46e3-49c4-9cac-ddc9a164146c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:01:02.456838+00
07cbd7de-6b7a-47c7-afcf-adc3e1e60d05	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 03:01:13.671745+00
ec53bd73-05d2-4bda-81a2-1a144e1d459d	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:01:19.198198+00
09af7e7e-0184-4b9e-ac9f-5f6f613ead55	\N	00000000-0000-0000-0000-000000000001	auth.password_reset_completed	\N	\N	\N	::1	2026-04-23 01:57:31.623259+00
5635f88a-7caf-42cc-bfc8-f469e25190b5	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:02:51.531564+00
3486175d-f498-4b48-bd33-b87216681c95	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:07:09.221368+00
92a99616-6644-42d7-afc5-97b3dfad4d3a	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:04:49.752763+00
ec0fb1d4-e39f-4d18-856a-7d06d82b39c9	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:06:20.749412+00
5e094cf4-82e3-4d4a-b948-1b3c30e18d2e	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:06:29.367359+00
88cac68d-4867-4618-83d0-d44b6bb2983b	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:26:12.793417+00
e38e74b2-271b-4f55-8954-75696da11dbd	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:26:40.833876+00
5842e129-2578-49e7-9390-aecbaee20530	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:28:21.14713+00
0217024b-603b-45fd-ad0e-af1715a461c0	31c74efc-432c-4d51-8da8-9e603bbd2778	\N	auth.logout	\N	\N	\N	::1	2026-04-23 03:28:58.832646+00
c783998c-5268-4a9f-b13e-3fbd640304a5	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 03:29:15.611886+00
0df7e3da-03b1-4584-8f27-a43996bae35b	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:29:26.553995+00
7c06330c-dd9f-49b4-a40d-c426e9696cbe	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:30:36.475378+00
aec0f230-829d-4799-915d-62ed4ce2d920	31c74efc-432c-4d51-8da8-9e603bbd2778	\N	auth.logout	\N	\N	\N	::1	2026-04-23 03:31:33.783673+00
539fd979-0fad-4ba4-9ea2-bfdc49926488	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 03:31:49.199323+00
c388fe1e-5b97-4228-8917-9bb9f3d19a7b	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:31:54.354424+00
0a0aed2b-50cd-4245-81ae-2aa31c0408dc	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 03:32:18.094306+00
dd7fa1df-9f61-4768-b687-c187fdab8f5b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 03:32:30.633417+00
a7ef46b3-c983-48d5-9303-b99bb1e0a0e8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:32:35.265283+00
105b77d3-5617-4487-b9e3-ee51d1453216	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 03:46:36.023315+00
eb39016c-f127-4469-8d85-d4b92fb54359	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 03:47:33.642356+00
fe72a2c9-8955-4176-86eb-731ff0b547d6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 03:56:05.681697+00
3edbb3c6-5931-45d4-ac5a-c1f6b8ff8743	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 04:04:29.899701+00
b2b63932-716d-494a-a113-f9238349d7c3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 04:12:13.587463+00
e2188b0f-69c5-4099-ac63-6dd660b24b91	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 04:12:22.483003+00
b886b89e-7b0a-4fe4-a0e3-94cbdc8e71b9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 04:23:07.434193+00
c7bbaf12-8b96-48d2-8bae-c5cfe2ed4e11	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 04:24:25.328999+00
fbdabacb-2353-4950-8b03-cebd9cc282bf	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 04:25:26.66263+00
7235c19f-c7b0-4219-998f-d603ee375244	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 04:30:27.41197+00
0b445dbd-e67a-43a1-b50f-86a890d55eda	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 05:16:06.999327+00
4021d807-0284-4b2b-88af-365a6afff0b2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 05:16:08.820828+00
67f93c0b-9282-4e09-bf30-883b77dc595f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 05:16:46.710211+00
3bb6e677-ac03-4289-a671-f52030e4e253	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 05:16:47.035549+00
24a0f648-b9d6-47c8-8475-64d2553bb0f0	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 05:16:47.357232+00
b5995367-fcd3-487f-9bc8-1a9034c81117	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:20:15.655227+00
0da00082-5e84-4683-8f2a-8bcd7a1281fc	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:21:35.894422+00
e28cb929-47b2-4096-9312-4ac30cae32eb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:21:42.877654+00
28f0b4f7-400a-4377-9440-0c5af40e8b65	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	127.0.0.1	2026-04-23 05:21:43.869075+00
6eac4230-27d5-4cbb-93f8-221dc9b06801	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:23:28.773862+00
315588b6-fa23-44cf-9de2-d4dd84db89cf	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	127.0.0.1	2026-04-23 05:23:29.778745+00
7dc2c190-78c2-4db0-a94e-c6c3c9a9abd4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:23:36.130648+00
fd22be32-518f-4ab3-a3b4-ceef6772ff7e	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:25:45.294748+00
480df80d-bb40-4b97-9cf1-781ba566851e	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	127.0.0.1	2026-04-23 05:25:47.275296+00
902a69d6-84ce-4c7d-ab72-dc0448e32e66	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:25:47.729811+00
cc2bf610-b080-4d9d-a62d-a384de20c70c	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	127.0.0.1	2026-04-23 05:25:49.236946+00
0ac82671-eca6-4f59-ac7d-534d5c5796b7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:25:49.615602+00
3dd91d4d-bb22-4ef8-8c66-e550e473cbc7	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:26:26.012148+00
171443a5-0ffb-4f0d-9698-8513ecc692c6	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	127.0.0.1	2026-04-23 05:26:28.013008+00
71533640-a497-421c-bd0d-241ef61f0d7f	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:26:28.478993+00
f3f7c3cb-41d5-4e56-99e6-7bc74de8db1b	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	127.0.0.1	2026-04-23 05:26:29.993684+00
ca798092-0728-4ce0-9133-9d2d7110afec	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	127.0.0.1	2026-04-23 05:26:30.385207+00
3392244e-9625-40fa-bbc0-117a1f33ef76	\N	\N	permission.granted	workspace	0df9a515-3471-4ff6-bd23-600caaf86cae	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "60e01659-e189-4504-b9d8-7d7bd65dde30"}	\N	2026-04-23 05:56:09.955608+00
9da67fa7-ed66-452f-81fb-ccc1c643ab2a	\N	\N	permission.granted	workspace	eed4e5d2-07ef-4be5-aa1c-d9e3d63a743c	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "fa928125-0ea5-4833-b9fc-dfa2034da9b1"}	\N	2026-04-23 05:56:13.881176+00
c32b22dc-cb10-4987-8d27-09a5e96e08f8	\N	\N	permission.revoked	user_workspace_permission	068aec15-68e5-475a-8a54-f1bc0444e1e3	\N	\N	2026-04-23 05:56:13.979675+00
1c6845dc-e775-4252-af61-479af20284ef	\N	\N	permission.granted	workspace	84b9670e-661f-494a-8c77-a12a420eca6d	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "0dd87152-cec8-44b3-bf7e-5d78d7604465"}	\N	2026-04-23 05:56:15.83355+00
b5fea953-bfd3-4764-b320-b0e540714987	\N	\N	permission.granted	workspace	059e32b5-017c-43c3-811b-6b7513553ee6	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "3366b746-4256-47c4-b577-4589d9532d38"}	\N	2026-04-23 05:56:46.22097+00
0fe48fb8-7bd1-4f5b-9407-91cc250f2c2f	\N	\N	permission.granted	workspace	8a93a900-dad1-4773-a7e0-c313511e6823	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "507c2348-3a7b-4f4e-adc1-69afcc08a526"}	\N	2026-04-23 05:56:50.001581+00
22d3e06c-d98c-4616-a5a8-047db7d806c7	\N	\N	permission.revoked	user_workspace_permission	dcbaf95d-140b-4e35-89b6-91278d494072	\N	\N	2026-04-23 05:56:50.094841+00
a877c591-989d-4d6c-b4c8-87228adbae2c	\N	\N	permission.granted	workspace	1e233c20-7de1-4b45-b93c-33ea237a46ee	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "acf3039d-3479-453b-b4ad-9791a2e93ad0"}	\N	2026-04-23 05:56:51.459448+00
325ac4da-9578-46ac-8a32-807cc4ee8c11	\N	\N	permission.granted	workspace	5f0d0760-1ea0-40f1-9801-9e47629c7d98	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "d378e4a6-a6e0-4a5b-85ed-e49b4d2fef90"}	\N	2026-04-23 05:57:26.176226+00
1dcaf947-1340-4c55-8c78-c688cabcf5ff	\N	\N	permission.granted	workspace	b09a5489-e6aa-4759-9710-06ed66e38ba0	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "706611e6-26a5-4067-a9a2-b4657c329257"}	\N	2026-04-23 05:57:31.963422+00
cfc4812f-5d78-4bdf-93c1-5c6ff3b41ad1	\N	\N	permission.revoked	user_workspace_permission	f84a0b7f-71db-4b8d-867d-eadd1d6190b1	\N	\N	2026-04-23 05:57:32.131862+00
fbed8c7f-e925-419d-87d5-5c3183f532ae	\N	\N	permission.granted	workspace	d38aea09-2775-44cc-87dc-791d6e57e49b	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "f8cc1ec0-61d8-466e-aa36-5b70d004fe29"}	\N	2026-04-23 05:57:34.235069+00
86a511af-95df-4a01-94a1-575977d62821	\N	\N	user.deactivated	user	c792da2a-2f8d-44ae-a985-e427cf5308d3	\N	\N	2026-04-23 06:05:46.775197+00
db5fadaa-c6cd-41a1-8b1b-20fdafbd8e2c	\N	\N	permission.granted	workspace	7f13322a-5931-44bf-8b7e-0d4e288c0884	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "291b2409-e832-4302-ab4d-49a7bf6f1850"}	\N	2026-04-23 06:06:00.625537+00
107807a7-5cfe-4dd1-b8d2-71b42e1c5ec8	\N	\N	user.deactivated	user	856c822e-6ec6-4135-91a0-d9568aa423f6	\N	\N	2026-04-23 06:06:05.29435+00
201bd66f-8f60-411e-910d-26edc101becd	\N	\N	permission.granted	workspace	c604e768-e12f-41ef-8e48-363de7790753	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "c13dabcb-6781-49d1-861b-9a1037c95d58"}	\N	2026-04-23 06:06:06.535599+00
cf49e869-e2eb-4673-84fe-3e433dbc1c58	\N	\N	permission.revoked	user_workspace_permission	89c5cc31-20f6-431f-9efe-d4d5614ac38e	\N	\N	2026-04-23 06:06:06.707523+00
f91facfa-fc32-4241-a0a7-6ac3de08feba	\N	\N	permission.granted	workspace	adb0c288-d183-4bfd-a91e-bdd549b39e91	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "c531cc7b-bc7a-475f-b4a0-9040a08a3c77"}	\N	2026-04-23 06:06:09.186257+00
97fcea3a-7564-4c4a-bcb9-8a95be69850c	\N	\N	user.deactivated	user	c2e8e04c-7dde-4d50-9d53-4645b53bcb92	\N	\N	2026-04-23 06:17:07.494075+00
ba32dee7-9599-45a0-8b91-e2d132c7be77	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:26:45.191405+00
4e10537f-cf9b-462c-a63b-00cda73e52c7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:36:08.244223+00
c1446c85-f5db-477c-bfef-7af129e08ab3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:36:16.998767+00
be7fddad-9f48-47a9-b557-e6ed7d97b43f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:36:31.883472+00
e1367941-1b9b-4d90-ac8f-092c5360b455	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:36:42.796797+00
d52a811e-1491-4d65-8af1-e62e28ffd3cb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:36:59.772436+00
42907fa0-3ac4-4c4f-b82b-c83125ac87af	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:37:03.983697+00
63cc2b52-715f-4259-82c2-467879731d81	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:37:18.938415+00
f8b5b58b-2c71-4962-b673-b1583d7e7fef	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:37:24.898867+00
62d886f7-27ac-48dd-a25b-85ea724d9aa1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:37:32.386582+00
25666432-541b-4e3d-82f7-9a2799bd400d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 06:37:41.375499+00
10d98815-599e-4aae-8d3f-bc5880182dd3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-23 06:44:09.53163+00
58a5de0d-bf80-4c3a-aded-2b11bbf1d256	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 06:44:13.437797+00
fab3dcee-8f82-4b62-bae3-626db4d3cc20	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 07:16:10.412795+00
396c20bd-360c-499b-99b9-0f98830d84d0	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-23 07:16:17.309934+00
22789ba2-d858-4dfa-a635-f9bc4a0057ae	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 07:16:19.310681+00
674ba49d-5892-4035-b2aa-e965adcb4449	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 07:33:36.010504+00
3373e7f4-491a-412c-a3d0-f2366be2aaf0	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 07:42:58.267137+00
8f42eb85-f154-4363-bf72-70a9db8953f9	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 07:49:00.912937+00
2b32161b-798d-4f54-a5ee-b84e02a5bb29	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 07:53:11.003147+00
c8ecbf05-d982-4aeb-bff7-7de85fcfe807	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 07:53:17.808227+00
12a57b8c-d7c3-4185-afcd-f3df9ff35b9c	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 07:58:31.486873+00
70caccba-19e2-492d-ad94-29ca650082f8	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:12:57.353118+00
191b855f-a499-49bb-9463-e718042469d6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:14:59.009001+00
6ca3233d-4c55-41b5-9adb-1a43860c744b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:19:49.191609+00
d2614850-6151-49b9-8aba-18b94ff2e5fb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:19:53.697201+00
cba1b3b7-4285-458a-90e6-158a3675fa56	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:28:59.224987+00
39abb1ff-01f4-4adc-aa30-5e621d0854cc	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:34:54.157219+00
673fc8c8-1703-4184-8ef3-675e0cacdf6a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:37:06.947674+00
9bed7692-3a56-4ddf-9f43-b2fc8a5ba7fa	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:40:58.214853+00
3dba291f-2e25-40b3-9d8e-54038b070592	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:39:38.933057+00
26e9db08-4dd3-4cc8-8e2a-dae0024c19d6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 08:40:19.312752+00
44720bc8-02a1-4a15-9d71-b2a88e98f651	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 08:59:00.98915+00
d31b3cc1-240c-4576-ad83-8f56771cc4fc	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 12:08:41.749067+00
670754ea-2bd0-4090-a4d7-0ce5df310324	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 12:15:32.846223+00
cb6452a5-fa56-409a-83ec-eccadfe84fb6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 12:36:40.455153+00
34f31728-37b7-4865-840c-5bfeabfcde6f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 12:42:36.510537+00
81459133-e347-433f-adcf-dd8bb69349db	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 21:09:30.214833+00
06f6a3bf-9c60-47e0-b18c-f316caec5211	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 21:10:15.65549+00
0a8e7be1-3458-4414-8764-7187cd6cb6ad	\N	\N	permission.granted	workspace	fcf150de-ad01-40e6-9799-01079e60d34b	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "8e1a444f-f56b-42af-9aa3-2101f7bcbd04"}	\N	2026-04-24 22:12:46.168286+00
b95c6aca-b45f-4fe6-a9bd-3c481128fc1d	\N	\N	user.deactivated	user	d5020f47-796c-4ee2-88a2-1e5c840a9528	\N	\N	2026-04-24 22:12:50.878388+00
bbee5846-a5a4-4bc8-9eee-74b8cedb14c7	\N	\N	permission.granted	workspace	c2f54745-52f8-4546-84be-81cecfa0d003	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "af77cada-067c-473c-8fb8-4184f1519bc9"}	\N	2026-04-24 22:12:51.892357+00
763a35e4-cf7f-41c9-8ef1-26bb084d55bf	\N	\N	permission.revoked	user_workspace_permission	22e3dd14-1700-47e0-95bc-5dd205f5c253	\N	\N	2026-04-24 22:12:51.995074+00
b3fa3c1b-5510-4b34-a09d-a497cff7782c	\N	\N	permission.granted	workspace	00c28aa7-06d1-4345-a8ce-a44aa1884da1	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "6afcca5f-24cd-4101-bb38-33d6ce47a9a6"}	\N	2026-04-24 22:12:53.378511+00
06390a03-ac94-4557-8d15-972f7eff9012	\N	\N	user.created	user	a0d1bcb7-a90f-40bd-bbfa-ca6bf93eb099	{"role": "user", "email": "new-9fcc09@example.com"}	\N	2026-04-24 23:07:45.145798+00
8a2db474-4056-404c-9242-277b46faa2c3	\N	\N	user.created	user	8cabad5f-b653-46d3-9254-547e71f801be	{"role": "padmin", "email": "new-e69ab1@example.com"}	\N	2026-04-24 23:07:45.511489+00
268e8f26-522c-4056-9deb-aaf01b35378b	\N	\N	user.created	user	2c01d85c-5311-4cac-8895-e8f8ce84d0e5	{"role": "gadmin", "email": "new-7cbaeb@example.com"}	\N	2026-04-24 23:07:45.803619+00
7e3d31b0-b7f6-4823-b954-e37232204c8a	\N	\N	user.deactivated	user	394ec977-b9cb-4fac-9ecb-02013e5ec9f7	\N	\N	2026-04-24 23:07:49.679941+00
092e78bb-6a7f-44c7-82d0-138d0a536314	\N	\N	user.deactivated	user	a4082d3f-f9aa-4536-88cd-feccc611ba1d	\N	\N	2026-04-24 23:07:50.526612+00
a65d04ed-9ff9-4043-8ba1-8f4055fa2ee7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-25 00:24:29.730248+00
2f400d26-da53-4c1b-8c86-270ddf1f0651	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-25 00:24:30.776+00
7fc6dce3-09c5-42f6-aa35-ddbc08422a6d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-25 00:24:41.383094+00
b04a626b-1548-42a3-b2e4-5f95e9537ae9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-25 00:24:47.483906+00
f1872f5b-2409-4f6e-a49a-dadd9ff2ee31	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-25 01:09:11.328123+00
0c73c8d6-44a4-473f-bf8b-dc46cebedaec	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-25 01:09:25.192417+00
e317c529-381d-4d1b-983f-0fc8af00482b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:09:30.725474+00
e5c5d4f3-39d6-4988-9ef8-f405b9d5ba9a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:10:29.763022+00
1f1ffa1c-44e7-43bb-b26e-97122342b66b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:11:19.346236+00
a456023e-c520-4db9-9250-b57f40955301	\N	\N	user.deactivated	user	b5a1732d-b3cc-4bcf-8f4a-e5e93fbfc51b	\N	\N	2026-04-24 22:12:50.190531+00
294a6ef7-129b-4e5e-88f3-83da34717f36	\N	\N	user.created	user	883aee64-639e-4201-9320-9811ce0ce528	{"role": "user", "email": "new-c84e67@example.com"}	\N	2026-04-24 22:12:46.999255+00
5d81c3eb-a048-486f-bd9e-817c92fcb866	\N	\N	user.created	user	e426557b-98dd-47b9-a116-59d153630e86	{"role": "padmin", "email": "new-a97380@example.com"}	\N	2026-04-24 22:12:47.338188+00
142ed0a5-a308-4994-9a04-6229247028fc	\N	\N	user.created	user	892997f0-4922-479e-920f-82f85b1b4b84	{"role": "gadmin", "email": "new-a28372@example.com"}	\N	2026-04-24 22:12:47.689725+00
70b65dd7-fd62-439b-adaf-835759f25955	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:23:10.622449+00
f8a93653-d9fc-4912-81d7-34683b45ef05	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:29:22.876485+00
c94353ec-3070-4bab-b1e0-7e6ff60dac66	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:30:36.080768+00
cfae6500-7b2c-4d00-b502-f27367e6b9f1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:30:38.943453+00
ce71030b-fc33-4710-b8f7-9f7eba195494	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:40:48.409691+00
6de7491f-a571-47fc-8fff-53def9816392	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:40:56.44689+00
d04e0dd9-bec1-4123-bb4d-963e8b32c74a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:41:00.420476+00
ccb381d6-04b1-420d-b382-ad0ddbf62735	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:44:48.04453+00
2b6376d1-aeda-428e-9762-5b82e34fb7d6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 01:48:39.998173+00
4e14b6fa-3918-4259-92b1-d9cb2d03ba29	\N	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 01:58:05.245193+00
72402b6e-0aac-4896-b314-006479bd17b6	\N	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:58:19.595987+00
e9b6a6b4-e8f0-43a6-a33b-08e790d90589	\N	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 01:59:36.393351+00
a6f05b9b-36af-4c8b-86bc-ccb51f764538	\N	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-23 02:00:58.735318+00
be19905a-03fe-417c-a89e-e92caf389ed7	\N	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-23 02:01:19.046947+00
cb61580b-676c-47b6-b24b-e6e8a5bcdf2c	\N	\N	user.deactivated	user	060ff171-b110-4615-88c2-2c11f9fe986f	\N	\N	2026-04-23 06:06:04.635531+00
3094b19e-33e7-42a0-97a9-ed92e4c70372	\N	\N	user.deactivated	user	b7376bc4-ed20-452c-8378-243ee3b6e9e3	\N	\N	2026-04-23 06:05:46.352862+00
2c18b946-5076-4e68-8e6d-4b35da981c2a	\N	\N	user.deactivated	user	a78f25ed-1df5-44d3-949e-272080e0affd	\N	\N	2026-04-23 06:17:06.971012+00
507e5c0c-8810-4ce0-a3e4-e0853d720540	\N	\N	user.created	user	329a2da2-802b-4fbd-b239-806db669c0f4	{"role": "user", "email": "new-30db76@example.com"}	\N	2026-04-23 06:17:04.570057+00
138a4ed4-b1ae-42b9-bcb0-d83e0618a41a	\N	\N	user.created	user	e40faaca-ed61-4b32-9e00-345a551bb23f	{"role": "padmin", "email": "new-3250e9@example.com"}	\N	2026-04-23 06:17:04.872389+00
c6f2aaef-1049-40b2-84b5-a9b31f140642	\N	\N	user.created	user	f203b89c-68dc-4f33-91ca-0c72ed1cf2a6	{"role": "gadmin", "email": "new-ac0b28@example.com"}	\N	2026-04-23 06:17:05.166055+00
78a3fdf8-e4d6-4e79-af83-a1eea4682010	\N	\N	user.created	user	96c4fb93-45e3-498d-8a72-d166e8ebf6b6	{"role": "user", "email": "new-28052c@example.com"}	\N	2026-04-23 06:06:01.368397+00
29d50bbe-0a82-45d9-bdad-938815b8eedb	\N	\N	user.created	user	9e9dd078-f199-4f92-8406-56221ef49c28	{"role": "padmin", "email": "new-98083f@example.com"}	\N	2026-04-23 06:06:01.722992+00
5761eb9f-b5f2-4ca6-87b8-0809613b95fe	\N	\N	user.created	user	3dfd4a64-755c-496e-9b45-f31d70413a39	{"role": "gadmin", "email": "new-3fea6f@example.com"}	\N	2026-04-23 06:06:02.071883+00
d1c80cd1-559a-4740-ae6a-a50c0b47481c	\N	\N	user.created	user	2ed845b0-0de3-4665-a0c1-b66277ae7fe4	{"role": "user", "email": "new-984f2a@example.com"}	\N	2026-04-23 06:05:43.707749+00
dac146fc-743c-41d2-900f-5ef1504e37ed	\N	\N	user.created	user	869a7d19-cb0a-4e72-9e2a-39c5d7c95ebd	{"role": "padmin", "email": "new-4aa5eb@example.com"}	\N	2026-04-23 06:05:44.015854+00
8aaff3f9-b27a-42e2-bd50-bc13ced5d24e	\N	\N	user.created	user	48bc648e-7140-4070-abcc-56a0bbebcc7f	{"role": "gadmin", "email": "new-089678@example.com"}	\N	2026-04-23 06:05:44.317088+00
85ef1b81-0756-4437-a770-13159af03f83	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 03:57:06.086449+00
704bfaa9-c99e-4fe5-b081-b5f16de555f4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 04:38:58.826039+00
87c83f4b-0c05-4489-a9a2-20f72c40fed9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 04:39:44.351863+00
6d3335d0-27e1-4ca0-a329-833e4b15eab4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 04:43:29.164461+00
3028dff9-e6e5-476c-b466-4c990ffcec6d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 06:21:50.556558+00
695000ce-ea24-4d05-afba-fe911fdb931e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 06:21:55.145138+00
276d00d7-9a17-4d38-ac7d-0b532792ce31	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 06:22:04.26381+00
70695933-a8d4-4457-be7d-fa7eca3b1b16	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 06:35:49.804307+00
b456f358-b212-4745-849c-2a40b8cfcb98	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-25 06:35:52.615447+00
83cb3aae-2f1e-4e13-b5e4-58e7f29b363c	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-25 06:35:57.277675+00
0f7076a1-83c6-4f87-853c-fb52bbb09d4f	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 06:42:26.625414+00
de0e3397-3e78-4e98-919a-2eeb41fa8876	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 06:42:28.96272+00
da9dd756-f8d6-4f97-a087-8ce59e5a3d84	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 07:29:59.59563+00
7e235f5c-ba07-42a8-a3cc-009715b64954	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 07:30:07.475623+00
48f10665-474f-4f32-8de9-4e59ace6cd48	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-25 07:31:38.390398+00
bae8350f-5236-41b6-90b4-4d3c84bf9444	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 07:34:12.094895+00
e5fde3ab-f2f7-4100-a234-58873e79b1ed	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 07:45:07.969282+00
bb385cd6-7470-45a2-b040-19ada08485ba	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 07:45:37.269216+00
c72420f0-8f3f-4609-a943-6096dcd1a375	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 07:45:40.204287+00
b7b30e45-58e6-42a7-82cf-425d6e7e511b	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 08:25:48.209835+00
9c280e4a-9609-4d0c-8c73-29497f7a0061	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 08:37:43.961263+00
141499b7-7d3a-49fb-a93d-74f3be33a094	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 08:53:32.783981+00
decc55df-9df8-4ac3-9e8e-59df6c2e67fa	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:14:34.279564+00
e0c69751-8416-4ab7-ba27-7ad78b9c00b1	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:17:33.633635+00
80ee9771-50bc-4bf1-bdeb-590c25273828	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:17:33.757531+00
8300ce4d-62cd-4844-bdc2-76bbe2eb4360	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:18:23.607733+00
0ed23144-0c65-4591-b2fb-f6413e516675	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:18:43.366855+00
1b6c1cec-3b93-452c-8ef9-0b4e3528c189	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-25 09:18:59.122725+00
ba7fb036-d739-4cb4-9a8e-ce10feb5673a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-25 09:19:03.337031+00
dfd63927-9727-4448-8f8f-51c4b0e348a2	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:20:46.014739+00
53d6c297-7223-4892-a119-874853c75878	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:20:46.029237+00
446d8f03-9802-474b-bc33-1bc9d3c03aee	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:20:51.084492+00
47c4d238-dde9-4943-99be-2046850b923d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 09:20:51.136205+00
35125d4d-2f6c-41ff-9e4c-ee3b166388e0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-25 12:56:59.952425+00
d56299ae-d787-490c-9034-4b2770c93381	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-25 12:57:08.918677+00
8ba1c58d-2545-49de-94cf-b73b55c9e0d6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-25 12:57:14.439191+00
9fa80297-3fcf-4b64-a987-d2ece36b612c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	auth.logout	\N	\N	\N	::1	2026-04-25 12:57:18.47353+00
7c34af85-2b33-4942-82a3-7c0bb2cead56	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-25 12:57:28.465303+00
f98901fa-e3f0-4516-97aa-848dc8dbff08	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-25 23:59:54.876562+00
765af193-92fb-4f86-ae66-8eccc0f2d751	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 00:00:43.047227+00
da9fc888-3601-4418-9395-07869d18f5a0	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 00:03:14.21107+00
f7117502-c7a5-410c-a3c7-07ea9d85ea40	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 00:03:18.031116+00
d172abf9-d10e-4960-a9c4-38b60d111f08	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 00:03:43.577023+00
d1f2ca29-9ab3-4859-bffb-2b58743c3827	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 01:03:28.999343+00
60e84fdb-4003-445b-a9cd-0f93572828e2	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 01:03:30.901766+00
c7628f66-20de-4162-9654-3f0330a49982	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 01:03:33.696824+00
8046b845-e501-4f55-ab8c-42dfd508dccb	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 04:01:06.977267+00
485b9ced-a301-4ab6-9a43-cc97cc73dc4f	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 04:01:10.367177+00
5f07d75f-b67e-414d-bc81-e234fa620e11	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 17:31:04.540759+00
c6c1b14d-9ada-4b6c-bac3-3d9dc88d9d2d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 17:31:06.068026+00
0f4e78da-00b8-4589-a86d-e735c5c2a70d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 17:43:31.674797+00
09eef2b0-2cf9-4ee3-953f-75b59e9caf3e	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-26 17:50:12.772112+00
8cadf4de-2c85-4a21-a6b9-8751af385966	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-26 17:50:15.16034+00
1b4d18c6-8ced-4746-b0d8-564a490d0a2f	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 17:50:18.633487+00
f2613bbc-f13e-4052-96f4-ea4ffaf74a3a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 17:50:20.67928+00
458f7328-7e0e-459b-badc-30ab3f35862d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 18:28:05.66552+00
46361c9b-9a95-4ee8-99a6-0319949cb77b	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-26 18:33:08.089789+00
e2b3858e-d0d0-4d5a-b968-e8f1b3ecdb9e	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-26 18:33:11.515379+00
13def8f7-9b8f-49ce-83ef-9aa13d3cb418	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-26 18:33:15.576246+00
39fe6892-8e6b-431d-aef9-6c0f9ca405b8	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-26 18:33:19.406494+00
78dba446-3a6d-4f32-a2b5-bdcbda622b74	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 18:47:36.727989+00
94722df5-4af2-43bf-885a-d9f450fb6bdd	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 18:56:44.609295+00
294c77b0-254d-46a7-8db0-37f83cf2ebd5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-26 18:57:26.074675+00
71d07238-35e8-4ce4-967c-d81691440703	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 18:58:50.067621+00
4e539e75-05b5-4d03-afb3-37a36ae0a392	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 19:53:55.210596+00
74bdfd9e-dd5d-4133-9616-8671afd33282	\N	\N	user.deactivated	user	3d7e5f35-8364-4550-8057-1d7cf2b793ea	\N	\N	2026-04-26 20:05:19.938711+00
79dd88be-45ec-48f8-8171-7f3e62180f36	\N	\N	permission.granted	workspace	4b2d28b1-77a1-4762-bfab-4caef142fc29	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "f3e6b47d-d8e6-49e0-8619-c488ef6099d2"}	\N	2026-04-26 20:09:14.326253+00
b5f0fa66-e530-482a-9106-523cb0af4bef	\N	\N	user.created	user	eb52e666-b26c-4902-8a28-70d449fbe54e	{"role": "user", "email": "new-5cc460@example.com"}	\N	2026-04-26 20:09:15.653847+00
5e174c37-7ffb-4475-bcb8-0d9eaeb51ebf	\N	\N	user.created	user	6529298b-4c62-4315-9a78-f06181dd669b	{"role": "padmin", "email": "new-d94286@example.com"}	\N	2026-04-26 20:09:16.029886+00
36c41dee-3d2a-4e3e-bbee-aa28ba0b8dce	\N	\N	user.created	user	0c17ac93-5e54-4c16-a3f6-fdf1d7d34c0d	{"role": "gadmin", "email": "new-ec1ce8@example.com"}	\N	2026-04-26 20:09:16.409906+00
c28e3af0-d93d-4219-9dea-753b92b1e3cf	\N	\N	permission.granted	workspace	d7618c73-39a2-426d-8bef-21897bba1d34	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "15ba390c-a7e5-4dca-bb39-d6a6d73add19"}	\N	2026-04-26 20:09:18.370291+00
3a03e1e0-2a7b-4bf1-8a1e-c053748175b7	\N	\N	permission.revoked	user_workspace_permission	f57e3b75-2f72-42f7-90c1-d22dfc193b9c	\N	\N	2026-04-26 20:09:18.524031+00
31f3decd-3b91-467f-9eaa-78119ca0e5d5	\N	\N	user.deactivated	user	26a310f9-3e91-4e3b-ab5d-1986b161a18d	\N	\N	2026-04-26 20:09:20.355503+00
dbebe32e-f7fe-46fe-8ccc-3f0f02ff6844	\N	\N	permission.granted	workspace	20e67f6f-7e0e-44b2-8929-108c2663b3b1	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "0bb0014f-36ec-4790-b656-b3eae51820d1"}	\N	2026-04-26 20:09:20.20645+00
7207cc95-5b45-4437-bf17-ea56de02bc49	\N	\N	user.deactivated	user	e1fbf8b3-41d3-4a24-bf15-cb9b192bdbc7	\N	\N	2026-04-26 20:09:21.366778+00
4d18a95f-944f-4010-b143-040797bd4dfd	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 20:27:05.970078+00
69e05e5e-d6de-441a-8858-563a67b97893	\N	\N	permission.granted	workspace	c8c77b42-1445-45e4-b0fb-f40e845aaa5b	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "8ac53025-b7a6-4ccb-a78d-c6fc7910b409"}	\N	2026-04-26 21:07:05.472709+00
adb69e64-1b9c-4f29-94d2-35b697e85d2b	\N	\N	user.created	user	92f3cbdb-e22b-473a-8874-4fa28ed1d3db	{"role": "user", "email": "new-091af7@example.com"}	\N	2026-04-26 21:07:06.016027+00
de328aa4-5a8d-4188-9924-897bd7e0118d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:07:26.135439+00
3d8f1af6-3c19-4342-b06d-463313b5539a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:12:21.722275+00
6d1cf3bc-5c82-4c0e-819b-625ea79023e5	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:12:21.769792+00
006b5ec9-0340-4606-8fe0-24f6ced11289	\N	\N	user.created	user	6db1eef3-ca05-4383-bd6f-2e2f40d8bfe7	{"role": "padmin", "email": "new-64b46a@example.com"}	\N	2026-04-26 21:07:06.431252+00
fca0a07f-39ce-4e45-9686-3dda0f0d8b23	\N	\N	user.created	user	e9e85ce2-c1e7-425c-9d02-ba0001e64094	{"role": "gadmin", "email": "new-711103@example.com"}	\N	2026-04-26 21:07:06.828484+00
e30bb9aa-69ad-4287-aa9d-7cf84e681558	\N	\N	permission.granted	workspace	204dd58b-e74e-485d-aa7e-820b258473ab	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "cbb52e42-2d8d-49a3-b1af-8b13f7177ed8"}	\N	2026-04-26 21:07:10.900848+00
fecd5d32-49ed-48b9-91d1-94f2dda8f7bc	\N	\N	permission.revoked	user_workspace_permission	621419d1-acc6-4c07-b35b-1bd99ea02d61	\N	\N	2026-04-26 21:07:11.096561+00
4d568ae1-3bab-4b20-997e-69c783139862	\N	\N	user.deactivated	user	055513d1-c7a9-4830-9ec1-d11e4eca5227	\N	\N	2026-04-26 21:07:11.694683+00
91c69364-773c-4bc6-a298-5905137f153d	\N	\N	user.deactivated	user	6ea581b5-3b92-4d39-9289-020868186b47	\N	\N	2026-04-26 21:07:12.787387+00
da5dbf63-4121-4947-81a5-78e120154637	\N	\N	permission.granted	workspace	9c538f5e-2774-498a-a3f8-e8490b277d85	{"can_edit": false, "can_view": true, "can_admin": false, "target_user": "8c33e165-5cdd-499f-9428-e5f5737fa04f"}	\N	2026-04-26 21:07:12.986267+00
c34e5423-4ec3-4e41-862e-eb94d42dac79	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 21:34:42.516109+00
8c57e47a-acec-4bb8-b31e-500245b69682	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 21:39:19.558373+00
bfd993aa-5a17-463e-a0e2-3496b720616d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-26 21:39:53.968506+00
1d407347-68a1-4682-8f8f-6592455c771f	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 21:41:06.133626+00
a0f7c588-0a41-4cca-bb31-9f7183a80915	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 23:00:08.806085+00
2d131967-33ee-48b4-b5ac-9c4eb60d4c3a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 23:27:51.53927+00
9ae78bb0-0676-4a25-8ced-9e908b520990	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 23:43:23.938478+00
a8adb2d2-389b-4670-817a-0446ef81684e	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 23:46:20.825072+00
d3bb696a-355f-4e79-95a7-87b758d69d90	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 23:47:15.852147+00
91d7b13f-aaf7-442e-9733-c2e4a60bf6b3	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 23:48:10.805692+00
e723ac51-90e6-4852-aedb-c705d9ca24d4	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-26 23:50:56.054072+00
e0b329cd-36c7-4a1b-8077-9a8ca4f52238	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-26 23:51:51.874938+00
5b427835-98e8-4a02-aca9-39e45975fc8c	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-26 23:51:54.845642+00
e8dac05f-da9e-4289-b363-413697d41134	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-26 23:51:59.225728+00
25dff872-d2e5-455d-87a2-041d2e70adc5	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 00:14:49.705561+00
a0c2e39e-c7ec-4f31-9abc-64a4c1b1b48f	\N	\N	auth.login_failed	\N	\N	{"email": "test@test.com", "reason": "no_user"}	::1	2026-04-27 00:15:25.457358+00
3289b5ee-1ef7-4736-b3cd-0fa3e93f0cf8	\N	\N	auth.login_failed	\N	\N	{"email": "admin@mmffdev.com", "reason": "no_user"}	::1	2026-04-27 00:18:57.119533+00
36c53f4e-726b-4f86-acfa-fb36c0d9cbf8	\N	\N	auth.login_failed	\N	\N	{"email": "admin@mmffdev.com", "reason": "no_user"}	::1	2026-04-27 00:19:08.581866+00
4af4d372-4fcd-47b0-abdc-14e05ce8ed5a	\N	\N	auth.login_failed	\N	\N	{"email": "rick@mmffdev.com", "reason": "no_user"}	::1	2026-04-27 00:19:15.227188+00
d252b470-c619-402d-b07e-01fd5bfd969e	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 00:28:22.647107+00
748b9104-c5a9-4aa8-b6f9-3698df7db1c7	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.account_locked	\N	\N	\N	::1	2026-04-27 00:28:24.289333+00
f379e3e7-4263-4666-9573-07fb67b4c164	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 00:28:24.309462+00
1c4598ff-8346-422f-ac12-7cb3fee50659	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-04-27 00:33:49.907465+00
2b92b94e-4330-45a8-b017-439891dea46d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 00:35:18.102617+00
525041bb-8f79-4b5b-b61f-18cc616f04b1	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 00:36:39.958884+00
cda6bf91-cd5e-4475-9a89-ceffd2643e07	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-27 00:54:40.444544+00
9c520586-276c-4553-a3f1-ffacba71dc5c	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 00:55:18.689682+00
1fca9472-2f43-499c-a978-e20ea24bc3f3	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 00:58:43.300512+00
4bd9c361-bbad-4335-92b1-6fd6042cc983	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:03:46.397965+00
ed32dbba-562d-4787-ba39-d8f574482514	\N	\N	auth.login_failed	\N	\N	{"email": "padmin@mmffdev.copadmin@mmffdev.comm", "reason": "no_user"}	::1	2026-04-27 01:04:31.234352+00
8501f29a-19a4-456c-9f26-182eb4d84180	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 01:04:49.690104+00
a4a4b0d2-d0ec-4829-8ad3-710fb27d58f1	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 01:05:09.954822+00
52225c38-0dcd-4987-a74a-e54e6522d25b	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 01:05:13.089682+00
5288abd5-a9e0-4167-82b5-702990cd3155	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 01:05:30.759881+00
06fc3f7c-5329-4334-9af8-9df78c5bc5bb	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:05:34.562177+00
b44ecd4c-5ff1-46b1-aa02-7c5604e1fd6a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:05:43.928762+00
0140013c-bf5a-4c77-86de-9e3acb51fc62	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:05:53.049734+00
63f57451-4c5d-428c-a81c-4c8acde0ee88	\N	\N	auth.login_failed	\N	\N	{"email": "padmin@mmffdev.copadmin@mmffdev.comm", "reason": "no_user"}	::1	2026-04-27 01:06:36.192678+00
b63fdf71-9534-4c03-8915-b3643776de87	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:12:28.380876+00
591ba110-8119-427c-b9d5-026bd219ba42	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:12:28.56982+00
1bb97e45-352b-4997-b97f-b57840e56ca7	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:17:24.176873+00
9e2459c2-66c2-4ca8-8771-befded0295b2	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:17:33.765002+00
947377fe-898c-4c9e-866e-fa37af3b6cae	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:19:35.712036+00
2511e433-1c9f-4f0f-9fa0-508b32816090	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:28:17.018785+00
ccbdd889-6db7-48ea-95e0-2d3948b2a71d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:29:01.829966+00
97cd2804-5404-43a2-8670-ef5a1b8225bf	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:29:27.28815+00
1430688d-eba3-4539-be0b-43a614c08a30	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-27 01:58:51.704231+00
cd7bee97-66bf-4a55-856b-46743dd7f134	\N	\N	auth.login_failed	\N	\N	{"email": "padmin@mmffdev.copadmin@mmffdev.comm", "reason": "no_user"}	::1	2026-04-27 01:58:52.9859+00
bf83e7a4-064e-40c3-85cd-f89bada9ada4	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:59:00.794849+00
2aee76b8-bbc4-4714-9add-451545fbef27	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:17:37.285189+00
b7b8e145-ac21-47b9-bac2-98a3c2227a31	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:18:05.262904+00
db4c4c30-2dd9-47ab-bf75-c9df492a1ca1	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:19:28.417814+00
1a1faa44-ff0b-4b7a-84fc-5b5d8a45a10d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:19:28.585813+00
51f87ad8-c4e7-473d-b829-64dd833e3f61	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 01:19:35.737932+00
0bf61d83-0878-424f-bc9b-ee639bd4cc92	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:30:52.13835+00
07fc82e3-989d-49e2-8edb-a693de60fa0d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:34:54.441962+00
f00e30a8-f7fc-49e3-90c2-8891ba153149	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 01:34:58.139457+00
3d47ff93-50ab-4450-89c2-02136cfd4d5b	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 02:08:13.880263+00
c715cdfb-3b66-4c1a-b0d6-eaa1a2fbaae7	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 02:08:20.590273+00
b5ccd21a-4ce8-4bd0-a12f-4890d44a6d96	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 02:08:44.155275+00
0a0c756c-ab9b-4a88-be1a-d2c2a94642e9	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 02:27:01.662743+00
13d5dd65-5a36-438e-9b43-27feeeb05fb1	07489c05-d7aa-46ab-9346-facd64c2cbc4	\N	auth.logout	\N	\N	\N	::1	2026-04-27 02:27:05.646265+00
92ec64fc-408e-4eb1-9c6e-68913e1de31d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-27 02:27:12.825301+00
72e2d366-bfe5-4a52-9855-0e715468d043	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 02:47:52.694059+00
226974c2-099f-4fb7-ac70-63166ef8710a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 02:57:54.021893+00
ffe8d35c-3ac9-4421-b441-3e584aaf9964	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 03:03:31.108938+00
72b69dbe-0377-4578-8b7e-5bd65d5e8190	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 03:12:56.248352+00
e54c606d-6506-4d6c-a002-f87b88a1001d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 03:16:47.682205+00
52db57b9-572d-43bf-8fe6-ba1594b7d17c	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 03:17:56.015557+00
1b6f25ef-947a-40c2-b513-3737eb7fe936	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 03:27:41.699722+00
8d486130-fe10-4f56-a98d-afcf54d98416	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 03:46:46.978796+00
6b83b250-09f9-4adb-9e7c-d847fd40a39f	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 03:54:26.788443+00
1d12a1ec-496b-416e-a409-242f5b4c50bd	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 04:10:46.131082+00
1d05ed28-3a4f-4eff-9308-ca46010ae238	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 04:50:33.353182+00
1f100004-a263-4c89-b118-acdf872c3194	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 04:53:41.867082+00
4cae332d-a457-41be-9ba9-ad07f74de3fc	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 04:53:56.215556+00
847c7f1a-e69f-4d95-91db-f8b0a3dc0cc3	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 04:54:40.727781+00
540c7a69-af86-4b22-a0d5-cde679cc024b	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 04:58:32.813954+00
87d4fba0-76c5-433e-862b-7dbd5f927301	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 04:58:48.192254+00
a09ebe68-0dc6-4d73-8fd0-79b334620474	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:01:52.293865+00
118b3db4-c5c5-48a6-b54d-2abf17a919ae	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:01:58.83086+00
0746386f-de0d-4033-947f-ff870a5806a4	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:02:06.686085+00
61f01600-2db4-4fd7-b655-149fdb0ba82a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:20:06.906811+00
ced10e20-cfc1-49bb-9224-86064100bcad	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:24:45.105562+00
3a102f6f-293d-4a94-b356-da673446acf8	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:28:30.532453+00
7346e91f-e060-4f14-9b43-f76ca1b65bfe	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:29:45.990344+00
f4c3f55f-0af7-4eb2-8924-51ed8c89b759	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:37:55.891096+00
9b622795-e2f8-4280-9897-e08bf10a9029	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:40:33.186729+00
b013218e-4d43-4ba6-b95a-2005597e7125	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 05:40:34.685731+00
33999cd8-4567-4dca-82d0-36ebb048ced0	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 05:40:36.355071+00
2b435fcf-f41f-4faa-a3df-e0eeacb0e9aa	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-27 05:40:40.863683+00
09da2192-f91b-47ab-8827-e60c3a94d4ee	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 05:48:09.110029+00
828a1ce1-dec3-4033-a028-4e7b11e4c4ba	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 06:14:27.118532+00
7ec6b0bc-44a3-452d-af6b-f33268738483	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 06:15:59.042864+00
ef2b834b-0b49-4cd8-80dc-6bc92c92f893	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 06:18:32.60928+00
a8c83297-8dbf-42b9-9625-4d77a6abc1bd	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-27 06:46:53.431927+00
\.


--
-- Data for Name: canonical_states; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.canonical_states (code, label, clock_role, sort_order, created_at) FROM stdin;
defined	Defined	none	10	2026-04-21 05:46:13.186465+00
ready	Ready	lead_start	20	2026-04-21 05:46:13.186465+00
in_progress	In Progress	cycle_active	30	2026-04-21 05:46:13.186465+00
completed	Completed	cycle_stop	40	2026-04-21 05:46:13.186465+00
accepted	Accepted	lead_stop	50	2026-04-21 05:46:13.186465+00
\.


--
-- Data for Name: company_roadmap; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.company_roadmap (id, subscription_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
bb51d169-ef92-4205-9ae2-ada94cba46cb	00000000-0000-0000-0000-000000000001	1	Company Roadmap	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
\.


--
-- Data for Name: entity_stakeholders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.entity_stakeholders (id, subscription_id, entity_kind, entity_id, user_id, role, created_at) FROM stdin;
3b0e05fc-66ea-4683-a0c7-5941b318a48f	00000000-0000-0000-0000-000000000001	company_roadmap	bb51d169-ef92-4205-9ae2-ada94cba46cb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	owner	2026-04-21 05:46:22.307829+00
5e86000a-c611-4fd7-9669-042976d914be	00000000-0000-0000-0000-000000000001	workspace	0e794717-699e-4577-be0c-b419350d265b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	owner	2026-04-21 05:46:22.307829+00
41277ca3-e790-4757-8b42-b60396ebc865	00000000-0000-0000-0000-000000000001	product	9320b036-816b-41a7-aa6f-4033ee07d2f6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	owner	2026-04-21 05:46:22.307829+00
\.


--
-- Data for Name: error_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.error_events (id, subscription_id, user_id, code, context, occurred_at, request_id, created_at) FROM stdin;
c7b8d446-5d91-4d90-99e3-c52041b2a0df	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Epic\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000bb12", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000bb01"}	2026-04-26 01:03:42.706752+00	Richards-Mac-Studio.local/slAuLQPMGX-000356	2026-04-26 01:03:42.706752+00
5d755eed-6f4c-453b-8b5c-9faf73e91577	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Objective\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000ab02", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:21.763825+00	\N	2026-04-26 18:29:21.763825+00
5ef9a241-9bde-433a-b8ad-b266883b68b4	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:22.777492+00	test-stream-fail	2026-04-26 18:29:22.777492+00
3831365f-47ee-4dd4-a349-7f2f85afab9f	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Objective\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000ab02", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:24.09173+00	test-req-happy	2026-04-26 18:29:24.09173+00
bd26e905-4440-423b-9754-87f156f63988	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:25.078215+00	test-req-fail	2026-04-26 18:29:25.078215+00
9f875794-0b0d-42f9-90cf-b929fb3079f2	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:26.160699+00	test-req-resume-1	2026-04-26 18:29:26.160699+00
7d243c14-5edc-4c3c-8538-d61ba7188730	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Objective\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000ab02", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:26.578002+00	test-req-resume-2	2026-04-26 18:29:26.578002+00
73b24c9d-1be7-4987-9ed9-3e08ab37a70f	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Objective\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000ab02", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:34.073534+00	\N	2026-04-26 18:29:34.073534+00
634086f3-9746-4227-86e3-2b9d5bae37a9	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:35.671187+00	test-stream-fail	2026-04-26 18:29:35.671187+00
59de0024-963f-48dc-a48f-50ddc5e5d639	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Objective\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000ab02", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:36.929314+00	test-req-happy	2026-04-26 18:29:36.929314+00
bf2f5003-e875-4bab-ba48-6f241847e74f	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:37.935227+00	test-req-fail	2026-04-26 18:29:37.935227+00
ec820c0d-56dd-4417-8088-39a3ed6b4ea0	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:39.010556+00	test-req-resume-1	2026-04-26 18:29:39.010556+00
6f3c50ac-9c8e-4f9e-aaa8-3edd8f0e9607	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Objective\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000ab02", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:29:39.409616+00	test-req-resume-2	2026-04-26 18:29:39.409616+00
946a7873-e29c-4928-926a-fd2be79ff1dc	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Objective\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000ab02", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:30:32.789445+00	Richards-Mac-Studio.local/P07oaWjLhH-000021	2026-04-26 18:30:32.789445+00
e1673aaf-84be-4d6a-b93b-c8d27b790483	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "insert layer \\"Product\\": ERROR: insert or update on table \\"subscription_layers\\" violates foreign key constraint \\"subscription_layers_parent_layer_id_fkey\\" (SQLSTATE 23503)", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:31:47.456578+00	\N	2026-04-26 18:31:47.456578+00
ceaa146c-6778-47e9-8fb9-47d4da794ef4	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:31:48.478733+00	test-stream-fail	2026-04-26 18:31:48.478733+00
ef09e8ea-e104-4d2d-a252-5fd9922e402b	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "insert layer \\"Product\\": ERROR: insert or update on table \\"subscription_layers\\" violates foreign key constraint \\"subscription_layers_parent_layer_id_fkey\\" (SQLSTATE 23503)", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:31:49.734128+00	test-req-happy	2026-04-26 18:31:49.734128+00
fc2f0e13-e2a2-459f-ab6e-cd1749859fe9	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:31:50.721507+00	test-req-fail	2026-04-26 18:31:50.721507+00
36dc892f-4782-4bf4-857d-5d844995f498	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:31:51.802739+00	test-req-resume-1	2026-04-26 18:31:51.802739+00
2612d591-e802-47dd-9cd8-950d59c5972d	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "insert layer \\"Product\\": ERROR: insert or update on table \\"subscription_layers\\" violates foreign key constraint \\"subscription_layers_parent_layer_id_fkey\\" (SQLSTATE 23503)", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:31:52.18595+00	test-req-resume-2	2026-04-26 18:31:52.18595+00
692374cd-b481-4250-a79d-54cf7cafd988	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "insert layer \\"Product\\": ERROR: insert or update on table \\"subscription_layers\\" violates foreign key constraint \\"subscription_layers_parent_layer_id_fkey\\" (SQLSTATE 23503)", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:34:20.805394+00	test-req-happy	2026-04-26 18:34:20.805394+00
99c3f146-6278-4194-9046-f5a3333dda7a	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:35:49.62263+00	test-stream-fail	2026-04-26 18:35:49.62263+00
7bdbc373-054f-48ec-922c-89043df33dc8	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:35:52.899298+00	test-req-fail	2026-04-26 18:35:52.899298+00
b9083c33-e771-4034-9629-754ba2e27a4f	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:35:54.006302+00	test-req-resume-1	2026-04-26 18:35:54.006302+00
642a9b8d-ef95-4eac-b0b5-33b4e46cfa97	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "layer \\"Business Objective\\" references unknown parent_layer_id 00000000-0000-0000-0000-00000000ab02", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:47:40.381964+00	Richards-Mac-Studio.local/P07oaWjLhH-000049	2026-04-26 18:47:40.381964+00
547444d5-ffb5-46eb-bce9-4b48260ecdda	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:52:21.763338+00	test-stream-fail	2026-04-26 18:52:21.763338+00
7bdc7b31-8e1f-4cec-b0e2-44b152c6ece5	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:52:25.093316+00	test-req-fail	2026-04-26 18:52:25.093316+00
4d87b304-7bdc-42e8-b4fb-85830ec5d147	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:52:26.183549+00	test-req-resume-1	2026-04-26 18:52:26.183549+00
f487fec5-be72-4679-a68c-95a3da6aed09	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 18:53:20.370667+00	test-stream-fail	2026-04-26 18:53:20.370667+00
327f11c3-861e-4611-94ec-ad468cd74b6d	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 20:09:41.20705+00	test-stream-fail	2026-04-26 20:09:41.20705+00
7851a5e2-6722-4597-af24-1518e68d8445	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 21:07:14.034987+00	test-stream-fail	2026-04-26 21:07:14.034987+00
722a5778-b96b-4b2d-8a8c-4203c98a97cf	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 21:07:18.161096+00	test-req-fail	2026-04-26 21:07:18.161096+00
44030bb8-fda8-4b41-815b-8d37db2a139c	00000000-0000-0000-0000-000000000001	07489c05-d7aa-46ab-9346-facd64c2cbc4	ADOPT_STEP_FAIL_LAYERS	{"step": "layers", "detail": "sim-harness injected failure at step layers", "handler": "portfoliomodels.Adopt", "model_id": "00000000-0000-0000-0000-00000000aa01"}	2026-04-26 21:07:19.268588+00	test-req-resume-1	2026-04-26 21:07:19.268588+00
\.


--
-- Data for Name: execution_item_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.execution_item_types (id, subscription_id, name, tag, sort_order, archived_at, created_at, updated_at) FROM stdin;
82701430-7f77-4833-98bc-4bc578bab616	00000000-0000-0000-0000-000000000001	Epic Story	ES	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
8ab11490-6f0d-461e-a8fe-ad43390152b6	00000000-0000-0000-0000-000000000001	User Story	US	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	00000000-0000-0000-0000-000000000001	Defect	DE	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
d681e126-6c40-4967-9fb9-8d9e7f0fd139	00000000-0000-0000-0000-000000000001	Task	TA	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
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
3a980a5e-812c-4b97-9118-b45f00a01735	product	9320b036-816b-41a7-aa6f-4033ee07d2f6
\.


--
-- Data for Name: page_roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_roles (page_id, role) FROM stdin;
6d34eb4d-b1e3-4902-937b-c4e211b750da	user
5dcff011-faa8-40da-98f6-a0dea9d8394a	user
1b3230b6-c100-45da-8d3e-6485c2a68cd3	user
b281f7ef-b041-42df-b353-86d165306ea0	user
0ee21d65-ef87-455f-bcc0-fb7bf479e56f	user
55e74580-97ac-4e17-88f8-90fac432ed7d	user
9441744e-4cdc-4b92-8e97-a00217863870	user
0529295a-6541-4fd0-8c6f-157cfebb69df	user
09e70341-6909-4bd3-8f1d-739fffbfddfd	user
6d34eb4d-b1e3-4902-937b-c4e211b750da	padmin
5dcff011-faa8-40da-98f6-a0dea9d8394a	padmin
1b3230b6-c100-45da-8d3e-6485c2a68cd3	padmin
b281f7ef-b041-42df-b353-86d165306ea0	padmin
0ee21d65-ef87-455f-bcc0-fb7bf479e56f	padmin
55e74580-97ac-4e17-88f8-90fac432ed7d	padmin
9441744e-4cdc-4b92-8e97-a00217863870	padmin
0529295a-6541-4fd0-8c6f-157cfebb69df	padmin
09e70341-6909-4bd3-8f1d-739fffbfddfd	padmin
6d34eb4d-b1e3-4902-937b-c4e211b750da	gadmin
5dcff011-faa8-40da-98f6-a0dea9d8394a	gadmin
1b3230b6-c100-45da-8d3e-6485c2a68cd3	gadmin
b281f7ef-b041-42df-b353-86d165306ea0	gadmin
0ee21d65-ef87-455f-bcc0-fb7bf479e56f	gadmin
55e74580-97ac-4e17-88f8-90fac432ed7d	gadmin
9441744e-4cdc-4b92-8e97-a00217863870	gadmin
0529295a-6541-4fd0-8c6f-157cfebb69df	gadmin
09e70341-6909-4bd3-8f1d-739fffbfddfd	gadmin
76d3aac2-9a98-4fce-a6d4-2d60081cb01f	padmin
76d3aac2-9a98-4fce-a6d4-2d60081cb01f	gadmin
eaf0ff7e-e850-447d-aa6f-25d83ad7ae14	gadmin
3a980a5e-812c-4b97-9118-b45f00a01735	user
3a980a5e-812c-4b97-9118-b45f00a01735	padmin
3a980a5e-812c-4b97-9118-b45f00a01735	gadmin
12c370e4-f3be-41d3-af51-065bb1ff9425	user
12c370e4-f3be-41d3-af51-065bb1ff9425	padmin
12c370e4-f3be-41d3-af51-065bb1ff9425	gadmin
1f44dca1-7908-4979-967e-612af462d6c4	padmin
a13edf6d-03a2-4ea3-a60c-a73a22f472b8	gadmin
bc2845b1-6fa5-4468-97ae-b1b15827015d	user
bc2845b1-6fa5-4468-97ae-b1b15827015d	padmin
bc2845b1-6fa5-4468-97ae-b1b15827015d	gadmin
\.


--
-- Data for Name: page_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_tags (tag_enum, display_name, default_order, is_admin_menu, created_at) FROM stdin;
personal_settings	Personal Settings	5	t	2026-04-22 23:32:35.664906+00
bookmarks	Bookmarks	0	f	2026-04-23 02:13:58.435406+00
planning	Planning	2	f	2026-04-22 23:32:35.664906+00
strategic	Strategic	3	f	2026-04-22 23:32:35.664906+00
personal	Personal	0	f	2026-04-22 23:32:35.664906+00
admin_settings	Admin Settings	1	f	2026-04-22 23:32:35.664906+00
\.


--
-- Data for Name: pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pages (id, key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id, created_at, updated_at) FROM stdin;
6d34eb4d-b1e3-4902-937b-c4e211b750da	dashboard	Dashboard	/dashboard	home	personal	static	t	t	0	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
5dcff011-faa8-40da-98f6-a0dea9d8394a	my-vista	My Vista	/my-vista	eye	personal	static	t	t	1	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
1b3230b6-c100-45da-8d3e-6485c2a68cd3	backlog	Backlog	/backlog	clipboard	planning	static	t	t	0	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
b281f7ef-b041-42df-b353-86d165306ea0	planning	Planning	/planning	list	planning	static	t	t	1	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
0ee21d65-ef87-455f-bcc0-fb7bf479e56f	portfolio	Portfolio	/portfolio	briefcase	planning	static	t	t	2	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
55e74580-97ac-4e17-88f8-90fac432ed7d	favourites	Favourites	/favourites	star	personal	static	t	t	2	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
9441744e-4cdc-4b92-8e97-a00217863870	risk	Risk	/risk	warning	strategic	static	t	t	0	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
eaf0ff7e-e850-447d-aa6f-25d83ad7ae14	workspace-settings	Workspace Settings	/workspace-settings	cog	admin_settings	static	t	t	0	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
76d3aac2-9a98-4fce-a6d4-2d60081cb01f	portfolio-settings	Portfolio Settings	/portfolio-settings	briefcase	admin_settings	static	t	t	1	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
09e70341-6909-4bd3-8f1d-739fffbfddfd	dev	Dev Setup	/dev	wrench	personal	static	f	f	99	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-22 23:32:35.664906+00
3a980a5e-812c-4b97-9118-b45f00a01735	entity:product:9320b036-816b-41a7-aa6f-4033ee07d2f6	Product	/product/9320b036-816b-41a7-aa6f-4033ee07d2f6	package	bookmarks	entity	t	f	0	\N	00000000-0000-0000-0000-000000000001	2026-04-23 02:26:27.071355+00	2026-04-23 03:47:34.63798+00
12c370e4-f3be-41d3-af51-065bb1ff9425	theme	Theme	/theme	theme	personal_settings	static	t	f	1	\N	\N	2026-04-23 06:25:55.112694+00	2026-04-23 06:25:55.112694+00
1f44dca1-7908-4979-967e-612af462d6c4	portfolio-model	Portfolio Model	/portfolio-model	package	admin_settings	static	t	t	2	\N	\N	2026-04-25 01:00:15.606607+00	2026-04-25 01:00:15.606607+00
a13edf6d-03a2-4ea3-a60c-a73a22f472b8	library-releases	Library Releases	/library-releases	bell	admin_settings	static	t	t	3	\N	\N	2026-04-25 01:00:30.032942+00	2026-04-25 01:00:30.032942+00
0529295a-6541-4fd0-8c6f-157cfebb69df	account-settings	Account Settings	/account-settings	user	personal_settings	static	f	f	0	\N	\N	2026-04-22 23:32:35.664906+00	2026-04-25 01:38:02.033536+00
bc2845b1-6fa5-4468-97ae-b1b15827015d	dev-library	Library	/dev/library	book-open	personal	static	f	f	101	\N	\N	2026-04-25 23:59:02.661647+00	2026-04-25 23:59:02.661647+00
\.


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_resets (id, user_id, token_hash, expires_at, used_at, requested_ip, created_at) FROM stdin;
b10c00a6-f8a8-4441-9573-60a78b884c28	31c74efc-432c-4d51-8da8-9e603bbd2778	80ebca6e4ee58b2526378448a318db3053a53af57b12b9de259ae033e4e3297e	2026-04-22 01:56:50.118926+00	2026-04-21 01:57:45.792136+00	::1	2026-04-21 01:56:50.153179+00
1412c9e5-db2c-4c10-849d-33e9726819cf	07489c05-d7aa-46ab-9346-facd64c2cbc4	3d9f7ab2cd97f496d697b28385aea8207ca2bea0dbc6604d8367db0058757e0b	2026-04-21 02:58:56.170541+00	\N	::1	2026-04-21 01:58:56.186821+00
c9832bdd-82a5-4308-8e5a-7648a1b68b1e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5bfe75d9dd89d7523c34bc3240a92bfd11bf35deed0bd6835f7ad830500a446f	2026-04-21 02:58:56.297781+00	2026-04-21 01:59:46.64642+00	::1	2026-04-21 01:58:56.314072+00
aaa050de-39ab-4f9e-bcbd-e7896f2149f2	31c74efc-432c-4d51-8da8-9e603bbd2778	43b044e4bc4c46945cbea45bc4eda78c10510439a764abd93666cf77e6d146a3	2026-04-21 03:11:37.911316+00	2026-04-21 02:11:39.347263+00	::1	2026-04-21 02:11:37.941706+00
f6c38c37-cdd5-42ca-ac5a-fe5acd51bf61	dbf65721-7b73-4906-a5d0-18fcd7b1db58	f6e141b320fd7b6be951708a7ff1a1160fd3e9d0ade868362f902a4002df502b	2026-04-21 03:12:48.298692+00	2026-04-21 02:12:49.705489+00	::1	2026-04-21 02:12:48.31414+00
2d33406e-d1ea-4e9b-870e-4b077e06ff13	07489c05-d7aa-46ab-9346-facd64c2cbc4	c597b4d5b712aa91fef9c9ef479065346ec488c2a707d3494a220bc41303b04d	2026-04-21 03:18:28.427125+00	2026-04-21 02:18:29.811456+00	::1	2026-04-21 02:18:28.441907+00
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
9320b036-816b-41a7-aa6f-4033ee07d2f6	00000000-0000-0000-0000-000000000001	0e794717-699e-4577-be0c-b419350d265b	\N	1	Product	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (filename, applied_at) FROM stdin;
001_init.sql	2026-04-25 07:33:25.817411+00
002_auth_permissions.sql	2026-04-25 07:33:25.835346+00
003_mfa_scaffold.sql	2026-04-25 07:33:25.850342+00
004_portfolio_stack.sql	2026-04-25 07:33:25.865558+00
005_item_types.sql	2026-04-25 07:33:25.883888+00
006_states.sql	2026-04-25 07:33:25.898999+00
007_rename_permissions.sql	2026-04-25 07:33:25.918451+00
008_user_nav_prefs.sql	2026-04-25 07:33:25.933547+00
009_page_registry.sql	2026-04-25 07:33:25.948873+00
010_nav_entity_bookmarks.sql	2026-04-25 07:33:25.964218+00
011_nav_subpages_custom_groups.sql	2026-04-25 07:33:25.98872+00
012_pages_partial_unique.sql	2026-04-25 07:33:26.003998+00
013_polymorphic_dispatch_triggers.sql	2026-04-25 07:33:26.022853+00
014_page_theme.sql	2026-04-25 07:33:26.037981+00
015_user_nav_icon_override.sql	2026-04-25 07:33:26.053414+00
016_user_custom_pages.sql	2026-04-25 07:33:26.069383+00
017_subscriptions_rename.sql	2026-04-25 07:33:26.088843+00
018_subscription_tier.sql	2026-04-25 07:33:26.104615+00
019_pending_library_cleanup_jobs.sql	2026-04-25 07:33:26.123373+00
020_portfolio_model_page.sql	2026-04-25 07:33:26.138601+00
021_library_acknowledgements.sql	2026-04-25 07:33:26.157231+00
022_library_releases_page.sql	2026-04-25 07:33:26.172578+00
023_backfill_library_releases_pin.sql	2026-04-25 07:33:26.192571+00
024_backfill_portfolio_model_pin.sql	2026-04-25 07:33:26.207816+00
025_nav_group_reorder.sql	2026-04-25 07:33:26.227414+00
026_subscription_portfolio_model_state.sql	2026-04-25 07:33:29.522718+00
028_error_events.sql	2026-04-25 07:33:29.618821+00
029_adoption_mirror_tables.sql	2026-04-25 07:33:55.484496+00
030_unpin_gadmin_portfolio_model.sql	2026-04-25 07:33:55.872762+00
031_nav_dev_library.sql	2026-04-25 23:59:02.692139+00
032_drop_pre_adoption_item_types.sql	2026-04-26 20:03:45.873842+00
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (id, user_id, token_hash, created_at, expires_at, last_used_at, ip_address, user_agent, revoked) FROM stdin;
4b7da2ad-14cd-45a7-b701-dcbc59c9545e	31c74efc-432c-4d51-8da8-9e603bbd2778	0fa2cbd03a839f524ad901541aaa0024896a36cccc452b0b66326989d61b9521	2026-04-21 01:58:03.812355+00	2026-04-28 01:58:03.795717+00	2026-04-21 01:58:03.812355+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
92e64ecc-d70c-485f-a440-6853b53799c4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a196be4dfc73b3443f81670ad88671f27c55d34ed0e93afc92c3d0de190ade20	2026-04-21 23:19:38.425871+00	2026-04-28 23:19:38.451311+00	2026-04-21 23:19:38.425871+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6a5a64c0-b891-495c-ae3f-14b6040c234f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9000ca1534ce63f1677c6b0aa7bf5f4cc094e02ede47e4e3b14ef906408c94fb	2026-04-21 23:20:32.543283+00	2026-04-28 23:20:32.554481+00	2026-04-21 23:20:32.543283+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
61ba1544-cd32-45e3-b05a-93bb9aad41e9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	4010d2ac957edc9196395d3aaa937e2f07498e33d1368f764d9c30dd0439b3c7	2026-04-21 23:28:12.580306+00	2026-04-28 23:28:12.59264+00	2026-04-21 23:28:12.580306+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
149fe3f8-6f10-4eb1-ab80-d4daefb02b26	dbf65721-7b73-4906-a5d0-18fcd7b1db58	3019cbe259ad8e34ee182ba2daf79cb315161e79f08f72258fc9ca9d656506d7	2026-04-21 23:33:58.736572+00	2026-04-28 23:33:58.755826+00	2026-04-21 23:33:58.736572+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0f850d70-ca1d-40f3-8e84-41ec7d377e9a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	27a711111d6d04d44aa0886a136054b55a1c4a1ecaa50e71ee30e8b27782fb50	2026-04-21 23:35:43.941936+00	2026-04-28 23:35:43.955176+00	2026-04-21 23:35:43.941936+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2d13383f-c09c-4aab-b31c-62961735e298	dbf65721-7b73-4906-a5d0-18fcd7b1db58	2767cdf60e3c2429c1555b4eb73652d672f2357e358e417cca559adfd4453ab6	2026-04-21 01:46:45.08371+00	2026-04-28 01:46:45.051633+00	2026-04-21 01:46:45.08371+00	::1	curl/8.7.1	t
bc23eff6-d7c3-4ef8-9938-c7089765e6fc	dbf65721-7b73-4906-a5d0-18fcd7b1db58	55f92bede9bb6129b74d97173c4ed5092026078bfd00f11a65ae1ba1b3f9a838	2026-04-21 22:37:23.837146+00	2026-04-28 22:37:23.80568+00	2026-04-21 22:37:23.837146+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9d90c3ba-0297-4728-9962-ae815783a685	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0fa2fd0318911160edcae07ceac1f8b1b8446044627d3ee8ec5a8a7eada72617	2026-04-21 01:46:51.626696+00	2026-04-28 01:46:51.609968+00	2026-04-21 01:46:51.626696+00	::1	curl/8.7.1	t
45db6131-b08a-416a-8c71-b903da52600f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	f8e9d3cdccf3a65c24b382a99c11a07d2249ad81e0c229a68e344db004002030	2026-04-21 22:38:04.424686+00	2026-04-28 22:38:04.459859+00	2026-04-21 22:38:04.424686+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4856c2d5-1f24-4ffb-bfa6-92cedd549237	dbf65721-7b73-4906-a5d0-18fcd7b1db58	3a4e8a092fb9528389ddcb580dad7a8b59b8fe96a2ad9600ee526f6168908dec	2026-04-21 01:46:57.625747+00	2026-04-28 01:46:57.609873+00	2026-04-21 01:46:57.625747+00	::1	curl/8.7.1	t
a4108cea-f953-4e54-9ef8-f7d9c1d8daf4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	46ccf7e8543ec158c31ae3c10308e371bfb969a1cba59514f6cbd10f886881ea	2026-04-21 22:50:02.152579+00	2026-04-28 22:50:02.18034+00	2026-04-21 22:50:02.152579+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
62bc6baf-ca5e-4464-afd4-16e6a3cf9122	dbf65721-7b73-4906-a5d0-18fcd7b1db58	df0f064bd5f923a24c31b4b1690194929f2bf485df7cc6d192874293b6259ddd	2026-04-21 01:47:55.912472+00	2026-04-28 01:47:55.879769+00	2026-04-21 01:47:55.912472+00	::1	curl/8.7.1	t
6281bf9c-c0ee-4c95-8b53-cbd600673382	dbf65721-7b73-4906-a5d0-18fcd7b1db58	97b14fe03c8e9e5a8bb0bce81209ac34bdde9c67702e2b07088569d8da8870dd	2026-04-21 01:48:03.111454+00	2026-04-28 01:48:03.095531+00	2026-04-21 01:48:03.111454+00	::1	curl/8.7.1	t
401e3d1b-6d26-44a4-ab4c-0777e96f5e2c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	eef4adf4c59820d2013e1dba356a282c8f9c4ba24e58d34fa7b0532a7a6f9062	2026-04-21 01:48:45.543189+00	2026-04-28 01:48:45.504143+00	2026-04-21 01:48:45.543189+00	::1	curl/8.7.1	t
762527e8-290c-4872-9025-0094ad88bab7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	902945311331389c495c5e893a13a234fa5dcb7f10dbde10ab99f7b26e81b533	2026-04-21 22:56:19.944818+00	2026-04-28 22:56:19.979264+00	2026-04-21 22:56:19.944818+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b0816bc8-21e4-4b9e-9fbd-c186c8a8c064	dbf65721-7b73-4906-a5d0-18fcd7b1db58	3c92a42d26645a00e922932d0e57bdf86d924c47310bf5be5f8faeb662a4243a	2026-04-21 22:56:26.159659+00	2026-04-28 22:56:26.174945+00	2026-04-21 22:56:26.159659+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
de8c795e-5835-4a51-80f6-608640b44bf6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ef11a73ff0b37bcdd031be3eab7deaaee8905aea1e53cfd0f45537076e0709cb	2026-04-21 23:08:08.323488+00	2026-04-28 23:08:08.339514+00	2026-04-21 23:08:08.323488+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a60ba3fd-da1b-464a-a8e2-da173bbe2ab9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e734a68ce615572709fdcb2ec002929e078028639679fa3bc477905776cd70cd	2026-04-21 23:40:08.894368+00	2026-04-28 23:40:08.908141+00	2026-04-21 23:40:08.894368+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
30fd2141-1e88-48ca-9c05-7fda3cfc7acd	dbf65721-7b73-4906-a5d0-18fcd7b1db58	86cd5210b71745d4a4a3b8ac77486d427f4e7e2427a02778baf7fe14aa7b799f	2026-04-21 23:42:59.360497+00	2026-04-28 23:42:59.381635+00	2026-04-21 23:42:59.360497+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
086ad548-e7b3-46b8-8a2c-140ba48929e7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	36fe868ff7ca11926ba758d1ce131fabd65e872e791436980c31f199d29b1a9f	2026-04-21 23:44:03.081603+00	2026-04-28 23:44:03.095083+00	2026-04-21 23:44:03.081603+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a519898d-4e7d-48f1-a38b-1df1e8cc750f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	3a329d0842a19125c20699b0d3d10e0d6c6db44c37eb80cb128eb19a7fe40c09	2026-04-21 23:45:48.21566+00	2026-04-28 23:45:48.230825+00	2026-04-21 23:45:48.21566+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bee5e80f-3046-45f3-97d9-8e48eb81e151	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c36f28925957e672361a4c4fcbde30550fda1764a2238415f7653bc8ae8fa8e9	2026-04-21 23:47:22.437272+00	2026-04-28 23:47:22.452318+00	2026-04-21 23:47:22.437272+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
311a931d-3f41-4542-b60c-aec2c4cd51bf	dbf65721-7b73-4906-a5d0-18fcd7b1db58	30c193c705e27fbc50ba37038810ee07e86e731e7a2307cddbe28af458fb23e2	2026-04-22 03:37:04.597443+00	2026-04-29 03:37:04.627194+00	2026-04-22 03:37:04.597443+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d282d664-65f4-44f5-b15c-7e2dc664112f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5daddae7ef18c648d28abff7ac9c4a4fcfaf36f4591a8a4025b96e87fa33f64b	2026-04-22 22:40:25.872811+00	2026-04-29 22:40:25.909628+00	2026-04-22 22:40:25.872811+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a0278a22-73a4-4234-b34f-406fa69dde3e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5c6382a78b36bf5b3f12b2b1c45234671a446a1af8293309cffd956521c0bc61	2026-04-23 00:21:21.167609+00	2026-04-30 00:21:21.200545+00	2026-04-23 00:21:21.167609+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5aad58b7-96de-4b3f-985a-d062bd1b8d7d	07489c05-d7aa-46ab-9346-facd64c2cbc4	0e5b0ff19757385cc69d18046d1ab30b988f7697655b5ae71eeca3d6ae8152c5	2026-04-23 00:23:07.378177+00	2026-04-30 00:23:07.362746+00	2026-04-23 00:23:07.378177+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
48919fa1-bb62-4e77-bc8c-714cb454df8c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ea16cf96197405de16ec8894ba973f85dc3261a89cb3cc6cc498b792d69befdc	2026-04-23 00:23:14.120455+00	2026-04-30 00:23:14.060221+00	2026-04-23 00:23:14.120455+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ab168650-a078-468f-b796-3da677d5e001	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ab81c5c4d2c18a76f7de60982aafe97ac6e5ef0a90c767a4eea1fe512fa81dd7	2026-04-21 02:22:28.789719+00	2026-04-28 02:22:28.775255+00	2026-04-21 02:22:28.789719+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
09d2a6c2-b8fa-4728-9e2b-45e6385256a2	31c74efc-432c-4d51-8da8-9e603bbd2778	b0cf76002b8eddcfdace4e89395b34c6c7ba93c79049919c23a92dad52ca0cec	2026-04-21 02:11:39.829131+00	2026-04-28 02:11:39.798739+00	2026-04-21 02:11:39.829131+00	::1	curl/8.7.1	f
f14d7963-8f5f-4ff9-9d47-28860ac21f76	07489c05-d7aa-46ab-9346-facd64c2cbc4	0e32da29b7f755e29c7379866bab4a80c3ed30b4564f48d19d8ef5550934b8f6	2026-04-21 02:19:32.124867+00	2026-04-28 02:19:32.109903+00	2026-04-21 02:19:32.124867+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
8872dd40-2d4a-4168-a503-aaca70f3876d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6e2161beb4bed187688c588cd2728b5ab34dcd89cb442d5066de03f5f904eeb5	2026-04-21 02:05:22.301907+00	2026-04-28 02:05:22.285968+00	2026-04-21 02:05:22.301907+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bc079b1c-a4f2-41f5-8ea0-836dc3d39fe4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	40a7b14c0735a987bd294289d1911305304bdaeeb6a2c6f18787771c7aef3015	2026-04-21 02:12:13.748384+00	2026-04-28 02:12:13.781304+00	2026-04-21 02:12:13.748384+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
02376ee4-2df4-489c-91eb-1795d6f6a436	dbf65721-7b73-4906-a5d0-18fcd7b1db58	64e44fcab6cb42f25dd01123423fbd88fe7c349d8485615a3929d8d7298cc7da	2026-04-21 02:12:24.685636+00	2026-04-28 02:12:24.670017+00	2026-04-21 02:12:24.685636+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b21d9e9b-3b69-4f51-8cb9-37ad16d4c6ee	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c1d52a7e82d8828c68361e6e921a3f4e3d1130cc4113fbc880402267422e292d	2026-04-21 02:12:50.090614+00	2026-04-28 02:12:50.074091+00	2026-04-21 02:12:50.090614+00	::1	curl/8.7.1	t
87847fd5-511c-4b46-8489-54f664137266	dbf65721-7b73-4906-a5d0-18fcd7b1db58	99942178f65013912847dfdd218d86a542aaee8cf0dee746a4043441f5599f8e	2026-04-21 02:15:58.162783+00	2026-04-28 02:15:58.14725+00	2026-04-21 02:15:58.162783+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
15ffab5c-23b8-4cab-bb66-d05603996393	dbf65721-7b73-4906-a5d0-18fcd7b1db58	99d445c77a8436dcb6e3486887cafd391b8f46125b2ce2c959f47b5a27b2ded6	2026-04-21 02:18:30.189186+00	2026-04-28 02:18:30.173986+00	2026-04-21 02:18:30.189186+00	::1	curl/8.7.1	t
241ef36e-b2be-4ff7-8ff3-fc455415337d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	74a9d19befafcef8626227a21e750b9282fecef4fb384f48fba6bf26f007db61	2026-04-21 02:19:13.420864+00	2026-04-28 02:19:13.406201+00	2026-04-21 02:19:13.420864+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
960a5542-4fad-456b-b420-87db3f274564	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5d3855a90838b71ad9b820552d2f202b15e6917bf5f32b28b6abf73d9876757e	2026-04-21 02:22:42.544005+00	2026-04-28 02:22:42.52937+00	2026-04-21 02:22:42.544005+00	::1	curl/8.7.1	t
a330698b-3384-4963-a1c4-eeb7c25f9832	dbf65721-7b73-4906-a5d0-18fcd7b1db58	7b3d73985d5742ac758f3d7393ce88f6206219e49011a18157f807976b4ceab8	2026-04-21 02:22:37.620481+00	2026-04-28 02:22:37.605903+00	2026-04-21 02:22:37.620481+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
30427f84-22e0-45d1-82e5-a10864acf9f3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c724f1ad01abcea681862c4747ef84d70f9dc5d02d370f4b3dbfcabebceff36c	2026-04-21 02:26:13.643938+00	2026-04-28 02:26:13.629228+00	2026-04-21 02:26:13.643938+00	::1	curl/8.7.1	t
60fdc778-884b-4379-b68c-504d6a28463a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1a6b8e0088442a439062c73557645c7b7d331e901cb71979ea0e14d7434d1f14	2026-04-21 02:26:13.962041+00	2026-04-28 02:26:13.945688+00	2026-04-21 02:26:13.962041+00	::1	curl/8.7.1	t
2e50389a-ea92-4ee0-a9a2-569b8ffe4c39	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c86d66b3174fdf522d46f0f61291a70e5967a0727eaa234368055d6344dc7774	2026-04-21 02:24:24.109682+00	2026-04-28 02:24:24.094967+00	2026-04-21 02:24:24.109682+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bbdc102a-bfc6-4d96-9554-de3c023bd912	dbf65721-7b73-4906-a5d0-18fcd7b1db58	dc5f7f0d8ea250ccf59f2f5e9b051d5f0094c303038c40cc2f0f7802b6e46f78	2026-04-21 02:57:18.423479+00	2026-04-28 02:57:18.459259+00	2026-04-21 02:57:18.423479+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
02fd5602-a951-4f7a-baf0-f0d45a1abd4e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	2fefe65d45796fc1d52bbcbbb1b4f8dd946a53e58b0702c59c390a8b256fa316	2026-04-21 04:46:59.059862+00	2026-04-28 04:46:59.025278+00	2026-04-21 04:46:59.059862+00	::1	curl/8.7.1	t
57333c3b-611c-4a98-bed6-d5e93bbdf8ac	dbf65721-7b73-4906-a5d0-18fcd7b1db58	fc1dc39fd6c28215ffd2748b62788eafe7b0ec62cd0e04e710464399adb4d50e	2026-04-21 02:57:20.584632+00	2026-04-28 02:57:20.569436+00	2026-04-21 02:57:20.584632+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b14a4758-c7c0-44f8-9108-8c60337176d9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e6f7678196349a0c7105be674fd2f76d8a457100b5c062428ef7357431b4fe55	2026-04-21 04:47:20.776288+00	2026-04-28 04:47:20.803963+00	2026-04-21 04:47:20.776288+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f12a1ca3-c1be-4e20-b973-e0423a337d85	dbf65721-7b73-4906-a5d0-18fcd7b1db58	31ca8180974660c4cb37687fffe7c8805c6d78e544b203f0d280b0706982477c	2026-04-21 04:47:22.817351+00	2026-04-28 04:47:22.800001+00	2026-04-21 04:47:22.817351+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1f5edd1e-73fe-4c69-837e-86d6390880c7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e457d69b9e4ba520ac18094611794aca6440f8a5ee97c9f3c0a8d8213b487185	2026-04-21 04:48:26.953743+00	2026-04-28 04:48:26.984088+00	2026-04-21 04:48:26.953743+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ad37f2ce-b134-4816-91f5-bbc478adb9c3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e5731e659832f7239207d860e152151fcd8e82b7ca6fa8b568523bf9f8142957	2026-04-21 04:48:28.474676+00	2026-04-28 04:48:28.456776+00	2026-04-21 04:48:28.474676+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
8d8ab700-e02f-4551-97f5-ca7401db77d5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e08d553e31ffe1b9144b5b981e4ef4aa170da73b645380e842fe0a0656fba03b	2026-04-21 06:01:28.04291+00	2026-04-28 06:01:28.071967+00	2026-04-21 06:01:28.04291+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b34e1b8e-0cfc-4e72-b023-89034b64f0a5	07489c05-d7aa-46ab-9346-facd64c2cbc4	46a422d3ed12f5c20cbd2724b957c2deb0d4b9edb288fbb11fe658416b7ddaa3	2026-04-21 02:18:30.505603+00	2026-04-28 02:18:30.490586+00	2026-04-21 02:18:30.505603+00	::1	curl/8.7.1	f
dc3b11ae-cc2d-47bd-8594-ff2d0f1216c8	31c74efc-432c-4d51-8da8-9e603bbd2778	ea5996b088ba603a2b8fa22b8c27c48b7425a4b0cd4e5ff454b32c1bd65dcb1d	2026-04-21 02:18:30.818263+00	2026-04-28 02:18:30.803569+00	2026-04-21 02:18:30.818263+00	::1	curl/8.7.1	f
a6bc209b-75fb-47c4-bd04-92ea0f5991ad	dbf65721-7b73-4906-a5d0-18fcd7b1db58	89080349590c3e0c6b9dd83da11b29ca1d6d31e4ba8cf19a272ead9a785211a1	2026-04-21 06:05:32.044868+00	2026-04-28 06:05:32.062718+00	2026-04-21 06:05:32.044868+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
fcc2258e-cfe8-481f-90df-4cd4463ed625	dbf65721-7b73-4906-a5d0-18fcd7b1db58	12d6bf3c7f5b0f6c691bf6a5780bc9e01a52bb4994db0dc33a436446bf088535	2026-04-21 06:08:04.531117+00	2026-04-28 06:08:04.543191+00	2026-04-21 06:08:04.531117+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a5e285eb-7ea2-40a2-8123-d4cdb73c3203	dbf65721-7b73-4906-a5d0-18fcd7b1db58	66b8faa26869be7603f5c8c47617c419bf1350cf8f989b37e20a3669153df57f	2026-04-21 06:11:48.586342+00	2026-04-28 06:11:48.602402+00	2026-04-21 06:11:48.586342+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
44143dc7-91b4-4e5e-b51c-6ef1ae228b4f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6c0923e44c3b5a45273d1ae7c60bcd3be342c640ba3698afc8cd252462715fe2	2026-04-21 06:12:00.130347+00	2026-04-28 06:12:00.153609+00	2026-04-21 06:12:00.130347+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7a3bee4e-05e1-4987-b520-d172e6a9bc4f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e20d47c3cf939287c09a049854171033fa57c1fa0803fc9661834d1c5733cd0d	2026-04-21 01:48:54.789326+00	2026-04-28 01:48:54.772383+00	2026-04-21 01:48:54.789326+00	::1	curl/8.7.1	t
72a6aa5f-7c79-4b37-a58e-e8213acd2fef	dbf65721-7b73-4906-a5d0-18fcd7b1db58	fb547006f8ae6f108798bd85f61dd8f893a8d7b25662e20e5611874b0a69e778	2026-04-21 01:49:02.691508+00	2026-04-28 01:49:02.67486+00	2026-04-21 01:49:02.691508+00	::1	curl/8.7.1	t
d79623c7-2243-4840-aac8-d6a72faa1276	dbf65721-7b73-4906-a5d0-18fcd7b1db58	02092a633ec378856603c981185cb5b72072bd6edb18743ca6fb6baed9e4048e	2026-04-21 01:55:42.86509+00	2026-04-28 01:55:42.834062+00	2026-04-21 01:55:42.86509+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
766e6b05-86cd-417f-84b4-528f7c15f66e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1248699bed6e63c03dbb271b8de4a5efb5ae91d03b89f41466439e8ba22e132a	2026-04-21 01:55:52.72831+00	2026-04-28 01:55:52.712029+00	2026-04-21 01:55:52.72831+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c040073f-5194-49f7-95a2-04c1a0c9c7fd	dbf65721-7b73-4906-a5d0-18fcd7b1db58	17d020b30697858a6580da4edc1980c5ff965a6e2d6173e6f430e93c442f6fc8	2026-04-21 01:56:49.73589+00	2026-04-28 01:56:49.719057+00	2026-04-21 01:56:49.73589+00	::1	curl/8.7.1	t
e4cfcf95-39e4-464d-bc63-6944317d643e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	51e4aec22dcf794ad1a754ade3f7834b366479bef5842b32d926baf8e50af131	2026-04-21 01:57:14.002672+00	2026-04-28 01:57:14.034503+00	2026-04-21 01:57:14.002672+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f074254e-d89a-4bb9-abca-a291882c0047	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0e9f93cdf4711d9a9a6af0bc04e04d9bed6d30f1cc221731fb0dc5a3f2849958	2026-04-21 01:58:14.201537+00	2026-04-28 01:58:14.182797+00	2026-04-21 01:58:14.201537+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c3514e9f-9533-4be9-93ea-391fb1176b37	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ccc2547d815b20b12589ec54e7ebb67d75813aa9fcdb9dc6d60687bf2572b698	2026-04-21 02:01:19.882084+00	2026-04-28 02:01:19.865101+00	2026-04-21 02:01:19.882084+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b9a860e6-36a7-4186-8abf-719e8f2effa3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	bd45d4663dc86f72b6602858d146d92177eaf99dfea80df22b34cf83536d1dfe	2026-04-21 06:19:06.070889+00	2026-04-28 06:19:06.0865+00	2026-04-21 06:19:06.070889+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
22a63335-b195-40ca-b9d8-59a158c776ea	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5ee8a755e396bb6f50f2a5fc5bf7fe5956475e1997adcc071008b0861a494fc7	2026-04-21 06:22:57.642275+00	2026-04-28 06:22:57.658245+00	2026-04-21 06:22:57.642275+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
16e65012-8e77-4811-b2a5-162c10484fb9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	92107b5b6e0a70bcac841875e7e114eefe82cc37674018461cc50e21e70a71b7	2026-04-21 06:23:00.484649+00	2026-04-28 06:23:00.504928+00	2026-04-21 06:23:00.484649+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7e15b298-baba-47db-ac4c-77b3f51039f0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	199e2d59c62678629f9c2cf9272a1aa1673c92155efa6c8a46141d18381ab35b	2026-04-21 06:26:06.614985+00	2026-04-28 06:26:06.631305+00	2026-04-21 06:26:06.614985+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4ac78e86-843b-4e29-b1d0-3c2c36b0de95	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ff6d4ca824490119792997fbd569aaa7155270e47d394aad7e3b0ba03e125323	2026-04-21 06:26:10.140807+00	2026-04-28 06:26:10.157419+00	2026-04-21 06:26:10.140807+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d9b22ba3-3865-47bf-b099-7d836ccfa43e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	bbef220fdfdac54d2800b25d33a4fdd259d2a676ff53f06aa47fc05bf974d8c2	2026-04-21 23:08:18.206571+00	2026-04-28 23:08:18.175627+00	2026-04-21 23:08:18.206571+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0f753c82-7e26-4888-aa1b-67b549057f9e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	11fab81b77a355bdc4e90f5ffe8ddc4c80e7ca88f9896682ef5ca93b16fd8898	2026-04-22 01:41:21.408955+00	2026-04-29 01:41:21.441914+00	2026-04-22 01:41:21.408955+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5a72f7f1-f722-4315-ac55-af52e708d628	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0708dc77010f8438bb3dce5cc61167279a6aa5fa0cd98d2624baed2859ad4af7	2026-04-22 02:01:44.505648+00	2026-04-29 02:01:44.483981+00	2026-04-22 02:01:44.505648+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
74b88383-afe9-46ea-bac0-8e3c6b0e21ce	dbf65721-7b73-4906-a5d0-18fcd7b1db58	32db62a6f2474a2be89206c695ecaf1a74dd9663d3d0998f699503552a381bb0	2026-04-22 03:41:50.483483+00	2026-04-29 03:41:50.451176+00	2026-04-22 03:41:50.483483+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
8e9b0606-2876-4956-89dc-034dbfd9f5fb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	b6133a1b25586d9848f6606f50106033c3228fab2d6425f437bc4b83362835a2	2026-04-22 03:43:46.328055+00	2026-04-29 03:43:46.356285+00	2026-04-22 03:43:46.328055+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bba7372f-2d0c-474b-82c5-e2f421a09c44	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9abdcdb7549b7d8e8cd7fa20325239b1b3d87a16e41498fc3d86ebdc1de79a50	2026-04-22 03:43:50.314033+00	2026-04-29 03:43:50.329059+00	2026-04-22 03:43:50.314033+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
11164f8f-a318-44b0-af10-2e43fda10784	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6f234438288bab5acf55ecaba24fed402d4d7045254b8dd60ac3e2ce12a07796	2026-04-22 03:43:54.421195+00	2026-04-29 03:43:54.404713+00	2026-04-22 03:43:54.421195+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
edda3290-1b10-4f61-b2c0-77db988ada6a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a2091b694e9a7dbb820c606251ea235ba7068eb194e2839bfcde16fdb741dd85	2026-04-22 03:44:12.608491+00	2026-04-29 03:44:12.592158+00	2026-04-22 03:44:12.608491+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d30d5722-69a7-40ca-a15b-1ccfefe0e309	dbf65721-7b73-4906-a5d0-18fcd7b1db58	90038264252ae0d89151b9d16d589f46fa0f5dfa26678c6794d1c1480b174024	2026-04-22 04:02:42.249552+00	2026-04-29 04:02:42.263569+00	2026-04-22 04:02:42.249552+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d2ca6954-7389-4f16-9564-1292deced308	dbf65721-7b73-4906-a5d0-18fcd7b1db58	bc12effb0ff88c75e60438a533e5a447036f0e796a8f09b703ac5f335bfcb8ae	2026-04-22 04:02:46.675472+00	2026-04-29 04:02:46.691235+00	2026-04-22 04:02:46.675472+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
72c06863-d07e-48f3-b63a-9efd494ce6c2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	66b32033e18bcf27b4000ce3e11e3e06fc93e7e7ea2b174607ecfc45c29dac64	2026-04-22 04:02:49.76375+00	2026-04-29 04:02:49.778345+00	2026-04-22 04:02:49.76375+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2f5f5ef4-2fca-44ee-b9a8-19d481eed62d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a333faa13132aaad43e21fbc3157192db034256d58fa4fb4fa93fdb9164b2a5b	2026-04-22 04:02:52.486639+00	2026-04-29 04:02:52.499691+00	2026-04-22 04:02:52.486639+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ae91c327-31fb-4287-bd49-5c4f78597795	dbf65721-7b73-4906-a5d0-18fcd7b1db58	690b2beb43979e99add5be4fe657a53e71517e85e64f7d87edd3cbbd57549ddb	2026-04-22 23:49:33.953748+00	2026-04-29 23:49:33.980651+00	2026-04-22 23:49:33.953748+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
3af41f8a-c45b-4fe2-8b48-2d69d3b97d9c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0c8ee5dfa8aa727ef02d43efa6331f963ef5ad1f9dbb9635505225098397c164	2026-04-22 23:49:39.553187+00	2026-04-29 23:49:39.568869+00	2026-04-22 23:49:39.553187+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7d68735f-9015-41ad-a49f-162cc9810bcf	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6b7f4ca953b18673384cea7bc5871decbc5ebcb75903ea34a4c8325e845ece6d	2026-04-22 02:15:36.206041+00	2026-04-29 02:15:36.172571+00	2026-04-22 02:15:36.206041+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
21a1d993-3992-40f6-85a6-b7dfabeecbcc	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1f78347103766033f6fad5c838b054068de1011f6f970c2723e2f669768e03d9	2026-04-22 02:26:28.787282+00	2026-04-29 02:26:28.815233+00	2026-04-22 02:26:28.787282+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
19766c96-8e8a-41c6-a6b7-e7cca561605c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	b4ac36eeb10f27a9f4bd3995659bc1b216d792a51f19b9d86872009c6d08319e	2026-04-22 02:28:44.246634+00	2026-04-29 02:28:44.258718+00	2026-04-22 02:28:44.246634+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1b941c27-6797-4f09-86e1-aab323838b96	dbf65721-7b73-4906-a5d0-18fcd7b1db58	330dbe6ce2735c97ba53642cf7707e1ed0c69a91dc236308f3299a2d11022534	2026-04-22 02:28:48.622591+00	2026-04-29 02:28:48.633118+00	2026-04-22 02:28:48.622591+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a64ffdfa-e36c-453c-9bea-d8e2c0b91c9e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	db394b23c044db3ec43aafb3dbee73e0c38ea9a0f7c5870d3922e302ba5d5445	2026-04-22 04:03:54.133636+00	2026-04-29 04:03:54.147917+00	2026-04-22 04:03:54.133636+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2d361158-e02b-4a84-97c3-5daf30e35bf7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	72d0fd872dbc6ec806492b4342efa0ef862cc1913b0006c3f4c09ebb2bd68277	2026-04-22 04:11:49.581652+00	2026-04-29 04:11:49.595919+00	2026-04-22 04:11:49.581652+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c76fc724-b056-4a3a-9e55-9194314f54d0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	4f551065982075bd73c3554393036738ab0247d3711c73c0ceb34c8e185f944d	2026-04-22 04:12:38.115808+00	2026-04-29 04:12:38.130155+00	2026-04-22 04:12:38.115808+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
8ee5f5a1-cfcf-4a43-b559-822b94cea89f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0a248fb232d4e4cae5fbac91e0481e0dc5d85d0738835f8e9cb7a335b3ea04a6	2026-04-22 04:14:38.738326+00	2026-04-29 04:14:38.767514+00	2026-04-22 04:14:38.738326+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
313109a0-75d5-4e3e-8bcf-39c4e22d6be8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	12772ad7147c06f7acec7fddb073859ab49fb16651427e0af96aa36c10e0a633	2026-04-22 04:15:29.356072+00	2026-04-29 04:15:29.372383+00	2026-04-22 04:15:29.356072+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2d93c2bd-12c0-48f9-a7e6-34b8221b879a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1791428453e84e3e919addeadceefacb6a194f944743711e845240ad3448533c	2026-04-22 04:22:17.413642+00	2026-04-29 04:22:17.426772+00	2026-04-22 04:22:17.413642+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ac9f3f52-01d5-40db-a059-bc1af30a2984	dbf65721-7b73-4906-a5d0-18fcd7b1db58	748a149466a43534c5240e1920b27680618bdbbd3ee90701c257cfab2fa924f8	2026-04-22 04:23:13.615666+00	2026-04-29 04:23:13.630828+00	2026-04-22 04:23:13.615666+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b5034f58-f8d9-4c86-9212-62320cb0e042	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c57cd693b4c909562636a147f7532512c50f10265d9cca01da22446d1ed45071	2026-04-22 04:26:51.210636+00	2026-04-29 04:26:51.223878+00	2026-04-22 04:26:51.210636+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
181314ff-7946-49b4-b65d-86dc7ffeec1b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	adfd442505e637881187e78f9c23f1a44249b997f5e40a3ccdf56debcfb55de0	2026-04-22 23:49:45.124096+00	2026-04-29 23:49:45.136959+00	2026-04-22 23:49:45.124096+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5186622b-1def-48f5-9005-61766eafd2a7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c89e5826f33169347dd1d297539b2f3f080fb7384cd3497c5841c82f4e25a027	2026-04-22 23:49:52.961558+00	2026-04-29 23:49:52.973813+00	2026-04-22 23:49:52.961558+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6baaa399-9f47-4abd-9f2f-7deef62ba45c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9f73a61b822596cc6daca59644de9331f1c1fa3d5c5d1d24f926bb28f04e5820	2026-04-22 23:49:58.482202+00	2026-04-29 23:49:58.494783+00	2026-04-22 23:49:58.482202+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2739f8ef-efa7-4d70-80b0-c72ca5aea50f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	4d5e6d3d8bc8cf0f5dc61021e00ca94bac81401bb3887097b65532c0085fe244	2026-04-22 23:50:20.875495+00	2026-04-29 23:50:20.888071+00	2026-04-22 23:50:20.875495+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d3d9619e-d3ec-4f50-a1a5-939da84f24e6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c75917a735f577c53cd3f92b6301f60918e501dc1be68f2fb2f96b97e48eaa55	2026-04-22 23:56:25.025895+00	2026-04-29 23:56:25.011263+00	2026-04-22 23:56:25.025895+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
11aa28fa-ac74-4864-b664-5080a5314afd	dbf65721-7b73-4906-a5d0-18fcd7b1db58	b8b48a6c61bb2d28677da2d88cdd69c7f0ee99aa0109a5c029b9b428bafa752f	2026-04-23 00:04:41.472279+00	2026-04-30 00:04:41.486443+00	2026-04-23 00:04:41.472279+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0f9fb173-00ea-489e-bffa-e2a3ae6d4eda	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6a6998b98788d6ec5fffc64961998cf5ea250a8aaf182407790b9dc67b6c7597	2026-04-23 00:06:25.963018+00	2026-04-30 00:06:25.944755+00	2026-04-23 00:06:25.963018+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7795cfc9-0985-420c-8663-25579309072a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	4bf4a7cda3f3dc83b91eaad8ef0cf976050ad3b846f259bd41c1432a104c5c45	2026-04-23 00:08:26.421058+00	2026-04-30 00:08:26.435041+00	2026-04-23 00:08:26.421058+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1ff848dd-02ce-49bf-86bd-101ef375297f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	53ba06b0c22584b025a1d0c7d2a3ba3e73dc1295bcad64568befcc6bf1e8410e	2026-04-23 00:10:18.708035+00	2026-04-30 00:10:18.721477+00	2026-04-23 00:10:18.708035+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
78c9a554-a92d-46eb-a93f-ab865919fc34	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1519cbb54d46e0e99f3496d67b48ff1128dc418bb486299c7f24d1cfa7b77f17	2026-04-23 00:10:22.672658+00	2026-04-30 00:10:22.686269+00	2026-04-23 00:10:22.672658+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e20dea8e-3ba2-4e8e-801a-dd3316d3d214	dbf65721-7b73-4906-a5d0-18fcd7b1db58	bc4473e408e7c8ffe4fa72c8f6e6aaf8066c7bb6984a2f58fd1ac1c52a932554	2026-04-23 00:10:28.817336+00	2026-04-30 00:10:28.830503+00	2026-04-23 00:10:28.817336+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
59852cd1-d8db-44a9-9cf3-8067f628e61c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0813dbdce294793c61f35cd3974953d2e7c23b8ff528b46edd1501f69d629b57	2026-04-23 00:10:33.016023+00	2026-04-30 00:10:33.031119+00	2026-04-23 00:10:33.016023+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b8c4aac8-f2c0-45c9-b38d-e1ae64ec15c0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9d7f9081bd569ffb10938645bebd4eca13408f4ff5add78bb645944d73160ca6	2026-04-23 00:17:28.616252+00	2026-04-30 00:17:28.643639+00	2026-04-23 00:17:28.616252+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5045b40c-9e14-4b6a-b4f3-974321c8e128	31c74efc-432c-4d51-8da8-9e603bbd2778	27793f4c0388b9710126b865ef5749701730f45812860e3c9988f8b671b83cc9	2026-04-23 03:46:35.991067+00	2026-04-30 03:46:35.95911+00	2026-04-23 03:46:35.991067+00	::1	Go-http-client/1.1	f
96a3092e-9dbd-46e5-b68b-d178eeea7d51	dbf65721-7b73-4906-a5d0-18fcd7b1db58	b02d371935584c846cc916bb559220c32e656f01f62fb8393f8b91bc1c233df5	2026-04-21 06:32:51.096343+00	2026-04-28 06:32:51.113962+00	2026-04-21 06:32:51.096343+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6b984c65-dce6-4a75-8184-1d1177545fa4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	444a3b2e2cc825554662e100a0e715ab22a3b63107db7b1cde7a6c171763f087	2026-04-21 06:32:54.410669+00	2026-04-28 06:32:54.43264+00	2026-04-21 06:32:54.410669+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4aa0c9d3-8e35-4743-a1e7-2a8a6bdeb2ae	dbf65721-7b73-4906-a5d0-18fcd7b1db58	8e622f9044c4c93115fb92303fa2d8c0964a2c9f94f5da00674de67d07530b25	2026-04-21 06:33:33.949587+00	2026-04-28 06:33:33.966387+00	2026-04-21 06:33:33.949587+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
82dba032-dfbd-4aee-bf48-513b44b4be45	dbf65721-7b73-4906-a5d0-18fcd7b1db58	abab21074318dd8bf9a734ecd4ebd16084d92a112df0d562861758c7556016bd	2026-04-21 06:41:12.603777+00	2026-04-28 06:41:12.627257+00	2026-04-21 06:41:12.603777+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
31884595-dc0b-4719-b36a-972c01a85cbc	dbf65721-7b73-4906-a5d0-18fcd7b1db58	bbaa08d0124e328e7e2c0c495f4fb364c19a06d234ba37050deaee1c871b8adc	2026-04-21 20:34:13.883275+00	2026-04-28 20:34:13.914377+00	2026-04-21 20:34:13.883275+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
cc949373-3126-416b-bc07-3b5275e71e59	dbf65721-7b73-4906-a5d0-18fcd7b1db58	abe0d27cf87632312baf32c1f71bbaf0792a2be5b558010131e58ba5179430fc	2026-04-21 20:38:56.199428+00	2026-04-28 20:38:56.215246+00	2026-04-21 20:38:56.199428+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
23295587-b614-4237-be8b-c3268a6c9d86	dbf65721-7b73-4906-a5d0-18fcd7b1db58	37ddacd6d911be43a69d6abdd264a819e749297c79bd9f78f9da4140683e784f	2026-04-21 20:42:00.736244+00	2026-04-28 20:42:00.750931+00	2026-04-21 20:42:00.736244+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
956aa146-289b-460e-964f-7df65c7194a1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	2848f64280a0a61f9916f23f1c7c4dfe8c9cad8cf5ec7a84088edccbae9c3144	2026-04-21 20:42:02.330488+00	2026-04-28 20:42:02.345045+00	2026-04-21 20:42:02.330488+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
87bf8588-7388-4f9a-92a7-0a7d9aafa2e8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c07f140a65e8460087eaf6f1d025362a1bfa63fc36106f8856e5998c9f940d07	2026-04-22 03:24:55.907622+00	2026-04-29 03:24:55.940521+00	2026-04-22 03:24:55.907622+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6a3b8018-11ce-40a9-8787-7b1e813ddd54	dbf65721-7b73-4906-a5d0-18fcd7b1db58	be4ef13b46851f0ad5db14a9cc81db940031df6a2029d7be281dfb46bb652f74	2026-04-22 03:25:01.121385+00	2026-04-29 03:25:01.138592+00	2026-04-22 03:25:01.121385+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7a9a3d22-afdc-4ac8-9b5c-daeff07296f7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	2747f828628365720ec75b17cb9bc1c9540e9685cb7e249bb227d48e2b95a7cb	2026-04-22 03:25:07.477082+00	2026-04-29 03:25:07.49345+00	2026-04-22 03:25:07.477082+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ffa75b9e-0eb6-45ce-8423-f8fc3cc65eea	dbf65721-7b73-4906-a5d0-18fcd7b1db58	d08f0d297eeeefdb8db222ba66496e3282a18340f77f61cd84515e9cb4777080	2026-04-22 03:29:10.147556+00	2026-04-29 03:29:10.162479+00	2026-04-22 03:29:10.147556+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
47d89b18-ff0b-4069-a260-bfbf20cb4837	dbf65721-7b73-4906-a5d0-18fcd7b1db58	423d16328b8ddfacc2600b8b51bf965f6561ad22bb56faaceb29b5fd095a121b	2026-04-22 03:34:34.902867+00	2026-04-29 03:34:34.887496+00	2026-04-22 03:34:34.902867+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1e704530-a2f0-4b3d-9843-ee1bfa507a49	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9697d1b5cff9b14e811430470a06372d66c0230d9bc4cef6255c8613207da214	2026-04-22 04:38:32.718437+00	2026-04-29 04:38:32.749508+00	2026-04-22 04:38:32.718437+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ae0d47c9-ad0f-43cf-94b5-367ddc3b55f2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9fb80a73323866042b83c5d230994a97fa4a7604ef7461580e6259e97ccf42a4	2026-04-23 00:15:20.529578+00	2026-04-30 00:15:20.563529+00	2026-04-23 00:15:20.529578+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e19adaf7-6f0f-4733-8ce2-ee901bd56332	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5d96a6847ac976d21126859be2876804790064b7d477158c499b5a40fdd88203	2026-04-23 00:15:30.798165+00	2026-04-30 00:15:30.782774+00	2026-04-23 00:15:30.798165+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
41f3c4b1-d6db-4bbf-9bb1-c494b09a2787	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1aaefbb06a9116fcd0316125e30f50593446f65bb87d2f2b11e0d3aa544c07e3	2026-04-23 00:17:01.569726+00	2026-04-30 00:17:01.644098+00	2026-04-23 00:17:01.569726+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
57a6d2d7-8f96-4df1-824f-ddb24421d1ae	dbf65721-7b73-4906-a5d0-18fcd7b1db58	33e1897089ef9a412941aa2554ca22a3fa7734125ab084526aaa5656fd8a1170	2026-04-23 00:22:28.42764+00	2026-04-30 00:22:28.394351+00	2026-04-23 00:22:28.42764+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b7be65f1-5231-45b6-8ade-ea6825bb0f1f	07489c05-d7aa-46ab-9346-facd64c2cbc4	2f7184e930cb263cdc901ff05b4f78a0389ee22532f6a99a9f6de9f1b8028814	2026-04-23 00:22:51.462575+00	2026-04-30 00:22:51.448254+00	2026-04-23 00:22:51.462575+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
3bf55f22-f4a4-4424-8459-80f7b66d9260	07489c05-d7aa-46ab-9346-facd64c2cbc4	d259da6a2d5c6ba8c4ce7804c19489fc8e10915c08715d50d1a03a6a137cbd85	2026-04-23 00:23:33.606915+00	2026-04-30 00:23:33.591226+00	2026-04-23 00:23:33.606915+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
74528305-abd8-4de8-afd4-aaf1f4997244	07489c05-d7aa-46ab-9346-facd64c2cbc4	292c7561af02d1a17883604387bb172c875e3614ae294b1e7291d633fa5c41c3	2026-04-23 00:23:43.572197+00	2026-04-30 00:23:43.556443+00	2026-04-23 00:23:43.572197+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f8aa3a02-73a7-4816-b19f-89264dc56374	07489c05-d7aa-46ab-9346-facd64c2cbc4	e88f745e485d6fc803584fa6b8714ac40950e73a49cd9b588395cfad3e759ba8	2026-04-23 00:24:14.789823+00	2026-04-30 00:24:14.774744+00	2026-04-23 00:24:14.789823+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d5630de9-9e19-44f8-aa39-26289b2b1a3e	07489c05-d7aa-46ab-9346-facd64c2cbc4	e4d09ea4479b359130eab2caa9fb48e80b7fdb929a07a6ee7e41406f784b3598	2026-04-23 00:24:34.039513+00	2026-04-30 00:24:34.025013+00	2026-04-23 00:24:34.039513+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e1afcc0c-6833-4693-9389-d1b854fac0de	07489c05-d7aa-46ab-9346-facd64c2cbc4	e389cde5e10c6d28a7178d4d4074380804345ef1fb85c90c4f2e7b0bb4ef7a25	2026-04-23 00:24:52.70968+00	2026-04-30 00:24:52.691806+00	2026-04-23 00:24:52.70968+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ec1632d8-c5b6-4619-9f7c-4c2a923d329f	07489c05-d7aa-46ab-9346-facd64c2cbc4	7c2003fc76a1f67b51d97af425046001cbf0516c1573454c2e267348394e4bc6	2026-04-23 00:25:25.888262+00	2026-04-30 00:25:25.870718+00	2026-04-23 00:25:25.888262+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
45f912b7-8c6d-4b5e-826d-ef16c6da9d32	31c74efc-432c-4d51-8da8-9e603bbd2778	cb922d0aa4d0319b5b80d31d280888dad243cee8e519a77f9177e38acf4214f5	2026-04-23 03:47:33.604373+00	2026-04-30 03:47:33.572547+00	2026-04-23 03:47:33.604373+00	::1	Go-http-client/1.1	f
cbc9a5fa-8be8-4b41-8abd-28130931b3c6	07489c05-d7aa-46ab-9346-facd64c2cbc4	cdb82c98ea355b0ff02558b97056f56485b48be981c2c6f2eab98c313fde7626	2026-04-23 00:25:43.387494+00	2026-04-30 00:25:43.372498+00	2026-04-23 00:25:43.387494+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bab19a02-3785-40bf-9c91-31a77c8a1cce	31c74efc-432c-4d51-8da8-9e603bbd2778	d26245a2e10b174b98b3ed49982e9929c1c8dc241356de47a520facca8d9543e	2026-04-23 00:27:40.103944+00	2026-04-30 00:27:40.089467+00	2026-04-23 00:27:40.103944+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bfe2e344-b887-4ca3-b462-f865215c0c8e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	456d0610935ca7a7dacc006dbc11e3f8cb78441c7477a2a383a751015e4911d1	2026-04-23 00:28:34.868698+00	2026-04-30 00:28:34.853717+00	2026-04-23 00:28:34.868698+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
907e2f83-3532-4a19-b1e4-08a2fff1a57c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	549f60a07959f7e56e995ec5b9ab968ab415d1be3478fb54451fb130c840e72e	2026-04-23 00:36:49.630066+00	2026-04-30 00:36:49.672382+00	2026-04-23 00:36:49.630066+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c31e192d-3940-44aa-9c28-5ff7904a01f3	31c74efc-432c-4d51-8da8-9e603bbd2778	f86ac2c5e9592ad21be2df465af85463ceb806b16b8b91fda31962326188c6dc	2026-04-23 00:39:46.40864+00	2026-04-30 00:39:46.423953+00	2026-04-23 00:39:46.40864+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
522ce1ee-062b-466d-8234-35d179db8cf9	31c74efc-432c-4d51-8da8-9e603bbd2778	fd86b4a6e43f5e6ea66931b063dca1f55fcb5ba9dd61cf9086745d044d82f51a	2026-04-23 00:39:50.650429+00	2026-04-30 00:39:50.671344+00	2026-04-23 00:39:50.650429+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
72deef95-46b2-4e9d-adfb-11faee18fd80	dbf65721-7b73-4906-a5d0-18fcd7b1db58	2de0f2204eff5668b4e8a4399a15b962ee3c055530aa535672f7c506fea90132	2026-04-23 00:40:43.379001+00	2026-04-30 00:40:43.364199+00	2026-04-23 00:40:43.379001+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
566f1ea0-a80c-4775-a142-548f8db4dc8f	07489c05-d7aa-46ab-9346-facd64c2cbc4	20f10eb75c7a90b53a048733ac22ca7bfbbfdad069f7d0862ffeddbf4aae53bd	2026-04-23 00:26:03.599465+00	2026-04-30 00:26:03.584401+00	2026-04-23 00:26:03.599465+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
55259475-c375-4744-8015-7d15c81911d2	07489c05-d7aa-46ab-9346-facd64c2cbc4	ec02fe294a2f83e2eb0fbc52c6dd36d3f48228c9247d3af74ca47ab6091027d9	2026-04-23 00:26:49.56329+00	2026-04-30 00:26:49.577319+00	2026-04-23 00:26:49.56329+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
855c12c1-cbe0-4091-8ac4-66ae6eb6a63d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e9b124723c0090b52c1aa7918ac9d0be4db03105af9304aeca478fd06aefc2be	2026-04-23 00:28:27.006581+00	2026-04-30 00:28:26.992377+00	2026-04-23 00:28:27.006581+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4e0bb990-265a-4fce-b79f-29df66e16cb9	31c74efc-432c-4d51-8da8-9e603bbd2778	a97e2e90afcbda466f9ff7b9dd371b1625533c31c5d989644691bb542c0b0152	2026-04-23 00:36:55.237551+00	2026-04-30 00:36:55.222759+00	2026-04-23 00:36:55.237551+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
185f3eff-cb66-45be-bf62-42fa9f48e38c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0830ec5d973e3d3fb9f09f55e14593f6084e312ecb6359b894e10ea3bb99a090	2026-04-23 01:42:53.07993+00	2026-04-30 01:42:53.045414+00	2026-04-23 01:42:53.07993+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
214efa97-98e3-4380-9c4b-4496d6ea0612	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a2e412001a07e46fa6c418666c1125e97fce410cc0838042a324435d596a750a	2026-04-23 01:43:51.900448+00	2026-04-30 01:43:51.932559+00	2026-04-23 01:43:51.900448+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
253e98b2-4602-4398-8a13-eecc9dea6344	dbf65721-7b73-4906-a5d0-18fcd7b1db58	d166201da4304a853498f43cabc922354f3be6a447f65bb74e4acc1881e7f24b	2026-04-23 01:45:21.238644+00	2026-04-30 01:45:21.275102+00	2026-04-23 01:45:21.238644+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
9963a410-fd92-4920-adda-12ba54b15390	07489c05-d7aa-46ab-9346-facd64c2cbc4	ef993d1a1b111c4a87befc95dad0c6f3c41b00beb1afcb9da5aa32cacc664af3	2026-04-23 01:46:02.153821+00	2026-04-30 01:46:02.135422+00	2026-04-23 01:46:02.153821+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
ed473fe3-04b3-4ff1-991d-42bc8553f6b1	07489c05-d7aa-46ab-9346-facd64c2cbc4	a02bf843bcc73e318208181101214f0a640f21d1da8e8948bc8bac5a87623c90	2026-04-23 01:46:41.893618+00	2026-04-30 01:46:41.908231+00	2026-04-23 01:46:41.893618+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
541ac698-9b19-441c-9d48-d51afa70da1b	07489c05-d7aa-46ab-9346-facd64c2cbc4	2ea3fd948e73a0f25b8c438ed3c9808bc45aa38ff33d1a67f18f69566fb1143f	2026-04-23 01:46:58.658903+00	2026-04-30 01:46:58.671919+00	2026-04-23 01:46:58.658903+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
d82fbb63-4b40-481f-97d0-c64494802c19	07489c05-d7aa-46ab-9346-facd64c2cbc4	b2fc005b029fcfd069048893ac600d62486c40308f3014913f398d9ec3980c33	2026-04-23 01:47:14.457327+00	2026-04-30 01:47:14.470729+00	2026-04-23 01:47:14.457327+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
5296777d-5754-4b9f-b8d9-fff8684b5959	31c74efc-432c-4d51-8da8-9e603bbd2778	0aa591718b51f1b663ceb8de4642ba1a933e8266df3187e21227bab9468756d3	2026-04-23 01:47:27.785374+00	2026-04-30 01:47:27.767016+00	2026-04-23 01:47:27.785374+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
4d8799e1-a9b0-4c76-b7c2-6335234ac24b	31c74efc-432c-4d51-8da8-9e603bbd2778	b4b61e6caaab2f97fc410d1f3cb03130c8f9b9a74a12f8ded778fae38c9a7d4e	2026-04-23 01:48:10.75761+00	2026-04-30 01:48:10.804753+00	2026-04-23 01:48:10.75761+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
c257065f-c352-4e57-84b5-b6d8376fb884	31c74efc-432c-4d51-8da8-9e603bbd2778	d7cc114d6ad555b111d6668bace63ba3af0f5bc9e62e6ee13b9c1a31ffc0f962	2026-04-23 01:48:30.460457+00	2026-04-30 01:48:30.473085+00	2026-04-23 01:48:30.460457+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
c88cd22b-01fe-450e-bbd2-06f87652fdc8	31c74efc-432c-4d51-8da8-9e603bbd2778	b27a58deb6a0a7a9dc4f165f25d3788f063bebc67094308185669f0c7a07020c	2026-04-23 01:49:13.464014+00	2026-04-30 01:49:13.476982+00	2026-04-23 01:49:13.464014+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
db5baf2f-33b7-4922-a812-ee874bdb409a	31c74efc-432c-4d51-8da8-9e603bbd2778	5d6ce4d3ae44af6caa3f9053056bf8f6d0e54341fa00d7d93eb617057fbe94eb	2026-04-23 01:50:09.760126+00	2026-04-30 01:50:09.792964+00	2026-04-23 01:50:09.760126+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
8ced6c2d-9149-4398-ba8d-c277ec00ee5e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	710e969b1aa9d4e7daa05921d7044b737fb76a36eadec2b170a7dfc842561403	2026-04-23 01:50:36.46685+00	2026-04-30 01:50:36.444383+00	2026-04-23 01:50:36.46685+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
8d1d0fff-51a0-4ce2-8ce8-3c1bc2b2f827	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ee9c362ce180b3e299bf6163a7f60b8d56aa24a8addda71be9fb99e2338c4576	2026-04-23 01:50:42.288918+00	2026-04-30 01:50:42.306966+00	2026-04-23 01:50:42.288918+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
d8e301f7-853c-4bd0-9af5-f62972a7272a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	712100ed53f746cbef889904cd39fa43464b0ca13b4803400f9b70c99310ceb9	2026-04-23 01:51:11.18006+00	2026-04-30 01:51:11.192945+00	2026-04-23 01:51:11.18006+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
97e7c582-4c8d-44fa-819d-5c384abfe1e2	dbf65721-7b73-4906-a5d0-18fcd7b1db58	845abc27b8acccd7ddd2a01a980a1e35ad1274a01fa4556451fd5315149e59d0	2026-04-23 01:53:37.124238+00	2026-04-30 01:53:37.230851+00	2026-04-23 01:53:37.124238+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
ba1e0a50-9160-463b-bc51-0a9bbf0d2d5c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0e75497ec297300e452371370a47d5291b3323b2389c0faa5dd946457f135548	2026-04-23 01:56:04.294246+00	2026-04-30 01:56:04.306589+00	2026-04-23 01:56:04.294246+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
0a391ad0-1358-4494-b124-1630898523cb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ff3d4c1f2d4b84a80517e1d290b030f4115da94c070b2000d5adb8eeab21e8c6	2026-04-23 01:56:12.629762+00	2026-04-30 01:56:12.611624+00	2026-04-23 01:56:12.629762+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
6948b4c0-fd83-4c15-bb0c-95d89710afb7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	275a15589c0fb842041448d423f641c37c4e6da9c832eef7304f12ff4cdcf2d0	2026-04-23 01:56:17.439391+00	2026-04-30 01:56:17.451827+00	2026-04-23 01:56:17.439391+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
59510120-e812-42aa-8353-f4886bc22061	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1a7448ba0820030622924c53a4fac1bf4600151d00d1dc0e9cd193e1de0f1176	2026-04-23 01:57:14.333327+00	2026-04-30 01:57:14.346024+00	2026-04-23 01:57:14.333327+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
9622c82e-68f7-46bc-bb45-c84c0e3f61f9	31c74efc-432c-4d51-8da8-9e603bbd2778	d6a3f4a8c6bb5b494af96d4c1f9b5c3fa3cd3ef8e17950babc95782d4bd4a8cc	2026-04-23 02:26:26.812089+00	2026-04-30 02:26:26.777375+00	2026-04-23 02:26:26.812089+00	::1	curl/8.7.1	f
bcedb4e1-b5c7-421e-8d2f-787631f9231e	31c74efc-432c-4d51-8da8-9e603bbd2778	f65bf364598fb31c2252c52d049954e0e5de6a989870223f91ae411224b44939	2026-04-23 02:26:39.34137+00	2026-04-30 02:26:39.323885+00	2026-04-23 02:26:39.34137+00	::1	curl/8.7.1	f
2bb6f3f7-6f7d-490c-baad-5b204d976525	31c74efc-432c-4d51-8da8-9e603bbd2778	175b054e0dd4172e5ba524dc52edee225babaf80f36488595cf015402b60a345	2026-04-23 02:27:03.941977+00	2026-04-30 02:27:03.924526+00	2026-04-23 02:27:03.941977+00	::1	curl/8.7.1	f
b2aface8-21d6-4d1f-a509-82c1cbdcf315	07489c05-d7aa-46ab-9346-facd64c2cbc4	3f9d1dea2e15fc65f2344b21814ec57c449dadfb517c5acbd6cef1a5b8f27ff6	2026-04-23 02:01:27.844315+00	2026-04-30 02:01:27.826067+00	2026-04-23 02:01:27.844315+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
e8cc39bb-0187-4c0f-baa6-8bd6421af630	07489c05-d7aa-46ab-9346-facd64c2cbc4	67ead59f4632d882b433cbedf89ab6ff89c3b0fbb7492117e9147d2edd6c454b	2026-04-23 02:01:32.573967+00	2026-04-30 02:01:32.596788+00	2026-04-23 02:01:32.573967+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
71d8002f-5e5b-41ac-9d50-22f8a6a9a2c3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9e27685168e9daa4998b73b5f3518e13482af5c4eaded52e270723b1d94cf979	2026-04-23 02:01:44.506672+00	2026-04-30 02:01:44.488472+00	2026-04-23 02:01:44.506672+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
a20d9072-bc7c-4906-bb08-dd3b83da9a32	dbf65721-7b73-4906-a5d0-18fcd7b1db58	2443145feac8f43c98c85a267c0b6ccaf264fa77c81caf3829e32b82022feb08	2026-04-23 02:01:50.188381+00	2026-04-30 02:01:50.201387+00	2026-04-23 02:01:50.188381+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
6616ae90-21d2-4ee8-b547-70f698310dd5	dbf65721-7b73-4906-a5d0-18fcd7b1db58	af997e65001c911f7f609041ea3ee2095b28a1a517b079afe87b684d66398a97	2026-04-23 01:41:59.516956+00	2026-04-30 01:41:59.48319+00	2026-04-23 01:41:59.516956+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
47e479f2-8602-46ed-ad92-9244e4863353	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1398c78127f9be235856483b1a13650e396623e2a08f95a07e45e9dd76d433c3	2026-04-23 02:48:29.615127+00	2026-04-30 02:48:29.682852+00	2026-04-23 02:48:29.615127+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
24df9b48-6d0d-480a-86a1-881389ff2f21	dbf65721-7b73-4906-a5d0-18fcd7b1db58	b24ffe9d43a163db464cf86e64419779785c9faf13ae8ca11f4326fe48e3aeb2	2026-04-23 02:48:29.749623+00	2026-04-30 02:48:29.804+00	2026-04-23 02:48:29.749623+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2502fb1d-1334-4b79-8dbe-72134d288f35	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e3bda2907a8cf565a4840bc3f2e88a19f671d334b06cbbf6ad1f43feb51dfb40	2026-04-23 02:49:04.024728+00	2026-04-30 02:49:04.069039+00	2026-04-23 02:49:04.024728+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
54d97a31-e513-4f73-bbc1-72755031a7d8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	fcc6aded4e47c6b844b573b7450e3638beadd054c398ec81960104f0dfae1565	2026-04-23 03:01:02.332801+00	2026-04-30 03:01:02.373154+00	2026-04-23 03:01:02.332801+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
1f045a9d-4520-4253-b2c1-6ab493eed5a3	31c74efc-432c-4d51-8da8-9e603bbd2778	4f5f90d0152111cecbbecd6a67219c07c60f0f15d5d1a6f58ee3a33e6541c7ce	2026-04-23 03:01:13.655775+00	2026-04-30 03:01:13.62529+00	2026-04-23 03:01:13.655775+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
cb26dec7-9f67-4db0-ad4f-ff9448f49739	31c74efc-432c-4d51-8da8-9e603bbd2778	2f4c2c89edff5555ce29ad16b8b57c9127405a4f43f7f33402c7556d11b8c1ad	2026-04-23 03:01:19.074335+00	2026-04-30 03:01:19.106133+00	2026-04-23 03:01:19.074335+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
b63792bc-f669-491c-9ced-b759ecfa4f4a	31c74efc-432c-4d51-8da8-9e603bbd2778	b6793ac040301ff166df310baf86270d0d5cf1c75a1ce3e5bd38fb525c3430d2	2026-04-23 03:02:51.458289+00	2026-04-30 03:02:51.471791+00	2026-04-23 03:02:51.458289+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
5a46553a-b3c7-4987-b38c-56c163747205	31c74efc-432c-4d51-8da8-9e603bbd2778	ef106881bfa705f924470af7d0dfca7fae0422188fb525c5f8d75f11037ae957	2026-04-23 03:04:49.682756+00	2026-04-30 03:04:49.703086+00	2026-04-23 03:04:49.682756+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
b1893093-ab10-4d3a-bec0-8dc4916c218b	31c74efc-432c-4d51-8da8-9e603bbd2778	fc1cc3503d1af963c981f988d79b306e045d1acf7d436e2527c385f5ec8a04f5	2026-04-23 03:06:20.681581+00	2026-04-30 03:06:20.693999+00	2026-04-23 03:06:20.681581+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
b605fa57-e45c-4f46-8c08-2ce677d2d6ef	31c74efc-432c-4d51-8da8-9e603bbd2778	8f6fda5c5181a853a32301a38660147d64a8d51f38db65e3a40b5fec0eca0d96	2026-04-23 03:06:29.305589+00	2026-04-30 03:06:29.318254+00	2026-04-23 03:06:29.305589+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
5688b89c-d033-4313-82e5-8ec45323a9e1	31c74efc-432c-4d51-8da8-9e603bbd2778	daafc9dad25b94a3a8f3f49fa1fa5b6eda669ad94d6c5908f57d79edb957032f	2026-04-23 03:07:09.154897+00	2026-04-30 03:07:09.170214+00	2026-04-23 03:07:09.154897+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
e90bd6a1-81f7-4d5f-9730-fab587a122a3	31c74efc-432c-4d51-8da8-9e603bbd2778	4bcb7dfb2dd38050a35b41eb43d630c498d6755b6928debe58c8a16a08a52141	2026-04-23 03:26:12.663924+00	2026-04-30 03:26:12.706777+00	2026-04-23 03:26:12.663924+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
acf23025-8a19-4233-9c84-220a92f4247c	31c74efc-432c-4d51-8da8-9e603bbd2778	0f334721e457663ddd32e985642dae6b03fdb530e64cd226c533b003b6096c45	2026-04-23 03:26:40.767812+00	2026-04-30 03:26:40.782216+00	2026-04-23 03:26:40.767812+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
04bb10ec-cdf5-4dcf-a761-6b3b11f46a1c	31c74efc-432c-4d51-8da8-9e603bbd2778	2915a02b5a0841e036328d9272386d6ab26100236615c42b12426f7dfc34f0ef	2026-04-23 03:28:21.034438+00	2026-04-30 03:28:21.063977+00	2026-04-23 03:28:21.034438+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
e54a2f48-f4df-42af-908c-8ed2918f6c83	31c74efc-432c-4d51-8da8-9e603bbd2778	5ff02eff45d93b6d611f0e5a0630959f15f959962d922a7569306cfcf5bd783e	2026-04-23 03:29:15.596445+00	2026-04-30 03:29:15.579519+00	2026-04-23 03:29:15.596445+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
fb4d115b-2995-4af5-8938-1a7a8c9c528a	31c74efc-432c-4d51-8da8-9e603bbd2778	9d4364475c85fdbabd4b893a4ac371cf0207306f90624a2d25f604a55c4bb235	2026-04-23 03:29:26.481592+00	2026-04-30 03:29:26.494929+00	2026-04-23 03:29:26.481592+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
29f384b3-8fbb-42c2-a491-c85d99546d41	31c74efc-432c-4d51-8da8-9e603bbd2778	1e27d01bf40ed25257f3717788d3e6e2c430c5c8b278c9ad15da72a3b34ec826	2026-04-23 03:30:36.402326+00	2026-04-30 03:30:36.415605+00	2026-04-23 03:30:36.402326+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
d5d391ff-aa18-424e-a85b-d084735612eb	07489c05-d7aa-46ab-9346-facd64c2cbc4	5ace7c3744d997c0be7f8dd244757d92d0050514d32572951636aa230a9a83ad	2026-04-23 03:31:49.183328+00	2026-04-30 03:31:49.166494+00	2026-04-23 03:31:49.183328+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
3822ed97-80d2-46cf-9517-c677cbd1ffb0	07489c05-d7aa-46ab-9346-facd64c2cbc4	d35477670be7231ca9430bade2b8a512b509593a8b3d5bac1bb4222efd67915a	2026-04-23 03:31:54.2817+00	2026-04-30 03:31:54.299121+00	2026-04-23 03:31:54.2817+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
83aae36f-65df-442f-ba01-59fbfdb6c007	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ce42dd3547705ac066191ed6c9d99387f5aeb48cceb653dcfad27c59b6a831bb	2026-04-23 03:32:30.617385+00	2026-04-30 03:32:30.599776+00	2026-04-23 03:32:30.617385+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
a3ec36b2-9891-49d5-a914-a4f5ab0ae39a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6476bc8832455aca82380f6d3674058e1647231ca22c6a174a5f60cc3b494adb	2026-04-23 03:32:35.176242+00	2026-04-30 03:32:35.19016+00	2026-04-23 03:32:35.176242+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
f7c5215e-9eb1-4d95-88d6-4c02d3aafa3b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	dd502aa521b104c31d357814fc388b61e4645e45d865d0d2b0521075d9bc876b	2026-04-23 02:49:04.04387+00	2026-04-30 02:49:04.083151+00	2026-04-23 02:49:04.04387+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
458b614d-8070-4a75-9c69-e91e5a7e39a9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	f32095dfa43cd37a883a18dc3cf28f63d91c50098c3e9a8679308b1d3336ea0e	2026-04-23 03:56:05.595454+00	2026-04-30 03:56:05.63356+00	2026-04-23 03:56:05.595454+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
08dd4acc-4091-4a61-b2ff-16afcb882311	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e8a8d6160fb3829757414e17643669ed02e003c77fd7414cca79300a3bb02a41	2026-04-23 04:04:29.826827+00	2026-04-30 04:04:29.851306+00	2026-04-23 04:04:29.826827+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
4a42f6e0-2aa8-46a9-8b9c-1a39cfdbbab7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	969287d907afe9aa0b924dfcb0c7c63cabf6a98de85c704672ca91be45f4eb3f	2026-04-23 04:12:13.525027+00	2026-04-30 04:12:13.541012+00	2026-04-23 04:12:13.525027+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
310b5692-978b-4562-a5a2-258214661a09	dbf65721-7b73-4906-a5d0-18fcd7b1db58	11fdf4886a9a92ea043a42815fc7f4231aa6944c16495983c2083f255a6bf380	2026-04-23 04:12:22.364543+00	2026-04-30 04:12:22.39397+00	2026-04-23 04:12:22.364543+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
eca06e5b-0490-446b-bad6-2e6b152ac879	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e94421239d509c54cf5084b61f3e25941f962b26148224a751755e583317a981	2026-04-23 04:23:07.327122+00	2026-04-30 04:23:07.385756+00	2026-04-23 04:23:07.327122+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
6b0d4984-51ec-428a-80f6-e21c5871701b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a2c100193d336ba1f7f3e317d07cbee3f044fb11b5408957a96f0b00d12a6ac1	2026-04-23 04:24:25.245012+00	2026-04-30 04:24:25.278448+00	2026-04-23 04:24:25.245012+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
d714ed72-1b0b-4629-85c7-bcf29d022de0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5d6bb93280811c2591bf4e7573ed80aee123076b7242218533986fb6c8413cdc	2026-04-23 04:30:27.34215+00	2026-04-30 04:30:27.363543+00	2026-04-23 04:30:27.34215+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e098be15-a9d1-42e7-9805-7281f2820098	dbf65721-7b73-4906-a5d0-18fcd7b1db58	7a76f881fb0fc2c76a2e58e62825b0d31ae967a3c6d5b603e64f4f65fb741652	2026-04-23 05:16:46.695349+00	2026-04-30 05:16:46.6794+00	2026-04-23 05:16:46.695349+00	::1	curl/8.7.1	f
1f2e0284-0894-4355-936d-4745f8f71929	07489c05-d7aa-46ab-9346-facd64c2cbc4	51bee2734aa84ecc368a36fc3015234efca4da1a9dc9109fe745dd16c07c65f7	2026-04-23 05:16:47.018879+00	2026-04-30 05:16:47.003794+00	2026-04-23 05:16:47.018879+00	::1	curl/8.7.1	f
dea3563b-51ee-40e7-8104-1a5439ec5f1d	31c74efc-432c-4d51-8da8-9e603bbd2778	de3c651a6f5a3ee4058d01b9aa281f6040f7dd271b21652aedbd0c984848fb55	2026-04-23 05:16:47.343002+00	2026-04-30 05:16:47.327875+00	2026-04-23 05:16:47.343002+00	::1	curl/8.7.1	f
662bb356-b254-4ee3-988f-741de16b7096	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e801ff8c096e3b12055fd365f774ce62d4159e9c76d25f1b26e223dcf6c5f75d	2026-04-23 05:20:15.607128+00	2026-04-30 05:20:15.578029+00	2026-04-23 05:20:15.607128+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
d0f6c187-782f-4d77-bcfc-bea5c7f17f12	dbf65721-7b73-4906-a5d0-18fcd7b1db58	afbd9da6142c6773f27b004f1c5589670c531fd8f814c42a711967c283c4dede	2026-04-23 05:21:35.879433+00	2026-04-30 05:21:35.863969+00	2026-04-23 05:21:35.879433+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
909bd8ff-b236-43d5-b890-2bfd54339ad6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	81d040610a01b54e67cbbfbc7e96e1ded76b00a5317447e51cf533e84d2c4ba8	2026-04-23 05:21:42.862719+00	2026-04-30 05:21:42.847377+00	2026-04-23 05:21:42.862719+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
1742d0c8-28af-4003-a45b-3051cd5aec75	dbf65721-7b73-4906-a5d0-18fcd7b1db58	673ef6a8583f8078e8f31fb59b8a1acda0546cffed5dc90c8c853bc3138657d7	2026-04-23 05:21:43.767485+00	2026-04-30 05:21:43.795378+00	2026-04-23 05:21:43.767485+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
81ba68fa-e1d2-4ce0-8f0f-1924d2e8e1b0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	121aa7ec796571a48f075bc777637b9001e45452359553fb155d4935b2b0cd1b	2026-04-23 05:23:28.744528+00	2026-04-30 05:23:28.71428+00	2026-04-23 05:23:28.744528+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
6252a062-527d-4fda-97d8-3aa5c56fb5e7	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9f455b537f50820d2447ded02518c9af4bb1d389212551cae66c68b657a72d9e	2026-04-23 05:23:29.672834+00	2026-04-30 05:23:29.706202+00	2026-04-23 05:23:29.672834+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
01371ff9-af05-4a6e-bad2-b3046d4d6321	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e6504b1dba6d8e5f86cb2f345737bd2928d6858ded55c0dacd09f91f1b9be7b8	2026-04-23 05:23:36.099186+00	2026-04-30 05:23:36.069961+00	2026-04-23 05:23:36.099186+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
8fba437c-4ae7-4075-a3de-7f91988e30bd	07489c05-d7aa-46ab-9346-facd64c2cbc4	465dc8c09f27ab259d9983c66946f0e8fa30256f7c85c3de569d6d7b2ba3d5d4	2026-04-23 05:26:28.464765+00	2026-04-30 05:26:28.444467+00	2026-04-23 05:26:28.464765+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
74699282-44fd-4ecd-b345-ec1aa855f2e5	31c74efc-432c-4d51-8da8-9e603bbd2778	9318eb302f285eeaa46dca92f817c3a283989947a28571405a022c1b8284737c	2026-04-23 05:25:45.261279+00	2026-04-30 05:25:45.228057+00	2026-04-23 05:25:45.261279+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
b585dd0a-3ce0-49fc-b5f2-2419d03efc2c	31c74efc-432c-4d51-8da8-9e603bbd2778	b3a2551f362a247f974340626474ea4c3b54f1cb32155e87a97e414069e7afbf	2026-04-23 05:25:47.201622+00	2026-04-30 05:25:47.231794+00	2026-04-23 05:25:47.201622+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
4889112e-661e-4f38-ac6d-9c845bac0052	07489c05-d7aa-46ab-9346-facd64c2cbc4	fe6f6e8e2afb2b9c7f6ada9e1ae311d208edf2e7821995ed22802cf0383f83bf	2026-04-23 05:25:47.715792+00	2026-04-30 05:25:47.70076+00	2026-04-23 05:25:47.715792+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
a3b57eba-9220-4eb9-b49c-f88bc28c5aeb	07489c05-d7aa-46ab-9346-facd64c2cbc4	9be4cddef8c638c9ea9b82062c70a53b96861f8858ec02b70d142550d3fd6121	2026-04-23 05:25:49.135779+00	2026-04-30 05:25:49.163321+00	2026-04-23 05:25:49.135779+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
9420f28c-f921-413b-896e-f7ee45b12838	dbf65721-7b73-4906-a5d0-18fcd7b1db58	bc501fc2b1521b62ec7808fe4acbe54c137275042f52f5b3a2238d5c5b781ebb	2026-04-23 05:25:49.601598+00	2026-04-30 05:25:49.586103+00	2026-04-23 05:25:49.601598+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
f582292b-4030-4372-8d66-bafa79081199	31c74efc-432c-4d51-8da8-9e603bbd2778	8e5856c25490159e83787aafcc25749945e790f7b064835996ba60a235f03473	2026-04-23 05:26:25.981651+00	2026-04-30 05:26:25.951803+00	2026-04-23 05:26:25.981651+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
765a3a94-aedd-4701-ab79-b4849a72cc8f	31c74efc-432c-4d51-8da8-9e603bbd2778	74fac6f81f355a32e09befe53b5b8621c7a5e4643aadc1e5c9daa86b82bbf2c2	2026-04-23 05:26:27.914234+00	2026-04-30 05:26:27.941977+00	2026-04-23 05:26:27.914234+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
da2bb775-3d36-4e11-a7fe-a8f7d740f751	07489c05-d7aa-46ab-9346-facd64c2cbc4	76a56d3d63a6bc8881adc31f5caa889212f28e6c8fdbba3e07d9549c40e2f292	2026-04-23 05:26:29.873969+00	2026-04-30 05:26:29.910643+00	2026-04-23 05:26:29.873969+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
0b30c540-54af-4b61-85eb-59fb15bfeb65	dbf65721-7b73-4906-a5d0-18fcd7b1db58	923cb7ef11ff6f4bd928284e974f7f2eb7df3a24c1b73c207535e9fb0020292e	2026-04-23 05:26:30.370503+00	2026-04-30 05:26:30.354952+00	2026-04-23 05:26:30.370503+00	127.0.0.1	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
bd99254c-1da4-4806-81db-b24ad4216e1e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	dbbcd40ef1d1ac2468a5c5cca0f0552282b40b2df55463dd2bfe15af98af1d7a	2026-04-23 04:25:26.563857+00	2026-04-30 04:25:26.577671+00	2026-04-23 04:25:26.563857+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
e41018a8-fd2c-426f-8b39-f8716440b54b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5719ca70060a01247a7ac1f669ade6f7f20665f80cef9ce53e0dd7f58db4777b	2026-04-25 12:56:59.901027+00	2026-05-02 12:56:59.846829+00	2026-04-25 12:56:59.901027+00	::1	curl/8.7.1	f
49c0898e-8e96-42c9-96fa-df65fb10f321	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a40ecf282f148ddbaff45d93713a52c338dc3d6850c7104eea73b662b003f0bb	2026-04-23 05:16:08.806539+00	2026-04-30 05:16:08.777548+00	2026-04-23 05:16:08.806539+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1486ea4b-3db0-4028-9664-852f2a216d07	dbf65721-7b73-4906-a5d0-18fcd7b1db58	0a2654ca066e656df45d99f3c3c2547b692020f75a924deede31f9741e744095	2026-04-23 06:26:45.075913+00	2026-04-30 06:26:45.10601+00	2026-04-23 06:26:45.075913+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a8af143d-1954-41f6-b9e4-060d1af65adf	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a6d2938e8ec777aca2d1d5764a6977ed8795c8c3416c85b183bd746c5db71303	2026-04-23 06:36:08.178722+00	2026-04-30 06:36:08.194084+00	2026-04-23 06:36:08.178722+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
3b18997e-f1b2-49e1-9440-0986460b1d24	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a18c8ba0e755df78178791f0df688247d9659c3b7f4c37acc054f93b353030aa	2026-04-23 06:36:16.887183+00	2026-04-30 06:36:16.915599+00	2026-04-23 06:36:16.887183+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
8885d02a-ad4a-4761-b415-797e9e59690c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ab35c132bf3ea7e2a05c1558a0b5c579f48295be0556e5ade3588495ab232d4f	2026-04-23 06:36:31.814676+00	2026-04-30 06:36:31.828652+00	2026-04-23 06:36:31.814676+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c10a0dd4-baff-48c7-96c2-89755f4895b9	dbf65721-7b73-4906-a5d0-18fcd7b1db58	68ebe863ddc4ffd77aac9611a4ce688b098e3b05203cd557ccabf4e438e276ff	2026-04-23 06:36:42.727364+00	2026-04-30 06:36:42.738772+00	2026-04-23 06:36:42.727364+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b6bfc076-3941-4d55-91eb-30689ed575d3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	c412a3bf1201496a388754290cd830f0b99e6e09ee9538dc372dad70b6cd895a	2026-04-23 06:36:59.70895+00	2026-04-30 06:36:59.720768+00	2026-04-23 06:36:59.70895+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0368fb64-07be-4df2-b86e-4c40720c0112	dbf65721-7b73-4906-a5d0-18fcd7b1db58	50bfdf23b61d33b95cd6aabd5f990350e04b242e616a1345f58a08b475c5c53a	2026-04-23 06:37:03.9195+00	2026-04-30 06:37:03.932407+00	2026-04-23 06:37:03.9195+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
dae8eedc-222f-4953-9f4f-266291149b55	dbf65721-7b73-4906-a5d0-18fcd7b1db58	05094095aae773e7aee5f1c099782fbdf6ee04b00a34d339d463adcae45d669d	2026-04-23 06:37:18.87084+00	2026-04-30 06:37:18.882697+00	2026-04-23 06:37:18.87084+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
3bb35c03-20b4-4c39-b13d-bf40020a0b4a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	2736b7b056c3bdd29576eefc5cbeb947d03a09c80af074421a9f88153ae820d3	2026-04-23 06:37:24.834544+00	2026-04-30 06:37:24.851245+00	2026-04-23 06:37:24.834544+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2d6e7f05-5133-4738-83ee-388f2eb5abd4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	65adc1a30e65f938ab7b01cf7af54434031438f06c01f718663591f6217302d3	2026-04-23 06:37:32.322309+00	2026-04-30 06:37:32.333885+00	2026-04-23 06:37:32.322309+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
af0af32d-c5c7-4b92-9b46-703f42e4b97c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	281d469e2541c2b5526f4bea47219cde9e98c86fed1e4546baf8802d8677a997	2026-04-23 06:37:41.311337+00	2026-04-30 06:37:41.327043+00	2026-04-23 06:37:41.311337+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
304ab280-f013-4a8a-ae66-70241c2390bc	07489c05-d7aa-46ab-9346-facd64c2cbc4	e95f7f572285217dddb47216bc918fe26dd7b64928a9f898153016f8bf408568	2026-04-23 06:44:13.40655+00	2026-04-30 06:44:13.373693+00	2026-04-23 06:44:13.40655+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f2e73586-1b22-405f-987a-6395eed47488	07489c05-d7aa-46ab-9346-facd64c2cbc4	5dc4cf911d9e0c171705b800970aa13aeb2212aa007bb48c2ab013b9bcd94dc9	2026-04-23 07:16:10.295822+00	2026-04-30 07:16:10.326384+00	2026-04-23 07:16:10.295822+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2fd42cbd-a382-439d-9532-aa991c554faa	07489c05-d7aa-46ab-9346-facd64c2cbc4	e19e020fd3ffe8ea8108dfbdb42597ebbff639546f2b7a76ef115cff02a900d1	2026-04-23 07:16:19.295322+00	2026-04-30 07:16:19.262538+00	2026-04-23 07:16:19.295322+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f235c915-27e0-4eda-ae12-ef8db6c4cc14	07489c05-d7aa-46ab-9346-facd64c2cbc4	4fe5f000798d0357836389bae5a9b084acba2b390743f0732d41cf9ac8546b9a	2026-04-23 07:33:35.896265+00	2026-04-30 07:33:35.928131+00	2026-04-23 07:33:35.896265+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b9448408-4dfd-426b-ba2b-7b0a3d9ad08d	07489c05-d7aa-46ab-9346-facd64c2cbc4	848e41e1eac2a2795facb23b5d4ac49276c4b26050c4d4e26fd854806d2e7361	2026-04-23 07:42:58.205249+00	2026-04-30 07:42:58.218642+00	2026-04-23 07:42:58.205249+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2417a24c-e9d1-4b0e-afe4-e964205f81c2	07489c05-d7aa-46ab-9346-facd64c2cbc4	7f4ab0d8a6225cada98f6197111d3b5de6972f9271a3aa16640fbcccad7468e6	2026-04-23 07:49:00.837471+00	2026-04-30 07:49:00.853261+00	2026-04-23 07:49:00.837471+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4502222e-616b-4cee-8be6-b60ff3e6f85d	07489c05-d7aa-46ab-9346-facd64c2cbc4	f54453af05ff4563da879027ca3d386de2d1944e9457946e5289f510b8451ea2	2026-04-23 07:53:10.942105+00	2026-04-30 07:53:10.955616+00	2026-04-23 07:53:10.942105+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1181f079-fcd6-4fb6-b301-14243dab191f	07489c05-d7aa-46ab-9346-facd64c2cbc4	51047bd4a2a8a322059df5e3bfe7e501e3d23ff6f424d22221ef9ef39ec505e9	2026-04-23 07:53:17.686468+00	2026-04-30 07:53:17.717987+00	2026-04-23 07:53:17.686468+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b0b5d9d2-c2ad-408c-ad75-d1039f5d83ca	07489c05-d7aa-46ab-9346-facd64c2cbc4	9af0a852f59db707abcb85e5b4b6d71236bff66736abbb4138f4031a0887c693	2026-04-23 07:58:31.414141+00	2026-04-30 07:58:31.432038+00	2026-04-23 07:58:31.414141+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6e320955-2e10-4406-9641-a611c2285e2e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	4b9453cf50bbab0093b4503f55ae6d925b292ce6c396dfb4f2fa7b3b6f2fc5e7	2026-04-23 08:14:58.90207+00	2026-04-30 08:14:58.932554+00	2026-04-23 08:14:58.90207+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
f402357a-ef17-426b-96a8-e0356c91b547	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e5011f8884eb0931dff47d45f6bc566631cb867f48dd8b93ebf54661af3f84ea	2026-04-23 08:19:49.127527+00	2026-04-30 08:19:49.142203+00	2026-04-23 08:19:49.127527+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
82c80601-6165-465f-b6f5-37deca67d9bc	dbf65721-7b73-4906-a5d0-18fcd7b1db58	802ea198295a7d1e6ccf0f609a4a4a795a3fa1bf75eb1e67ebc8b6b7b96b7c2d	2026-04-23 08:19:53.631897+00	2026-04-30 08:19:53.647517+00	2026-04-23 08:19:53.631897+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
ec688f84-fe03-4f06-acbe-fe6863b2652a	07489c05-d7aa-46ab-9346-facd64c2cbc4	d5e0a62c6458d1490962cbe3f7efb91ad9e90d73bf558351f86f07217065058f	2026-04-23 08:12:57.284178+00	2026-04-30 08:12:57.300316+00	2026-04-23 08:12:57.284178+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d117e3ac-2a66-42ea-8fd1-c7ccaadde32f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	984f9e0c0f19c0f4e93df711cfc00311b4d9bb3333e97f2c80a06e1010990777	2026-04-26 18:57:26.041571+00	2026-05-03 18:57:26.006626+00	2026-04-26 18:57:26.041571+00	::1	curl/8.7.1	f
022308b6-d8b7-4140-8185-3a8b2bcd3516	dbf65721-7b73-4906-a5d0-18fcd7b1db58	255770ca8f25be23667a83fa605e540d5d597c36443e07144d9cf6f0d31c148d	2026-04-23 08:28:59.160212+00	2026-04-30 08:28:59.177204+00	2026-04-23 08:28:59.160212+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
2f9fa792-141b-4de0-b637-5fd93bb86dfd	dbf65721-7b73-4906-a5d0-18fcd7b1db58	f259ecef6a3f9fcd941823a0a5e302e32a16f99ec2662d853d73767012b70970	2026-04-23 08:34:54.090575+00	2026-04-30 08:34:54.104753+00	2026-04-23 08:34:54.090575+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
3879b2e2-5ca4-40e0-9e9f-9e161c238484	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1ebe2d539fa73595d051ece839bd708198b8b173bc7fe4aab4891b21dd583fec	2026-04-23 08:37:06.840558+00	2026-04-30 08:37:06.868814+00	2026-04-23 08:37:06.840558+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
477f1eca-18b8-4ab3-ae71-d74de994d503	dbf65721-7b73-4906-a5d0-18fcd7b1db58	d85d84848ea41601a0fb339572db56811b302d70f90fb4eff9a191e6d401487f	2026-04-23 08:39:38.866477+00	2026-04-30 08:39:38.880981+00	2026-04-23 08:39:38.866477+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
b7ec226b-d5d7-4bca-8ff5-740cedba5f5f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a6b6f868722e7367b823bf3bec0dda1fb208a29d214a5d2348922c9d2d04bb65	2026-04-23 08:40:19.179327+00	2026-04-30 08:40:19.219806+00	2026-04-23 08:40:19.179327+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
0c71d2d4-04bd-4346-9dac-30e2edca69f3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	f01376ca86dd554efbfb632a0a84050691aae17c927370e2f471a91d65620cab	2026-04-23 08:40:58.103547+00	2026-04-30 08:40:58.118646+00	2026-04-23 08:40:58.103547+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
9ad45fd3-5457-4dff-964b-2231527fa7b7	07489c05-d7aa-46ab-9346-facd64c2cbc4	463b7c85b1fa22a3326e7cf183207df7c2038ce81b11984cfa70b90dadf9dbfd	2026-04-23 08:59:00.957916+00	2026-04-30 08:59:00.924103+00	2026-04-23 08:59:00.957916+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4bb73912-50b7-473a-8f2f-e0a17f84f971	07489c05-d7aa-46ab-9346-facd64c2cbc4	0c1ceeaf9acb5b224834e2cd15baf1d3bb8322838aa4822f9e8d4ef868cea357	2026-04-23 12:08:41.561777+00	2026-04-30 12:08:41.625967+00	2026-04-23 12:08:41.561777+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
000b280c-05f9-4a52-a75c-699b308e1f0a	07489c05-d7aa-46ab-9346-facd64c2cbc4	41a28391713c050b4301a4ee429bc0243637405deb0d68098ecbbad0999bde99	2026-04-23 12:15:32.738105+00	2026-04-30 12:15:32.774241+00	2026-04-23 12:15:32.738105+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
a6cd7094-3b39-4787-bcf6-392a78c6619f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	750af67eb4695598bf2b854842552a5c417538b04da78b1b4bb2fca45cc9e07c	2026-04-23 12:36:40.399125+00	2026-04-30 12:36:40.345226+00	2026-04-23 12:36:40.399125+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1bdc153a-d5e3-4e45-b852-001567ef3521	dbf65721-7b73-4906-a5d0-18fcd7b1db58	797845cf61890d67166ca7b983868143454bd6fd61d7c3ad27f499c4c872e228	2026-04-23 12:42:36.372746+00	2026-04-30 12:42:36.422943+00	2026-04-23 12:42:36.372746+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
830b164d-166b-4e38-bd7b-530077cf25a2	07489c05-d7aa-46ab-9346-facd64c2cbc4	a216b04065203bfbcad21987d8d885efdc211e2417c7b204ff4bfd7a602c6c79	2026-04-23 21:09:30.09975+00	2026-04-30 21:09:30.131111+00	2026-04-23 21:09:30.09975+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
36055241-5fe0-46c5-906d-2da573ec5363	07489c05-d7aa-46ab-9346-facd64c2cbc4	0a553ebd7aec19adc1eee86b1909350de716dfa613f5eda439ecade909df497b	2026-04-23 21:10:15.542772+00	2026-04-30 21:10:15.571686+00	2026-04-23 21:10:15.542772+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
459db715-3302-44af-96a7-83bd6ad78b53	dbf65721-7b73-4906-a5d0-18fcd7b1db58	f1194f7aca9c2c9cc2529f08f891e5012e30398330dc763820fd313c19a1607a	2026-04-25 01:09:25.176954+00	2026-05-02 01:09:25.145442+00	2026-04-25 01:09:25.176954+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
771435ee-7e65-40d2-a478-7bd1d7976758	dbf65721-7b73-4906-a5d0-18fcd7b1db58	2f3f4263843963e87158dcdb06d537609cb6ff56b09a8ff6c4f6fccc8641cda8	2026-04-25 01:09:30.620853+00	2026-05-02 01:09:30.648225+00	2026-04-25 01:09:30.620853+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
b23dadd6-b300-4dd8-a33c-d183858632a6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	81cea13f6b5ffc2728c6c2d1ca2929fac9030635a468b873469927cd27194316	2026-04-25 01:10:29.703896+00	2026-05-02 01:10:29.717826+00	2026-04-25 01:10:29.703896+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
a24d1d95-8667-41aa-ba9c-8734f3be64a6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	bb728410a1f0205bdcb06b0a309aa57419802efc1ad3b666cc6377bf71063872	2026-04-25 01:11:19.280038+00	2026-05-02 01:11:19.294077+00	2026-04-25 01:11:19.280038+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
a6149383-54df-4d92-bc74-4bfc31126739	dbf65721-7b73-4906-a5d0-18fcd7b1db58	4a33643c0deed42268d40c628d56f2a459bfa4e9c78f3459309cf84263335f44	2026-04-25 01:23:10.547832+00	2026-05-02 01:23:10.575267+00	2026-04-25 01:23:10.547832+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
badfc5e3-1226-4ca7-a5a6-99fd7434b8fa	dbf65721-7b73-4906-a5d0-18fcd7b1db58	8453842277c13d261162c5da8f374fb098bfce2772bac353bfa80dd697afff84	2026-04-25 01:29:22.819182+00	2026-05-02 01:29:22.832192+00	2026-04-25 01:29:22.819182+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
c7cac6bf-442f-4a84-bfe7-4cc2d8bdda3d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6b8d118b2414a1512289554044c660a70d662787f057bab8848c57e36c7df488	2026-04-25 01:30:36.018536+00	2026-05-02 01:30:36.031356+00	2026-04-25 01:30:36.018536+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
b16902a3-1475-485e-8919-2af7c7b24c31	dbf65721-7b73-4906-a5d0-18fcd7b1db58	f0c0264279e8403e53a97cd2a32e82a5e798f56bf062a9c9fd0c92c56d14d7d7	2026-04-25 00:24:47.467874+00	2026-05-02 00:24:47.43062+00	2026-04-25 00:24:47.467874+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6a3c7637-0914-4f05-ac28-46fd3230a46d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	627e7a18d2a8bbffd220ae4308c05e17e587a70070d727e79a7098e54790d993	2026-04-25 01:40:48.30085+00	2026-05-02 01:40:48.333133+00	2026-04-25 01:40:48.30085+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
84b734ec-25c1-4b39-b856-ac5c60cbd3fa	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6fcadc620c19286a934caa73d040d0a8fa4d79762ad72fb895b5be2b3e265b2f	2026-04-25 01:40:56.390975+00	2026-05-02 01:40:56.403613+00	2026-04-25 01:40:56.390975+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
be5124a9-21f0-4714-85d9-32491dc63cb3	dbf65721-7b73-4906-a5d0-18fcd7b1db58	a9dfc4c19bd9d7764336803e6cc375108774cb1339323808edacb22801b10970	2026-04-25 01:30:38.883907+00	2026-05-02 01:30:38.89613+00	2026-04-25 01:30:38.883907+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
d5a49ec2-631d-4ba0-8f58-a9d4e52397c8	dbf65721-7b73-4906-a5d0-18fcd7b1db58	e54270a632f2b9c9ea0e9dbdbffb8bda944877239558c47df47b2942028160f1	2026-04-25 01:44:47.939377+00	2026-05-02 01:44:47.96808+00	2026-04-25 01:44:47.939377+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
bcc85552-aea9-451a-aa5a-8902c7989700	dbf65721-7b73-4906-a5d0-18fcd7b1db58	657520e66da9a38402ea0218058687eb410a1afea0bddfcb8b5e0be29b679f3c	2026-04-25 01:41:00.358821+00	2026-05-02 01:41:00.372227+00	2026-04-25 01:41:00.358821+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2291dcf3-4f0c-4083-b23c-03963e95c798	07489c05-d7aa-46ab-9346-facd64c2cbc4	1a57f4c025e40e4ee6ad10ce9517acf907ed2a5d661cfd3985f4b7a5dc7d9329	2026-04-27 01:05:34.544085+00	2026-05-04 01:05:34.504484+00	2026-04-27 01:05:34.544085+00	::1	curl/8.7.1	f
63455e92-bfcf-4bed-9c64-131b309c6509	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1b61b30888e4587ec07558ddcea531036d1b5c79c9d946f22a88a8442b242a72	2026-04-25 03:57:05.960035+00	2026-05-02 03:57:06.00298+00	2026-04-25 03:57:05.960035+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c926a5f2-c299-4558-a3b1-ba64aa834f99	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9901c9ba207e24007db9a36e66bbfe52a90b6fe671be0ce76ec78334f593a97e	2026-04-25 04:38:58.701581+00	2026-05-02 04:38:58.737973+00	2026-04-25 04:38:58.701581+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4c6db570-5771-405b-b831-fbc80fae0b9f	dbf65721-7b73-4906-a5d0-18fcd7b1db58	6d0c90d90ba907b32277209912c86ebbbbade4dc7c6c7e05f5320aaea8223d9e	2026-04-25 04:39:44.292531+00	2026-05-02 04:39:44.304158+00	2026-04-25 04:39:44.292531+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bbe36ad3-f7d2-4923-9468-e4b16ddfb139	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ef511301fd7b5982251c4f80d195ad96d1b732bd23b4cd34faa540a3ee52498f	2026-04-25 04:43:29.063673+00	2026-05-02 04:43:29.088853+00	2026-04-25 04:43:29.063673+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1f452fd2-4a45-4eb3-b085-ee7f16b8e54d	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1c77f9d36191e40ccbe493952d1b3e77adc827b9bae24ad24ab805cae2b446ef	2026-04-25 06:21:50.456381+00	2026-05-02 06:21:50.48343+00	2026-04-25 06:21:50.456381+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
94adf537-9b5a-4cb1-ad56-59d5bdab3a0c	dbf65721-7b73-4906-a5d0-18fcd7b1db58	5e91cbf4e7e08ecc16e37dbf54ccf762744f118e137fac42be3b7f5c04611585	2026-04-25 06:21:55.086595+00	2026-05-02 06:21:55.098366+00	2026-04-25 06:21:55.086595+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
85f40b52-947a-41b0-9ee5-837a5ee351f1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9b41a462affb53850f1d03824c9156caba2b7266ebcdd2044c2948ff28f43577	2026-04-25 06:22:04.20435+00	2026-05-02 06:22:04.219254+00	2026-04-25 06:22:04.20435+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e4400def-9b60-4531-a976-cf7bfb7c9cb4	dbf65721-7b73-4906-a5d0-18fcd7b1db58	9e25e184649043c0ce7dcbed95ebe9e550a521133b9c8133166d93b12fdd465f	2026-04-25 06:35:49.703026+00	2026-05-02 06:35:49.732713+00	2026-04-25 06:35:49.703026+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c41950ab-96e7-4ad1-a0cb-6fc34158f5ce	07489c05-d7aa-46ab-9346-facd64c2cbc4	1972cc552c3c3329702216d04977182ea23d0b5f1e3e2aba948959b596cc945b	2026-04-25 06:35:57.263055+00	2026-05-02 06:35:57.244639+00	2026-04-25 06:35:57.263055+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
dea85c9d-f4e6-4e12-a2a9-2035c57325a8	07489c05-d7aa-46ab-9346-facd64c2cbc4	ce719a07afdbac7c8794411352ff957952fce72c51ded1746aa82902bb2b71b1	2026-04-25 06:42:26.520059+00	2026-05-02 06:42:26.553135+00	2026-04-25 06:42:26.520059+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
730d8789-c513-4ef2-a5e1-c244c058fb5b	07489c05-d7aa-46ab-9346-facd64c2cbc4	87afe0feab902d42f17cf658796b800bd3e78a4ca09422d7dd2613c77551995d	2026-04-25 06:42:28.907196+00	2026-05-02 06:42:28.920193+00	2026-04-25 06:42:28.907196+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
758c695e-729e-4bff-adaa-154b8fef6796	07489c05-d7aa-46ab-9346-facd64c2cbc4	cf5bb77d75b08731e3f4dcbcfa37cac519be8931a8e044395c65c3fe2176bf29	2026-04-25 07:29:59.478577+00	2026-05-02 07:29:59.50838+00	2026-04-25 07:29:59.478577+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9796e19f-f4fa-4531-8559-ecdd12dc6cfd	07489c05-d7aa-46ab-9346-facd64c2cbc4	5a19b9ac5bc2d0af6df0cd74a3c7e42a08d537edb2e3baa9b07c1675fb2753a5	2026-04-25 07:30:07.354735+00	2026-05-02 07:30:07.385183+00	2026-04-25 07:30:07.354735+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
78885762-b294-4f17-8e69-bc25ae6a7935	07489c05-d7aa-46ab-9346-facd64c2cbc4	0933d5f5e8e0086a28f3a93991cce565994918bedd45b5ebc296eef4f6f6b75f	2026-04-25 07:31:38.358141+00	2026-05-02 07:31:38.323131+00	2026-04-25 07:31:38.358141+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
3802b41a-462b-41b5-bb7c-4d4f96c7095f	07489c05-d7aa-46ab-9346-facd64c2cbc4	5232a4d3e7b3d598366857d739307c60a72b2c21a8221a273c07f9e30a59e059	2026-04-25 07:34:12.014591+00	2026-05-02 07:34:12.045037+00	2026-04-25 07:34:12.014591+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0ec5c5b7-af64-4dfb-a21e-963435e5a535	07489c05-d7aa-46ab-9346-facd64c2cbc4	7a94e77f2e4513141d1a74c947e760f2b896f7f8d9c3ccd4b2179620253bfd8e	2026-04-25 07:45:07.901322+00	2026-05-02 07:45:07.915024+00	2026-04-25 07:45:07.901322+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c403ec56-47a8-44e0-9f83-c2bcb9ad5b90	07489c05-d7aa-46ab-9346-facd64c2cbc4	424592bcd17e6dd2e10874d5faed4398c8748506f190cb9bbe976e8502049a23	2026-04-25 07:45:37.149022+00	2026-05-02 07:45:37.182229+00	2026-04-25 07:45:37.149022+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
eb83ea0d-98a3-4b2d-b9e6-f4b4b7721497	07489c05-d7aa-46ab-9346-facd64c2cbc4	5936149e2b67b357427ac8b3cb6f1cf36bffbc373039ef81ecf906e9c5d513d3	2026-04-25 07:45:40.093186+00	2026-05-02 07:45:40.122515+00	2026-04-25 07:45:40.093186+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
49c99d3c-73b7-4eff-a9bc-1fb234f16e18	07489c05-d7aa-46ab-9346-facd64c2cbc4	8742d68113eab388ddfb621986788695656548016b0c1360504837cc39c6a03e	2026-04-25 08:25:48.133742+00	2026-05-02 08:25:48.145748+00	2026-04-25 08:25:48.133742+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
63edcfc5-f752-4b71-9571-6336564efecd	07489c05-d7aa-46ab-9346-facd64c2cbc4	fdca6c4434269bc954006ae20dc4ab6015b9a0067f64d4c34f6c6ab6a34cbe4c	2026-04-25 08:37:43.83617+00	2026-05-02 08:37:43.878861+00	2026-04-25 08:37:43.83617+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
46c2b6f1-aa7f-4395-813f-fece7876a6ad	07489c05-d7aa-46ab-9346-facd64c2cbc4	de5dd499e54692f154fafbde54bd80a144423e5d96304ca91c1bad99b7f4970c	2026-04-25 08:53:32.722124+00	2026-05-02 08:53:32.733335+00	2026-04-25 08:53:32.722124+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
82544622-3f75-46bf-a0a5-51e9ad1afbdb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	1a6758e8a8f6a68508004a1d30ad37ec2a58a58aeac8bf9841c4dce4ecea7c00	2026-04-25 01:48:39.895765+00	2026-05-02 01:48:39.925581+00	2026-04-25 01:48:39.895765+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
11303624-966a-4c70-82cc-16d438a3d652	07489c05-d7aa-46ab-9346-facd64c2cbc4	56643da4ef0ae9d88b265316233f6e1c298a4bd70c43a878b560da0b55b9967c	2026-04-25 09:17:33.513686+00	2026-05-02 09:17:33.553688+00	2026-04-25 09:17:33.513686+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
e3a83a8d-abe6-4576-87f1-e1e6a9246b6c	07489c05-d7aa-46ab-9346-facd64c2cbc4	d02fbd97ddef4c92d2f0996c1d802874d8ab392aadc795a99f35e36a6f342cd4	2026-04-25 09:14:34.21671+00	2026-05-02 09:14:34.230222+00	2026-04-25 09:14:34.21671+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
fdbc9bfa-4b75-4153-80c0-e09e9c60ad8f	07489c05-d7aa-46ab-9346-facd64c2cbc4	37c7c2d19933cef43ae5006e1096a17a670d1930ed2fd83676dc77260e2ec750	2026-04-25 09:17:33.5566+00	2026-05-02 09:17:33.630319+00	2026-04-25 09:17:33.5566+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2a214d08-d528-4c23-bee7-081c4e160056	07489c05-d7aa-46ab-9346-facd64c2cbc4	c9d868fb8c77a60508e37e1a0e212fe8788f80e2f012c5cd5bc0e12bac7e6f23	2026-04-27 01:30:52.116091+00	2026-05-04 01:30:52.097024+00	2026-04-27 01:30:52.116091+00	::1	curl/8.7.1	f
44edb04c-3290-4be0-9414-3d6e336825c1	07489c05-d7aa-46ab-9346-facd64c2cbc4	a8e5e2bfb080469253a59c47fa4bce0fbd66ba170c16d85b005607c88fd9f121	2026-04-27 01:34:54.425738+00	2026-05-04 01:34:54.407103+00	2026-04-27 01:34:54.425738+00	::1	curl/8.7.1	f
1669bd7b-60cc-46d0-a3ca-aa8d89481188	07489c05-d7aa-46ab-9346-facd64c2cbc4	dcc5d11ad352134b02771391c10f897e5f6d4802098283406892ca80ac02e452	2026-04-27 01:34:58.124027+00	2026-05-04 01:34:58.105302+00	2026-04-27 01:34:58.124027+00	::1	curl/8.7.1	f
754ccd32-9429-43c6-997c-334dbea0079a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	168f2bc1957596fd70edbd44bc4eac15d71858f1ef5ec0a8267156acda1c0ab4	2026-04-25 09:18:23.544298+00	2026-05-02 09:18:23.557713+00	2026-04-25 09:18:23.544298+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
cd4192ec-2270-4de8-a232-39618643c3f1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	ad8f1b04593cab4e63a3234e2741001d307e07a6148378c75a6797be871a118b	2026-04-25 09:18:43.30041+00	2026-05-02 09:18:43.317957+00	2026-04-25 09:18:43.30041+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
4148cdb7-7482-4b5e-8bdc-a85d9993fc64	07489c05-d7aa-46ab-9346-facd64c2cbc4	1c9665d3f0f0398dc972c9bee009d7a5ea30138ddf2c7beba3e4b61a9bf8a6fd	2026-04-25 09:19:03.321884+00	2026-05-02 09:19:03.289122+00	2026-04-25 09:19:03.321884+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
5088767f-f208-4f30-949d-7493e7e0a326	07489c05-d7aa-46ab-9346-facd64c2cbc4	ce15938383fa7b4c0dcf48a88dd5e0756d3c2fa62b2ebb8df2319e391d7dc8ac	2026-04-25 09:20:45.807636+00	2026-05-02 09:20:45.872809+00	2026-04-25 09:20:45.807636+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9880c3d1-5013-4111-b845-73cd251feade	07489c05-d7aa-46ab-9346-facd64c2cbc4	c0420f0562c126e3c03f7b966fc1567bc631106d1f1adbe2a04872af3eb2feb1	2026-04-25 09:20:45.875883+00	2026-05-02 09:20:45.946235+00	2026-04-25 09:20:45.875883+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
c2c047be-8886-4290-8215-752fafce173f	07489c05-d7aa-46ab-9346-facd64c2cbc4	4a84055156929119f2f563f70c75fd0008dbb806a3ea57be9d4cf6c122dbe179	2026-04-25 09:20:50.87966+00	2026-05-02 09:20:50.949931+00	2026-04-25 09:20:50.87966+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
99810378-2b01-4e26-b2d4-eb67168fb1e0	07489c05-d7aa-46ab-9346-facd64c2cbc4	bdd918f35473f388e533ee69073903f82b797c3c5f71bcb96e01e013d5261df4	2026-04-25 09:20:50.926495+00	2026-05-02 09:20:50.991564+00	2026-04-25 09:20:50.926495+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
632091d7-90aa-41b4-b808-0e6e19c4057a	dbf65721-7b73-4906-a5d0-18fcd7b1db58	d3f161dbf38b0db69f92cbb6653c9e1431187f00b72d243d6f10bdf489eb55de	2026-04-25 12:57:14.414556+00	2026-05-02 12:57:14.385719+00	2026-04-25 12:57:14.414556+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f57a580f-8119-4c41-8312-5f299fab9465	07489c05-d7aa-46ab-9346-facd64c2cbc4	f7a0abd8e8aaad1ea388442ccf211735cb7f37ffe04ff6ccf564a9275c0035e2	2026-04-25 12:57:28.440077+00	2026-05-02 12:57:28.411181+00	2026-04-25 12:57:28.440077+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
495c3e3f-6109-4d0b-a4bc-06e09fe19d72	07489c05-d7aa-46ab-9346-facd64c2cbc4	cb468c0e37616ee348fe707b805ab39dea1064ef934e8951846f058c1d558667	2026-04-26 00:00:42.982014+00	2026-05-03 00:00:42.992241+00	2026-04-26 00:00:42.982014+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
b80a66e1-0f64-4e91-9419-3c5913b18883	07489c05-d7aa-46ab-9346-facd64c2cbc4	6a7f62e502f33bb7d6c759657072c0594c7ec3fc464e923e79f92ac57ff8bd30	2026-04-26 00:03:14.148149+00	2026-05-03 00:03:14.160218+00	2026-04-26 00:03:14.148149+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
935e1ae5-dabe-4235-b1e6-cab0f7a06061	07489c05-d7aa-46ab-9346-facd64c2cbc4	3bf9f0120cfbc9fc27860edf6db57ddd3b59c45274d4d2f2f876bf92c87dffac	2026-04-25 23:59:54.75402+00	2026-05-02 23:59:54.784989+00	2026-04-25 23:59:54.75402+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
af7cc824-c3b4-442a-accd-7699e55320a4	07489c05-d7aa-46ab-9346-facd64c2cbc4	2351aa4b0e2ed4ebc21ed94331ee8cf0c56ed757e3b4ba5999c4d858697d5756	2026-04-26 00:03:43.502745+00	2026-05-03 00:03:43.515233+00	2026-04-26 00:03:43.502745+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0aef4e5d-762d-499e-a0c4-ab2dd71a6c5d	07489c05-d7aa-46ab-9346-facd64c2cbc4	fb902218ebf4468c43322ac82e30d7dd6ed3d3279fab5dfc6b798b1d7e3ae812	2026-04-26 01:03:28.885032+00	2026-05-03 01:03:28.917802+00	2026-04-26 01:03:28.885032+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
08fc1eff-0e1a-46fb-afb9-790f1b5b93c7	07489c05-d7aa-46ab-9346-facd64c2cbc4	e4a677830e7b410ca1ceb6b4a0684a1456f14d8be4c2a5c93e4469844143ccbe	2026-04-26 01:03:30.837038+00	2026-05-03 01:03:30.851193+00	2026-04-26 01:03:30.837038+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
edc5d8a1-f336-47b7-a83c-9336c4e929d5	07489c05-d7aa-46ab-9346-facd64c2cbc4	d7a0ad8eb723f388a6ca5d162b35d02d2777160ce177f43aa8d0ca144995597a	2026-04-26 00:03:17.920399+00	2026-05-03 00:03:17.948644+00	2026-04-26 00:03:17.920399+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
3e8c8329-8e2d-4cc0-a114-300297389710	07489c05-d7aa-46ab-9346-facd64c2cbc4	9d54cd44242a23b315216467d4c08161f5a168ba050ba60eac244a7e8571b782	2026-04-26 04:01:06.801477+00	2026-05-03 04:01:06.865028+00	2026-04-26 04:01:06.801477+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
761d3857-67f4-494d-a269-855d98a0e4ce	07489c05-d7aa-46ab-9346-facd64c2cbc4	dd00874d391afd3abd0b749c8d15905fd7a4d9bc9706926441b3aa7c0905b8c5	2026-04-26 04:01:10.245275+00	2026-05-03 04:01:10.280689+00	2026-04-26 04:01:10.245275+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
74a1c25d-e366-4d93-abfd-84d4c55425e3	07489c05-d7aa-46ab-9346-facd64c2cbc4	a3efa6d97ab5fe5670941a6700feafc9306075b08fe11f050f7ff68d9dc2d39b	2026-04-26 17:31:04.42645+00	2026-05-03 17:31:04.456347+00	2026-04-26 17:31:04.42645+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
370ae3ce-4747-4f89-a746-b189f6f99c4d	07489c05-d7aa-46ab-9346-facd64c2cbc4	00cf407cff9a32c1a7907185e934f056ae981ed1baa9ce5b0b419f58055e4e03	2026-04-26 01:03:33.581245+00	2026-05-03 01:03:33.612191+00	2026-04-26 01:03:33.581245+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7ae76afb-6c3a-4e27-803a-b3584bd041c6	07489c05-d7aa-46ab-9346-facd64c2cbc4	6e97b494a35a5ab1ffe1f3e4cd9fd7a2fdd9ec87e5d66bea72e058aef50f597f	2026-04-26 17:43:31.613816+00	2026-05-03 17:43:31.628878+00	2026-04-26 17:43:31.613816+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
da738698-1d91-4783-8f0e-aa369a4e14d2	07489c05-d7aa-46ab-9346-facd64c2cbc4	cf3958a5dcc95a100c7d0f52d845049d67923d73d5b5b5ff8b84582569719ff9	2026-04-26 17:50:15.145366+00	2026-05-03 17:50:15.128351+00	2026-04-26 17:50:15.145366+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
da029d96-3f7b-448b-a78e-c92f13e2171a	07489c05-d7aa-46ab-9346-facd64c2cbc4	0be3e242972bb030f66652db175187b1a63e5ffa6cbc38ed29df4f801b582341	2026-04-26 17:50:18.528765+00	2026-05-03 17:50:18.556511+00	2026-04-26 17:50:18.528765+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d0829b32-88d8-454d-8d2e-21cf3991f647	07489c05-d7aa-46ab-9346-facd64c2cbc4	a7cba485c8aaa046e88a2d29bd2727b1f273660eb323f04a2655d39b867675d1	2026-04-26 17:50:20.617874+00	2026-05-03 17:50:20.630386+00	2026-04-26 17:50:20.617874+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1f9666c6-3049-4f76-bff6-84acd1454f4c	07489c05-d7aa-46ab-9346-facd64c2cbc4	c02acd24b0eacb9968e7cd186a0292492e046ba5ed02b7c4ca83071d26d56a39	2026-04-26 18:33:08.073059+00	2026-05-03 18:33:08.050862+00	2026-04-26 18:33:08.073059+00	::1	curl/8.7.1	f
e9c56344-1d7a-40c4-9f5d-c6c135ce9c46	07489c05-d7aa-46ab-9346-facd64c2cbc4	762f5e7c84fafab7201305b490dd3a1739740256d879ba08cb75b8faf089801e	2026-04-26 18:33:11.498976+00	2026-05-03 18:33:11.476866+00	2026-04-26 18:33:11.498976+00	::1	curl/8.7.1	f
d5afca2a-5a2f-4f42-8a1e-d24cd1d45de3	07489c05-d7aa-46ab-9346-facd64c2cbc4	c8e999a4dfae0a075116746e2db7193a06d8564c2f8c322f864abf555bf846cd	2026-04-26 18:33:15.559044+00	2026-05-03 18:33:15.536997+00	2026-04-26 18:33:15.559044+00	::1	curl/8.7.1	f
a1774ebe-96f2-49d9-a889-f0a2f8683644	07489c05-d7aa-46ab-9346-facd64c2cbc4	0ffb4a51df4e5792880fdbe782876174acfcc86ed00f0bd89c85641b6ecb0a89	2026-04-26 18:33:19.390269+00	2026-05-03 18:33:19.366572+00	2026-04-26 18:33:19.390269+00	::1	curl/8.7.1	f
5ffc87dc-3e4a-4b16-9efc-60b45ddec357	07489c05-d7aa-46ab-9346-facd64c2cbc4	69d22f88e76fcc41785e7424e9e4dafb4aa3ff08438a6ee1050c6d7c63293fe7	2026-04-26 18:28:05.552267+00	2026-05-03 18:28:05.576864+00	2026-04-26 18:28:05.552267+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
af647efa-a1c3-457a-a03e-0007441082b7	07489c05-d7aa-46ab-9346-facd64c2cbc4	32b516a5f61694dfaf99092bea7c3f234efa8d6a11d742e5e4c1aec3bc09beb0	2026-04-26 18:47:36.662973+00	2026-05-03 18:47:36.67555+00	2026-04-26 18:47:36.662973+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7679c056-701c-4886-92ae-2c367c1eae3b	07489c05-d7aa-46ab-9346-facd64c2cbc4	34530397dc99914c93704f68e2878370723c0f6031ec6f47864a733e569d2275	2026-04-26 18:56:44.494328+00	2026-05-03 18:56:44.530811+00	2026-04-26 18:56:44.494328+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2d200941-0b52-4004-ace0-093ffabc7abc	07489c05-d7aa-46ab-9346-facd64c2cbc4	ee4c46834e940f3ad246139e2f678ff4cd9f41ae2d891a137187eb5f65191178	2026-04-26 18:58:50.001831+00	2026-05-03 18:58:50.015812+00	2026-04-26 18:58:50.001831+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
48972de9-32dc-4c50-b6c4-927b8166403f	07489c05-d7aa-46ab-9346-facd64c2cbc4	6c27494dbd51451a7168efca04f86e7e4f50a8fe62179be0cb9c801d5dd2745d	2026-04-26 19:53:55.090124+00	2026-05-03 19:53:55.121062+00	2026-04-26 19:53:55.090124+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
509d8697-f7c4-4885-8f0b-005793ac4cc8	07489c05-d7aa-46ab-9346-facd64c2cbc4	ab23dbc98c0eece55b3a02381e5abf1d9629c0fcb066ec8aadc8e080d95f54b3	2026-04-26 17:31:05.94078+00	2026-05-03 17:31:05.982358+00	2026-04-26 17:31:05.94078+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
ea4986b4-728c-4f8c-ae5d-303cb5060750	07489c05-d7aa-46ab-9346-facd64c2cbc4	99abcd45723ce9c25cbb3db1b473cf8c9e8ae47356c6a2a4f8bd6c631d0be1d3	2026-04-26 20:27:05.840181+00	2026-05-03 20:27:05.874844+00	2026-04-26 20:27:05.840181+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
076b032e-a664-42fc-835c-8d1574b4722a	07489c05-d7aa-46ab-9346-facd64c2cbc4	f70bdf8aa7e833f1174b2d7dba77548b2107c30d83dbaa8803912b6af0b7050e	2026-04-26 21:34:42.41139+00	2026-05-03 21:34:42.436877+00	2026-04-26 21:34:42.41139+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a0c3f5ca-86d9-48cd-ae93-9ac67ddfa11f	07489c05-d7aa-46ab-9346-facd64c2cbc4	c24b3a9585234ea03100c1c44a317ed1de2f6f4dc95954e8d21f9a23c96f67e8	2026-04-26 21:39:53.953898+00	2026-05-03 21:39:53.937659+00	2026-04-26 21:39:53.953898+00	::1	curl/8.7.1	f
f7597db5-2924-40cd-b533-b72ca98ec198	07489c05-d7aa-46ab-9346-facd64c2cbc4	c3f20fbae1302df59e407040099b06b7db6c1366b78ab415a094f77d11acfc84	2026-04-26 21:39:19.457918+00	2026-05-03 21:39:19.484039+00	2026-04-26 21:39:19.457918+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
52644334-1318-47f3-9951-897110724445	07489c05-d7aa-46ab-9346-facd64c2cbc4	ce0eb813e9ddf96ca345e2017e5952ce690148c0d910ea4bee9b11fe2898079d	2026-04-26 21:41:06.021542+00	2026-05-03 21:41:06.060088+00	2026-04-26 21:41:06.021542+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1072090a-ae1a-4e20-a414-f8108cad9b53	07489c05-d7aa-46ab-9346-facd64c2cbc4	e3e6778617163ccfc87fcd2d89623aedcdb969f6c54b96a997562da3cbd9645d	2026-04-26 23:27:51.433499+00	2026-05-03 23:27:51.461193+00	2026-04-26 23:27:51.433499+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
1e89b45d-aabd-49cd-ac76-b297cf90051e	07489c05-d7aa-46ab-9346-facd64c2cbc4	b1db9ccc2f556779a6187dad0cb4d26db147e9f47e79eb15533a5c53f0df6468	2026-04-26 23:43:23.87603+00	2026-05-03 23:43:23.890729+00	2026-04-26 23:43:23.87603+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
f3739ab3-ff2e-40b4-8b41-3a5a069bdf32	07489c05-d7aa-46ab-9346-facd64c2cbc4	cfe4af8cbcf0a5faab66f25dfbe6151699ac4ba64c8bb0b067ef4eba09f7e804	2026-04-26 23:46:20.752958+00	2026-05-03 23:46:20.76606+00	2026-04-26 23:46:20.752958+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
817f0be8-ed13-4ebf-8377-8434c28e31ff	07489c05-d7aa-46ab-9346-facd64c2cbc4	ccdd3ae85ac9511788796b759325f26b1da2f2e6113a73e52eb4a07c5a34d909	2026-04-26 23:47:15.785363+00	2026-05-03 23:47:15.797884+00	2026-04-26 23:47:15.785363+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
a22c714e-5542-456a-bedb-0bec8907336e	07489c05-d7aa-46ab-9346-facd64c2cbc4	cec42b8fe91ebeff419d33bd538bd865b4ad03e6f12d6981019ebeb86bb5a4c5	2026-04-26 23:48:10.73288+00	2026-05-03 23:48:10.745393+00	2026-04-26 23:48:10.73288+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
1d4d93b4-6600-45cd-b8d1-ec90a7361953	07489c05-d7aa-46ab-9346-facd64c2cbc4	e936d3b6374e96559caa4157fd0a91eadd3a5a646386d59ee92efc6fb5603301	2026-04-26 23:50:55.974858+00	2026-05-03 23:50:55.987033+00	2026-04-26 23:50:55.974858+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
ae05c0a9-2dbd-4cda-ae2c-e585a9e3bbe6	07489c05-d7aa-46ab-9346-facd64c2cbc4	cb072b0089f6402de4c024289428c40a8cbd816fb39ded389ea020eef42dae75	2026-04-27 00:36:39.942463+00	2026-05-04 00:36:39.910554+00	2026-04-27 00:36:39.942463+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
9af698af-0c01-4803-9910-0612d14be246	07489c05-d7aa-46ab-9346-facd64c2cbc4	59edc3ea4f7bd5461f6734eb93228980189c027ae42af64997b754155b4063f5	2026-04-27 00:55:18.672117+00	2026-05-04 00:55:18.653646+00	2026-04-27 00:55:18.672117+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
704249f1-c64b-40e9-9717-fde84b7857c5	07489c05-d7aa-46ab-9346-facd64c2cbc4	b2397d69f885d43c7998cec144ba23b9d114eb8f19a246b6c20552bce89ce78c	2026-04-26 23:00:08.686404+00	2026-05-03 23:00:08.720093+00	2026-04-26 23:00:08.686404+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7820765f-1443-43a8-9cbf-7bf65b9161fe	07489c05-d7aa-46ab-9346-facd64c2cbc4	a224ee6a4644d30e5e3febdbea1ea718c83c642186f7b82886cdef6b9861d8f6	2026-04-27 01:03:46.336528+00	2026-05-04 01:03:46.349434+00	2026-04-27 01:03:46.336528+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
b5296ebd-8b64-492c-9782-c8bba11c8ed0	07489c05-d7aa-46ab-9346-facd64c2cbc4	f8d69cb1b226df57591b2247a28be79307160da1e25fd3e0472ea4250a6b9433	2026-04-27 01:05:43.910863+00	2026-05-04 01:05:43.891671+00	2026-04-27 01:05:43.910863+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6e7cca9f-bb85-409b-aa7b-988808694081	07489c05-d7aa-46ab-9346-facd64c2cbc4	8942078b574fad32ea5b9b3f19f83492505ebc1b8cb94cf1c0c0215ce0beab5f	2026-04-27 01:05:52.930419+00	2026-05-04 01:05:52.960834+00	2026-04-27 01:05:52.930419+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
cb201f12-fb41-4ddb-aa47-41df0ae9461b	07489c05-d7aa-46ab-9346-facd64c2cbc4	043690210e6dbcb5de704f24196b229f6264103ec21d10e777beb75e4f67e743	2026-04-27 00:58:43.217319+00	2026-05-04 00:58:43.251244+00	2026-04-27 00:58:43.217319+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
bd2a912f-412f-4cc6-ad4f-4bcba8b68081	07489c05-d7aa-46ab-9346-facd64c2cbc4	b60c728b43220e7352de84f51f2f2328f3af702bdba0c33748b9c724bcdc1836	2026-04-27 01:07:26.119197+00	2026-05-04 01:07:26.085081+00	2026-04-27 01:07:26.119197+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9be0fe5d-3a24-4bc6-b2a9-f53946c894b7	07489c05-d7aa-46ab-9346-facd64c2cbc4	102dc61fb4c4c9b6a7bc87244b04ef1099dbe7a4d84017e6d79b10bd07bc6fd6	2026-04-27 01:12:21.526584+00	2026-05-04 01:12:21.604743+00	2026-04-27 01:12:21.526584+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
81eafc03-8e13-44f8-a6be-8010b4df09b9	07489c05-d7aa-46ab-9346-facd64c2cbc4	4f9940c311e8edc72181687069ff82d50483830d92028dd66ba64d8a321b0db4	2026-04-27 01:12:21.526565+00	2026-05-04 01:12:21.559316+00	2026-04-27 01:12:21.526565+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
3821143d-6014-46bf-af19-b9de918bdfe0	07489c05-d7aa-46ab-9346-facd64c2cbc4	837a4648395ff8774f1fc062a28b178f82ab5249f5b4b2232ff1d92bc96940b9	2026-04-27 01:12:28.265644+00	2026-05-04 01:12:28.305491+00	2026-04-27 01:12:28.265644+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6870523a-7e8e-4aa8-8a96-f3e69983ebcb	07489c05-d7aa-46ab-9346-facd64c2cbc4	8db0b80b8ff4b757c3dd2706ea98df1ec1fddf07e29a865f5d6a35d3104c5411	2026-04-27 01:17:24.055073+00	2026-05-04 01:17:24.086039+00	2026-04-27 01:17:24.055073+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
14876aa5-bc0e-4f7e-af86-df04ca64cc41	07489c05-d7aa-46ab-9346-facd64c2cbc4	0d72a509d1cc5ce342c1992b9911dc8ba5fd7fb4b89138521306f26e543fb36e	2026-04-27 01:17:33.745904+00	2026-05-04 01:17:33.727908+00	2026-04-27 01:17:33.745904+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f0c26a3a-db50-45c8-8821-eba0aa5bee94	07489c05-d7aa-46ab-9346-facd64c2cbc4	9c90daa44251ee4e3b7db9559d624c2ff8ea377ece380efae74d304391cffbdf	2026-04-27 01:12:28.295061+00	2026-05-04 01:12:28.348885+00	2026-04-27 01:12:28.295061+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
00bee8bd-1abc-4405-88e9-ce0065e9b2fc	07489c05-d7aa-46ab-9346-facd64c2cbc4	7f6c02c1a7bf0abbc6bd45d8b93ecb7266bc514e52fcd1e428ee664e1e6db558	2026-04-27 01:19:35.589013+00	2026-05-04 01:19:35.635651+00	2026-04-27 01:19:35.589013+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
dff6668c-fb25-46d0-baf0-fa7734468726	07489c05-d7aa-46ab-9346-facd64c2cbc4	c450efecf846b0691fa63804eb8250d048af3e8fbd1cbf1ebb281546091fca34	2026-04-27 01:17:37.220521+00	2026-05-04 01:17:37.23444+00	2026-04-27 01:17:37.220521+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
eb14a61d-cb6b-414d-a7a9-a3174feac109	07489c05-d7aa-46ab-9346-facd64c2cbc4	6f8dc9b0ba0e0a214b18f78db9d0d9b2c3bf21bdec1ee1c689077b9ee403dfad	2026-04-27 01:18:05.229183+00	2026-05-04 01:18:05.193798+00	2026-04-27 01:18:05.229183+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c1644b89-de3d-4cb1-b24e-c715b8ada289	07489c05-d7aa-46ab-9346-facd64c2cbc4	ee57a3d3f833d653ce6a36c464e29d052123e4136a3bd6ec1d8b69dee6596606	2026-04-27 01:19:28.295699+00	2026-05-04 01:19:28.338519+00	2026-04-27 01:19:28.295699+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
f6cfdbb8-f0ec-49f5-8d65-db40d2381d72	07489c05-d7aa-46ab-9346-facd64c2cbc4	02495e2b6c59602ac2d05fec423f73f782288b6f2731181ccd3b184aa20c5858	2026-04-27 01:19:28.371317+00	2026-05-04 01:19:28.443329+00	2026-04-27 01:19:28.371317+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ac8f2561-bea6-4dbe-930d-e20d9080c86d	07489c05-d7aa-46ab-9346-facd64c2cbc4	508d03950b00dd74db6c7a57e65381008a99efb445a536b4b4a1decc3801074a	2026-04-27 01:19:35.622274+00	2026-05-04 01:19:35.649961+00	2026-04-27 01:19:35.622274+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
38f4c93f-80ce-48f1-badd-8864f00784f5	07489c05-d7aa-46ab-9346-facd64c2cbc4	8a8c93d1596aa2ea7f56ce1dda42e41198e1fe68821ab27991b94c94f23006f3	2026-04-27 01:28:16.952051+00	2026-05-04 01:28:16.96453+00	2026-04-27 01:28:16.952051+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
503cda3f-4021-4339-a1fb-0b034fe88b2d	07489c05-d7aa-46ab-9346-facd64c2cbc4	5ff1c6fb3c1e4b79432ac330295a1490d6ebd56f74794999ef3f16cfd994ac09	2026-04-27 01:29:01.755219+00	2026-05-04 01:29:01.774607+00	2026-04-27 01:29:01.755219+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
1d856f6b-5ce8-4eef-bc63-7825e67388b8	07489c05-d7aa-46ab-9346-facd64c2cbc4	535ad0215ac80b7916d90b456095597f944798ec95176691dcff05504f5ef5e4	2026-04-27 01:29:27.272355+00	2026-05-04 01:29:27.253468+00	2026-04-27 01:29:27.272355+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
de61f04f-8348-48c0-94b9-2df09849924b	07489c05-d7aa-46ab-9346-facd64c2cbc4	89cda1e49b05614c3dfb4185b6ec697a84f4e30e74275d5e09e53f31f8464acf	2026-04-27 01:59:00.778213+00	2026-05-04 01:59:00.759364+00	2026-04-27 01:59:00.778213+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6d22717b-a0a2-4eec-8fa1-a5d203f36453	07489c05-d7aa-46ab-9346-facd64c2cbc4	7f0de73e50faf70048f8bc038621732d5a709c3f354c3b09a34bd9fc8ff08565	2026-04-27 02:08:13.817562+00	2026-05-04 02:08:13.830273+00	2026-04-27 02:08:13.817562+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
69b5f0b9-2942-4bd2-9f59-a09c00a46189	07489c05-d7aa-46ab-9346-facd64c2cbc4	c2d54a4ee960297ff834c6e628d3757a9fdaf3f7c8151aa922a18c1deb868f97	2026-04-27 02:08:20.471556+00	2026-05-04 02:08:20.50117+00	2026-04-27 02:08:20.471556+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a4e9ba0c-58e8-4855-995a-721a1139a449	07489c05-d7aa-46ab-9346-facd64c2cbc4	88d3fec7079485eed9da3ba40172abc2b20409880acd247fda9eddae8ed2588b	2026-04-27 02:08:44.073387+00	2026-05-04 02:08:44.106365+00	2026-04-27 02:08:44.073387+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6d691726-6195-4511-abff-46146f848343	07489c05-d7aa-46ab-9346-facd64c2cbc4	4d69fbb36d328a5098f38b9beedec2de12b580114ef8843b218c9f6b6e96c0f1	2026-04-27 02:27:01.447822+00	2026-05-04 02:27:01.478456+00	2026-04-27 02:27:01.447822+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
90f3a427-8904-44ce-9b68-33e038316af7	07489c05-d7aa-46ab-9346-facd64c2cbc4	9f7ce56ed0d69508021cc71127027c3c0131eb6d72949c58f7a0ce48331ce5a0	2026-04-27 02:27:12.808495+00	2026-05-04 02:27:12.773357+00	2026-04-27 02:27:12.808495+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
2d020e56-528c-4768-946c-ffa05e935379	07489c05-d7aa-46ab-9346-facd64c2cbc4	df277c35a93b4bf9933925447639d4fea7c90208c5074144d372e55294dc101c	2026-04-27 02:47:52.528503+00	2026-05-04 02:47:52.64335+00	2026-04-27 02:47:52.528503+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bb83394c-01f1-42ba-bb96-1298d137c917	07489c05-d7aa-46ab-9346-facd64c2cbc4	6a19577ffb08ddcad2aa763d5d2a4e8d33efdcf176bccf758615fb07efab4835	2026-04-27 02:57:53.893338+00	2026-05-04 02:57:53.926459+00	2026-04-27 02:57:53.893338+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ccdeb15d-6035-4487-952a-5e6f5882688e	07489c05-d7aa-46ab-9346-facd64c2cbc4	2b041308f732c35bb2daf7ca836f3e548237426e85a2a65acc9ef4b60f75ca6b	2026-04-27 03:03:31.023616+00	2026-05-04 03:03:31.055598+00	2026-04-27 03:03:31.023616+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ecc6d167-a771-4597-9897-49de7135885c	07489c05-d7aa-46ab-9346-facd64c2cbc4	04a4b967c05154bf244aa9d8aeac2daf358310d51be6b767b856da09cc303be6	2026-04-27 03:12:56.040004+00	2026-05-04 03:12:56.156345+00	2026-04-27 03:12:56.040004+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e85f8234-6677-4e2c-afe8-bf2e1aa8c68a	07489c05-d7aa-46ab-9346-facd64c2cbc4	bf68cf3cab1e5646302e6bb264c46ab0f2a63f16a488ae0fc6c555bc4b3329fc	2026-04-27 03:16:47.620812+00	2026-05-04 03:16:47.633095+00	2026-04-27 03:16:47.620812+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
22d94d15-3e61-449e-b33a-61eaf94f24e8	07489c05-d7aa-46ab-9346-facd64c2cbc4	c75185dfbb6519a7d6e0a808487034295c45447e1da11a7cfcc21fad8a497320	2026-04-27 03:17:55.949541+00	2026-05-04 03:17:55.96448+00	2026-04-27 03:17:55.949541+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bf3ce268-9ef5-4cb4-a4a4-20a3de670b4c	07489c05-d7aa-46ab-9346-facd64c2cbc4	04e8f04d127d1ee7e4f2f650bfa7e66b2ca68903bbec491637e485880d97bccc	2026-04-27 03:27:41.627719+00	2026-05-04 03:27:41.641874+00	2026-04-27 03:27:41.627719+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
15ebda79-d52c-429f-bec1-4fbc2b20dcef	07489c05-d7aa-46ab-9346-facd64c2cbc4	40b1d822f9e9d059c1ef746578c6cb496c7a8e02329f50f53672fa58a071f6aa	2026-04-27 03:46:46.857495+00	2026-05-04 03:46:46.884575+00	2026-04-27 03:46:46.857495+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d88e5385-ccd4-4c26-a3e1-6b0179f9e2ad	07489c05-d7aa-46ab-9346-facd64c2cbc4	f561ae926dcbe889308704b5494a0dacfee128f6e4c7ea1d627e2daf3ed15f29	2026-04-27 03:54:26.716821+00	2026-05-04 03:54:26.734785+00	2026-04-27 03:54:26.716821+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6009d58a-42cc-4f2d-b41f-ac357ba5b2af	07489c05-d7aa-46ab-9346-facd64c2cbc4	e7dbebcd4982e6e032f2d37f4335aabf480941e235997a11bae2d32a20b04b47	2026-04-27 04:10:46.007898+00	2026-05-04 04:10:46.033482+00	2026-04-27 04:10:46.007898+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7fbca7e6-7e8e-448e-af0c-44f59d921373	07489c05-d7aa-46ab-9346-facd64c2cbc4	9c23a7fffe30dc8d223a38751929e705a82f7cdfa11e905cf3274a9203083d8f	2026-04-27 04:53:41.771143+00	2026-05-04 04:53:41.799686+00	2026-04-27 04:53:41.771143+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
37cd38b5-0bf0-46a4-8e36-95ae60a4c4c8	07489c05-d7aa-46ab-9346-facd64c2cbc4	52d201251046d26049101beca4918bef645360c6529c89f9431bd607e028d6b5	2026-04-27 04:53:56.097828+00	2026-05-04 04:53:56.128719+00	2026-04-27 04:53:56.097828+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5c8b494e-e636-4ebc-ba5c-0b4aa88820f6	07489c05-d7aa-46ab-9346-facd64c2cbc4	13505ad96a96d8a5aa39925b4bd98659573c54334bc0fee75caf8bfb86ec47c2	2026-04-27 04:54:40.618221+00	2026-05-04 04:54:40.650906+00	2026-04-27 04:54:40.618221+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
08172e56-356e-4fc9-801e-7f4d756a9f79	07489c05-d7aa-46ab-9346-facd64c2cbc4	13cf145f22e16cb3236c6b45e642a19a745daaba1a23fa279e4ca952b8f9d93c	2026-04-27 04:58:32.615073+00	2026-05-04 04:58:32.643483+00	2026-04-27 04:58:32.615073+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
52b078c8-fc0d-4358-94db-d49f695171b4	07489c05-d7aa-46ab-9346-facd64c2cbc4	b998f0746fe55bd4a75fef548b12933eb62ed48ebf25d6a364a738339a79b79a	2026-04-27 04:58:48.057076+00	2026-05-04 04:58:48.07008+00	2026-04-27 04:58:48.057076+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
24da1ac3-623d-48e6-9c8d-b3e0293809c4	07489c05-d7aa-46ab-9346-facd64c2cbc4	3de8e2c5d46fb1f09149b225be05d5ca3281d12b2533692176ddff57de52bc10	2026-04-27 05:01:52.171831+00	2026-05-04 05:01:52.239098+00	2026-04-27 05:01:52.171831+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b758e4f0-c757-488a-b148-dda3cd5f348d	07489c05-d7aa-46ab-9346-facd64c2cbc4	ab6a6da1faf7c92739e31f374844bccbdaf40a82855ef04d8c85f86eda9c19e9	2026-04-27 05:01:58.768318+00	2026-05-04 05:01:58.781776+00	2026-04-27 05:01:58.768318+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6fd8b1c3-fecc-4d3d-bed8-59ac3a23c9a8	07489c05-d7aa-46ab-9346-facd64c2cbc4	82caba1984375593e2df4ee11e1ac9f061deb59d6f328a4dcdcc21c022e9754c	2026-04-27 05:02:06.623337+00	2026-05-04 05:02:06.636464+00	2026-04-27 05:02:06.623337+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5a38882c-19cf-4b3f-b267-9444e2107e13	07489c05-d7aa-46ab-9346-facd64c2cbc4	04ce75c3b06f9aa5eeaf2ca421c9fe2d87ff16e0f594956eaefd3102bba0e4e3	2026-04-27 05:20:06.747198+00	2026-05-04 05:20:06.767075+00	2026-04-27 05:20:06.747198+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6d73bca9-7f71-40d7-ad67-fe63f604b945	07489c05-d7aa-46ab-9346-facd64c2cbc4	9b6a0e6a9b375220aaa9a47ae0621e7bed6e051ba9a3e1406fcc0bacd559b271	2026-04-27 05:24:44.990647+00	2026-05-04 05:24:45.021865+00	2026-04-27 05:24:44.990647+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
dada58a2-4122-4b41-bfb8-16d54c402063	07489c05-d7aa-46ab-9346-facd64c2cbc4	d519b2c9f2067e0638c3644a1b3606fcd84634f34ec3904fcb937b2c2f36ecec	2026-04-27 05:28:30.410384+00	2026-05-04 05:28:30.445526+00	2026-04-27 05:28:30.410384+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
29c82928-472d-4d01-8e0c-35a4ffc1f722	07489c05-d7aa-46ab-9346-facd64c2cbc4	095072b0a9f27d36b88286131d96c374bb7afb9c56ddc86fcf74904b2dbb629b	2026-04-27 05:29:45.927807+00	2026-05-04 05:29:45.941398+00	2026-04-27 05:29:45.927807+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bb6f2fd8-e999-46f3-9ee6-8db9c4771a26	07489c05-d7aa-46ab-9346-facd64c2cbc4	5b7d2a391a1d196bbd7729dfbe634ecbc15da6e0529397d6eb62d06f1b871176	2026-04-27 05:37:55.794635+00	2026-05-04 05:37:55.8371+00	2026-04-27 05:37:55.794635+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
44318c13-ae24-442d-8737-9400e4e37c54	07489c05-d7aa-46ab-9346-facd64c2cbc4	b4d512f8c5aa9698fbf8f3975f60d1769eae685c7746ce4407c4febdfbd953f5	2026-04-27 05:40:33.110562+00	2026-05-04 05:40:33.125454+00	2026-04-27 05:40:33.110562+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
09e2447e-c3e0-4879-917f-486dc51cf060	07489c05-d7aa-46ab-9346-facd64c2cbc4	a91b34667323238d68853663cdbc4cd4d4409f93ceee1a087a646b677143183e	2026-04-27 05:48:09.040504+00	2026-05-04 05:48:09.056674+00	2026-04-27 05:48:09.040504+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
54e7230b-ac28-44ae-9542-898238a6946f	07489c05-d7aa-46ab-9346-facd64c2cbc4	35f120b27270da73a48c44a95c2986f77f46c647b2a12bae4d2114ae2aa219b2	2026-04-27 06:15:58.853083+00	2026-05-04 06:15:58.978208+00	2026-04-27 06:15:58.853083+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	t
68544eac-ba27-4cd9-9677-30123262a64a	07489c05-d7aa-46ab-9346-facd64c2cbc4	f4c8cb3d7b0c2fd61cceb9a22b50ed638e2dbc6e627693f704b9555805de85e8	2026-04-27 06:18:32.396272+00	2026-05-04 06:18:32.433108+00	2026-04-27 06:18:32.396272+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
394b811e-dd3c-4f4f-b64a-05d29644617e	07489c05-d7aa-46ab-9346-facd64c2cbc4	7a7e68160b365efa7acff5287337fb25cd4475e14674ace0ab9887531bfd42ad	2026-04-27 06:14:27.048036+00	2026-05-04 06:14:27.060546+00	2026-04-27 06:14:27.048036+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7a094dcf-f296-4c1e-95b1-d9e31d8653be	07489c05-d7aa-46ab-9346-facd64c2cbc4	0d354e40ceebbcb05b872f467d0f887965b760d281c0953cdf6d1ba2482ceb3c	2026-04-27 06:46:53.316048+00	2026-05-04 06:46:53.348937+00	2026-04-27 06:46:53.316048+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
\.


--
-- Data for Name: subscription_artifacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_artifacts (id, subscription_id, source_library_id, source_library_version, artifact_key, enabled, config, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_layers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_layers (id, subscription_id, source_library_id, source_library_version, name, tag, sort_order, parent_layer_id, icon, colour, description_md, help_md, allows_children, is_leaf, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_portfolio_model_state; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_portfolio_model_state (id, subscription_id, adopted_model_id, adopted_by_user_id, adopted_at, status, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_sequence; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_sequence (subscription_id, scope, next_num, updated_at) FROM stdin;
00000000-0000-0000-0000-000000000001	roadmap	2	2026-04-21 05:46:22.307829+00
00000000-0000-0000-0000-000000000001	workspace	2	2026-04-21 05:46:22.307829+00
00000000-0000-0000-0000-000000000001	product	2	2026-04-21 05:46:22.307829+00
00000000-0000-0000-0000-000000000001	portfolio	1	2026-04-21 05:46:22.307829+00
\.


--
-- Data for Name: subscription_terminology; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_terminology (id, subscription_id, source_library_id, source_library_version, key, value, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_workflow_transitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_workflow_transitions (id, subscription_id, source_library_id, source_library_version, from_state_id, to_state_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_workflows; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_workflows (id, subscription_id, source_library_id, source_library_version, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscriptions (id, name, slug, is_active, created_at, updated_at, tier) FROM stdin;
00000000-0000-0000-0000-000000000001	MMFFDev	mmffdev	t	2026-04-21 01:13:46.308757+00	2026-04-21 01:13:46.308757+00	pro
ba8829ab-00b1-4a64-a61e-04d982c2eea1	perm-test-a-18533890	perm-test-a-18533890	t	2026-04-26 20:05:14.461791+00	2026-04-26 20:05:14.461791+00	pro
48742e6c-5e1e-4b4d-8fc2-d29cbce225f4	perm-test-a-8425c2f6	perm-test-a-8425c2f6	t	2026-04-26 20:05:14.707862+00	2026-04-26 20:05:14.707862+00	pro
ac647135-5ccc-466d-92e8-3c199879e0cc	perm-test-a-e7c104f3	perm-test-a-e7c104f3	t	2026-04-26 20:05:14.958498+00	2026-04-26 20:05:14.958498+00	pro
3a3cc156-f271-4bb0-9c85-7b739ebd3c4d	perm-test-a-8d5e3b97	perm-test-a-8d5e3b97	t	2026-04-26 20:05:15.220329+00	2026-04-26 20:05:15.220329+00	pro
8c52460f-f2bc-4b73-a056-26cf327dcbf6	perm-test-a-fec59283	perm-test-a-fec59283	t	2026-04-26 20:05:15.46225+00	2026-04-26 20:05:15.46225+00	pro
eeb96ea1-37fd-426d-a5c8-b475418afbf7	perm-test-a-b8f9489b	perm-test-a-b8f9489b	t	2026-04-26 20:05:15.712757+00	2026-04-26 20:05:15.712757+00	pro
ffedeac8-1414-4e22-98dc-45e28efcf9b0	perm-test-a-3cfe98e8	perm-test-a-3cfe98e8	t	2026-04-26 20:05:26.743747+00	2026-04-26 20:05:26.743747+00	pro
\.


--
-- Data for Name: user_custom_page_views; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_custom_page_views (id, page_id, label, kind, "position", config, created_at, updated_at) FROM stdin;
d265c212-8182-47ac-b7f8-5f883e18a83b	39996317-a0bb-40fd-845a-503a6a5a6fd2	Timeline	timeline	0	{}	2026-04-23 07:25:51.245557+00	2026-04-23 07:25:51.245557+00
05eeb200-c6c7-4d57-a7e0-9f7cc8917df3	73e903ca-9c53-400d-b8bc-fbf4c1eadfc2	Timeline	timeline	0	{}	2026-04-23 07:48:35.469506+00	2026-04-23 07:48:35.469506+00
ce2dec9a-c3c9-41a4-9bf9-222fb1889e88	3b98bc96-7ffd-4937-8507-4f114a7da81e	Timeline	timeline	0	{}	2026-04-23 08:20:16.81171+00	2026-04-23 08:20:16.81171+00
97646c41-3657-4de5-b53d-94fd7d7f4b73	88ded5d0-ecdc-42fe-bbbd-d219537b2283	Timeline	timeline	0	{}	2026-04-23 08:20:32.554483+00	2026-04-23 08:20:32.554483+00
a76d6b90-e7ce-4620-b1d2-2399f10f9004	bb3bc1b3-9672-47b9-9e24-04d0ae93c2d1	Timeline	timeline	0	{}	2026-04-23 08:20:36.488216+00	2026-04-23 08:20:36.488216+00
a507f449-aba6-49b5-ac65-783984cb0b32	0fd50fb0-108b-4eb4-9843-4f61ba8b18b0	Timeline	timeline	0	{}	2026-04-23 08:20:39.409529+00	2026-04-23 08:20:39.409529+00
5314025a-abb4-4829-b391-48fbadae8ec1	ef78970a-89eb-48a5-9cd1-804957f935cf	Timeline	timeline	0	{}	2026-04-27 04:54:56.928537+00	2026-04-27 04:54:56.928537+00
afbe9f16-5700-4fe2-adfe-ca388c44e270	c71f614e-4cb7-41b1-b8eb-9c848321f442	Timeline	timeline	0	{}	2026-04-27 04:55:02.798276+00	2026-04-27 04:55:02.798276+00
e1ed40c4-5326-4fe9-82fe-9c983bb34119	599d9017-e07f-4814-9ad1-7f025770cd90	Timeline	timeline	0	{}	2026-04-27 04:56:06.611809+00	2026-04-27 04:56:06.611809+00
\.


--
-- Data for Name: user_custom_pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_custom_pages (id, user_id, subscription_id, label, icon, created_at, updated_at) FROM stdin;
3b98bc96-7ffd-4937-8507-4f114a7da81e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	RICK Parent	folder	2026-04-23 08:20:16.81171+00	2026-04-23 08:20:16.81171+00
88ded5d0-ecdc-42fe-bbbd-d219537b2283	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	RICK Child 1	folder	2026-04-23 08:20:32.554483+00	2026-04-23 08:20:32.554483+00
bb3bc1b3-9672-47b9-9e24-04d0ae93c2d1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	RICK Child 2	folder	2026-04-23 08:20:36.488216+00	2026-04-23 08:20:36.488216+00
0fd50fb0-108b-4eb4-9843-4f61ba8b18b0	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	RICK Child 3	folder	2026-04-23 08:20:39.409529+00	2026-04-23 08:20:39.409529+00
599d9017-e07f-4814-9ad1-7f025770cd90	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	Test 4	list	2026-04-27 04:56:06.611809+00	2026-04-27 05:11:55.892403+00
c71f614e-4cb7-41b1-b8eb-9c848321f442	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	Test 2	briefcase	2026-04-27 04:55:02.798276+00	2026-04-27 05:11:59.777733+00
ef78970a-89eb-48a5-9cd1-804957f935cf	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	Test 1	eye	2026-04-27 04:54:56.928537+00	2026-04-27 05:12:02.898476+00
73e903ca-9c53-400d-b8bc-fbf4c1eadfc2	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	Rick Page 2 PADMIN	briefcase	2026-04-23 07:48:35.469506+00	2026-04-27 05:12:06.202994+00
39996317-a0bb-40fd-845a-503a6a5a6fd2	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	Rick Page 1 PADMIN	wrench	2026-04-23 07:25:51.245557+00	2026-04-27 05:12:10.108498+00
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
7d73688d-6cc8-4519-84bf-777f8a3905a9	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	\N	dashboard	0	f	2026-04-23 03:30:58.329015+00	2026-04-23 03:30:58.329015+00	\N	\N	\N
c6313d3b-cb6b-48aa-b6f9-7bc7834c14b2	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	\N	my-vista	1	f	2026-04-23 03:30:58.329015+00	2026-04-23 03:30:58.329015+00	\N	\N	\N
b3ef4e74-cbc5-4db9-b9f0-9a435d09f03d	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	\N	favourites	2	f	2026-04-23 03:30:58.329015+00	2026-04-23 03:30:58.329015+00	\N	\N	\N
5baecd46-a44a-41f0-903a-38bb5da7bb39	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	\N	backlog	3	t	2026-04-23 03:30:58.329015+00	2026-04-23 03:30:58.329015+00	\N	\N	\N
5d35d993-a521-4f7d-a6cb-f827b42cbd52	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	\N	planning	4	f	2026-04-23 03:30:58.329015+00	2026-04-23 03:30:58.329015+00	\N	\N	\N
05205e85-faeb-4cdb-93e1-4103bdded518	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	\N	portfolio	5	f	2026-04-23 03:30:58.329015+00	2026-04-23 03:30:58.329015+00	\N	\N	\N
2c92cd34-6a30-4226-9397-496e1eb9526e	31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	\N	risk	6	f	2026-04-23 03:30:58.329015+00	2026-04-23 03:30:58.329015+00	\N	\N	\N
ae81aac6-7534-49fe-93e2-ab8b49c6c06e	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	library-releases	10	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
c060f6d8-0bc2-4d4b-9bc0-aa0203c43e4a	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	backlog	0	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
4ffee06e-56fe-45be-829b-c16ba1a6c103	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	dashboard	1	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
6909794e-a94e-490d-b86c-941047a4a9c5	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	risk	2	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
99ddf760-b077-417d-ab6c-deaf81cc9750	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	my-vista	3	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
36e5ac63-96cd-4139-b347-6cd61e886405	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	planning	4	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
92e6cec2-0d12-4f84-b7c5-69fd7c653b61	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	portfolio-settings	5	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
88666220-007b-4392-96de-d7c1d7c868cd	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	favourites	6	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
907fd473-ad9b-41ab-8084-ef5d837966cd	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	portfolio	7	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
be59a813-9b70-4e36-b8b6-5a673d95eb12	07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	\N	portfolio-model	8	f	2026-04-27 04:59:53.84497+00	2026-04-27 04:59:53.84497+00	\N	\N	\N
962eb4c5-a843-4ac0-9f40-5e6412f81f39	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	dashboard	0	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
bd45245f-9bfa-46dc-b413-048741c8e6b1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	my-vista	1	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
5deb8f77-aa43-4d8c-a2dc-b4414c7e7228	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	favourites	2	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
5f195e67-b209-435e-aa57-e06449638557	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	backlog	3	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
ae25e50d-8d9b-4ebc-99b4-efec3b3b2216	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	planning	4	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
8a3ba649-5dd9-4d46-a9bb-8527ef13bb75	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	portfolio	5	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
7005caba-9612-4a71-9e37-6e8f72f22418	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	risk	6	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
6b7f9616-fd52-4c20-acfa-c44036fc5ff1	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	workspace-settings	7	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
7c393330-f422-416b-ad25-31eaf310da64	dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	\N	portfolio-settings	8	f	2026-04-25 01:34:42.340771+00	2026-04-25 01:34:42.340771+00	\N	\N	\N
\.


--
-- Data for Name: user_workspace_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_workspace_permissions (id, user_id, workspace_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, subscription_id, email, password_hash, role, is_active, last_login, created_at, updated_at, auth_method, ldap_dn, force_password_change, password_changed_at, failed_login_count, locked_until, mfa_enrolled, mfa_secret, mfa_enrolled_at, mfa_recovery_codes) FROM stdin;
31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	user@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	user	t	2026-04-23 05:26:25.950753+00	2026-04-21 01:56:50.117861+00	2026-04-26 23:51:59.208663+00	local	\N	f	2026-04-21 02:11:39.347263+00	1	\N	f	\N	\N	\N
dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	gadmin@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	gadmin	t	2026-04-26 18:57:26.00388+00	2026-04-21 01:13:46.309628+00	2026-04-27 04:50:33.315956+00	local	\N	f	2026-04-25 00:11:38.909148+00	1	\N	f	\N	\N	\N
07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	padmin@mmffdev.com	$2b$10$dWf.gRqfP3719jHgmiamEezbfmL1i9frVeywM.l4ZFjb848AtfHTa	padmin	t	2026-04-27 02:27:12.771941+00	2026-04-21 01:48:03.520815+00	2026-04-27 05:40:40.846695+00	local	\N	f	2026-04-21 02:18:29.811456+00	3	\N	f	\N	\N	\N
\.


--
-- Data for Name: workspace; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workspace (id, subscription_id, company_roadmap_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
0e794717-699e-4577-be0c-b419350d265b	00000000-0000-0000-0000-000000000001	bb51d169-ef92-4205-9ae2-ada94cba46cb	1	My Workspace	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
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
-- Name: user_nav_prefs user_nav_prefs_unique_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_nav_prefs
    ADD CONSTRAINT user_nav_prefs_unique_position UNIQUE (user_id, subscription_id, profile_id, "position") DEFERRABLE INITIALLY DEFERRED;


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
-- Name: user_nav_prefs_one_start_page; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_nav_prefs_one_start_page ON public.user_nav_prefs USING btree (user_id, subscription_id, profile_id) WHERE (is_start_page = true);


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
-- Name: users trg_provision_on_first_gadmin; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_provision_on_first_gadmin AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.provision_on_first_gadmin();


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

\unrestrict eJBgebJGQvy7fyy5vu5TpJJarhdgZB9kipcnhnvhSSrIxJDmxXQTc2vh7jym1Vb

