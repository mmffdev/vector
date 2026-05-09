--
-- PostgreSQL database dump
--

\restrict Ggs426PFfX4AzYfLB5c8ObMn1KqW8aPKfTqSyxb8rGTPVgP7WepDlVWEzkyed7M

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
-- Name: defect_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.defect_severity AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
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
-- Name: defects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    type_id uuid NOT NULL,
    hierarchy_parent uuid,
    linked_story uuid,
    name text NOT NULL,
    description text,
    acceptance_criteria text,
    notes text,
    severity public.defect_severity NOT NULL,
    steps_to_reproduce text,
    environment text,
    browser text,
    regression boolean DEFAULT false NOT NULL,
    name_author uuid NOT NULL,
    name_owner uuid,
    schedule_state text DEFAULT 'defined'::text NOT NULL,
    flow_state uuid,
    flow_state_change_update_date timestamp with time zone,
    flow_state_change_owner uuid,
    date_work_accepted timestamp with time zone,
    blocked boolean DEFAULT false NOT NULL,
    blocked_reason text,
    ready boolean DEFAULT false NOT NULL,
    expedite boolean DEFAULT false NOT NULL,
    sprint uuid,
    release uuid,
    estimate_hours numeric(8,2),
    estimate_remaining numeric(8,2),
    rank text DEFAULT ''::text NOT NULL,
    risk_score numeric(5,2),
    risk_impact text,
    lidentifier_colour text,
    lidentifier_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT defects_key_num_check CHECK ((key_num > 0)),
    CONSTRAINT defects_risk_impact_check CHECK ((risk_impact = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT defects_schedule_state_check CHECK ((schedule_state = ANY (ARRAY['defined'::text, 'in_progress'::text, 'completed'::text, 'accepted'::text])))
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
-- Name: item_field_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_field_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    entity_kind text NOT NULL,
    item_type_id uuid,
    custom_field_type text NOT NULL,
    label text NOT NULL,
    description text,
    required boolean DEFAULT false NOT NULL,
    "position" integer,
    creator_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_field_definitions_entity_kind_enum CHECK ((entity_kind = ANY (ARRAY['portfolio_item'::text, 'user_story'::text, 'defect'::text]))),
    CONSTRAINT item_field_definitions_field_type_enum CHECK ((custom_field_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text, 'json'::text])))
);


--
-- Name: TABLE item_field_definitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.item_field_definitions IS 'Padmin-controlled custom field schema catalogue per subscription × entity_kind × item_type. entity_kind discriminator enables single table for portfolio_item, user_story, defect custom fields.';


--
-- Name: item_field_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_field_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    entity_kind text NOT NULL,
    field_definition_id uuid NOT NULL,
    label text NOT NULL,
    value text NOT NULL,
    "position" integer,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_field_options_entity_kind_enum CHECK ((entity_kind = ANY (ARRAY['portfolio_item'::text, 'user_story'::text, 'defect'::text])))
);


--
-- Name: TABLE item_field_options; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.item_field_options IS 'Vocabulary of valid options for select and multiselect custom field types. Scoped to a field_definition with position-based ordering. Soft-archived via archived_at (NULL = live).';


--
-- Name: item_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    entity_kind text NOT NULL,
    entity_id uuid NOT NULL,
    field_definition_id uuid NOT NULL,
    value_text text,
    value_number numeric(19,4),
    value_boolean boolean,
    value_date date,
    value_jsonb jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_field_values_entity_kind_enum CHECK ((entity_kind = ANY (ARRAY['portfolio_item'::text, 'user_story'::text, 'defect'::text]))),
    CONSTRAINT item_field_values_single_value CHECK ((((((((value_text IS NOT NULL))::integer + ((value_number IS NOT NULL))::integer) + ((value_boolean IS NOT NULL))::integer) + ((value_date IS NOT NULL))::integer) + ((value_jsonb IS NOT NULL))::integer) = 1))
);


--
-- Name: TABLE item_field_values; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.item_field_values IS 'Per-artefact custom field data with typed value columns (value_text, value_number, value_boolean, value_date, value_jsonb). entity_kind + entity_id form a polymorphic FK to the correct artefact table. Exactly one value column is non-NULL per row (enforced by constraint).';


--
-- Name: item_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_labels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    item_id uuid NOT NULL,
    item_kind text NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_labels_label_check CHECK ((length(label) > 0))
);


--
-- Name: item_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    item_id uuid NOT NULL,
    item_kind text NOT NULL,
    tag text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_tags_tag_check CHECK ((length(tag) > 0))
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
-- Name: o_artefact_note_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefact_note_reads (
    user_id uuid NOT NULL,
    artefact_type text NOT NULL,
    artefact_id uuid NOT NULL,
    last_read_at timestamp with time zone NOT NULL
);


--
-- Name: o_artefact_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefact_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_type text NOT NULL,
    artefact_id uuid NOT NULL,
    parent_note_id uuid,
    content text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT o_an_content_nonempty CHECK ((length(btrim(content)) > 0))
);


--
-- Name: o_artefact_type_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefact_type_registry (
    scope_key text NOT NULL,
    artefact_table text NOT NULL,
    default_prefix text NOT NULL,
    display_label text NOT NULL,
    display_label_plural text NOT NULL,
    description text,
    phase text DEFAULT 'PH-0005'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_atr_prefix_fmt CHECK ((default_prefix ~ '^[A-Z][A-Z0-9]{0,7}$'::text)),
    CONSTRAINT o_atr_scope_key_fmt CHECK ((scope_key ~ '^[a-z][a-z0-9_]*$'::text))
);


--
-- Name: o_artefact_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefact_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_type text NOT NULL,
    artefact_id uuid NOT NULL,
    version_num integer NOT NULL,
    snapshot_jsonb jsonb NOT NULL,
    change_summary text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT o_av_version_num_positive CHECK ((version_num > 0))
);


--
-- Name: o_artefact_visibility_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefact_visibility_levels (
    level smallint NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    description text NOT NULL,
    requires_scope_id boolean NOT NULL,
    CONSTRAINT o_avl_range CHECK (((level >= 0) AND (level <= 3)))
);


--
-- Name: o_artefacts_execution_defects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_defects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    title text NOT NULL,
    description text,
    content jsonb,
    content_plain_text text,
    template_form_id uuid,
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    CONSTRAINT o_de_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_de_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_execution_defects_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_defects_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    template_field_id uuid,
    field_name text NOT NULL,
    value_text text,
    value_number numeric(19,4),
    value_boolean boolean,
    value_date date,
    value_jsonb jsonb,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_de_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
);


--
-- Name: o_artefacts_execution_defects_template_form_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_defects_template_form_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_form_id uuid NOT NULL,
    field_name text NOT NULL,
    field_label text NOT NULL,
    field_type text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL,
    default_visibility smallint DEFAULT 0 NOT NULL,
    options_json jsonb,
    config_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_de_tff_field_name_nonempty CHECK ((length(btrim(field_name)) > 0)),
    CONSTRAINT o_de_tff_field_type_valid CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text, 'select'::text, 'multiselect'::text, 'jsonb'::text, 'richtext'::text]))),
    CONSTRAINT o_de_tff_position_nonneg CHECK (("position" >= 0))
);


--
-- Name: o_artefacts_execution_defects_template_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_defects_template_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT o_de_tf_name_nonempty CHECK ((length(btrim(name)) > 0))
);


--
-- Name: o_artefacts_execution_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    title text NOT NULL,
    description text,
    content jsonb,
    content_plain_text text,
    template_form_id uuid,
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    CONSTRAINT o_ta_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_ta_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_execution_tasks_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_tasks_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    template_field_id uuid,
    field_name text NOT NULL,
    value_text text,
    value_number numeric(19,4),
    value_boolean boolean,
    value_date date,
    value_jsonb jsonb,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_ta_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
);


--
-- Name: o_artefacts_execution_tasks_template_form_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_tasks_template_form_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_form_id uuid NOT NULL,
    field_name text NOT NULL,
    field_label text NOT NULL,
    field_type text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL,
    default_visibility smallint DEFAULT 0 NOT NULL,
    options_json jsonb,
    config_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_ta_tff_field_name_nonempty CHECK ((length(btrim(field_name)) > 0)),
    CONSTRAINT o_ta_tff_field_type_valid CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text, 'select'::text, 'multiselect'::text, 'jsonb'::text, 'richtext'::text]))),
    CONSTRAINT o_ta_tff_position_nonneg CHECK (("position" >= 0))
);


--
-- Name: o_artefacts_execution_tasks_template_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_tasks_template_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT o_ta_tf_name_nonempty CHECK ((length(btrim(name)) > 0))
);


--
-- Name: o_artefacts_execution_test_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_test_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    title text NOT NULL,
    description text,
    content jsonb,
    content_plain_text text,
    template_form_id uuid,
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    CONSTRAINT o_tc_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_tc_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_execution_test_cases_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_test_cases_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    template_field_id uuid,
    field_name text NOT NULL,
    value_text text,
    value_number numeric(19,4),
    value_boolean boolean,
    value_date date,
    value_jsonb jsonb,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_tc_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
);


--
-- Name: o_artefacts_execution_test_cases_template_form_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_test_cases_template_form_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_form_id uuid NOT NULL,
    field_name text NOT NULL,
    field_label text NOT NULL,
    field_type text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL,
    default_visibility smallint DEFAULT 0 NOT NULL,
    options_json jsonb,
    config_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_tc_tff_field_name_nonempty CHECK ((length(btrim(field_name)) > 0)),
    CONSTRAINT o_tc_tff_field_type_valid CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text, 'select'::text, 'multiselect'::text, 'jsonb'::text, 'richtext'::text]))),
    CONSTRAINT o_tc_tff_position_nonneg CHECK (("position" >= 0))
);


--
-- Name: o_artefacts_execution_test_cases_template_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_test_cases_template_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT o_tc_tf_name_nonempty CHECK ((length(btrim(name)) > 0))
);


--
-- Name: o_artefacts_execution_user_stories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_user_stories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    title text NOT NULL,
    description text,
    content jsonb,
    content_plain_text text,
    template_form_id uuid,
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    CONSTRAINT o_us_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_us_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_execution_user_stories_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_user_stories_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    template_field_id uuid,
    field_name text NOT NULL,
    value_text text,
    value_number numeric(19,4),
    value_boolean boolean,
    value_date date,
    value_jsonb jsonb,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_us_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
);


--
-- Name: o_artefacts_execution_user_stories_template_form_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_user_stories_template_form_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_form_id uuid NOT NULL,
    field_name text NOT NULL,
    field_label text NOT NULL,
    field_type text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL,
    default_visibility smallint DEFAULT 0 NOT NULL,
    options_json jsonb,
    config_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_us_tff_field_name_nonempty CHECK ((length(btrim(field_name)) > 0)),
    CONSTRAINT o_us_tff_field_type_valid CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text, 'select'::text, 'multiselect'::text, 'jsonb'::text, 'richtext'::text]))),
    CONSTRAINT o_us_tff_position_nonneg CHECK (("position" >= 0))
);


--
-- Name: o_artefacts_execution_user_stories_template_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_user_stories_template_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT o_us_tf_name_nonempty CHECK ((length(btrim(name)) > 0))
);


--
-- Name: o_artefacts_strategic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_strategic (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    title text NOT NULL,
    description text,
    content jsonb,
    content_plain_text text,
    template_form_id uuid,
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    hierarchy_parent_id uuid,
    CONSTRAINT o_pi_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_pi_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_strategic_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_strategic_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    template_field_id uuid,
    field_name text NOT NULL,
    value_text text,
    value_number numeric(19,4),
    value_boolean boolean,
    value_date date,
    value_jsonb jsonb,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_pi_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
);


--
-- Name: o_artefacts_strategic_template_form_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_strategic_template_form_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_form_id uuid NOT NULL,
    field_name text NOT NULL,
    field_label text NOT NULL,
    field_type text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL,
    default_visibility smallint DEFAULT 0 NOT NULL,
    options_json jsonb,
    config_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_pi_tff_field_name_nonempty CHECK ((length(btrim(field_name)) > 0)),
    CONSTRAINT o_pi_tff_field_type_valid CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text, 'select'::text, 'multiselect'::text, 'jsonb'::text, 'richtext'::text]))),
    CONSTRAINT o_pi_tff_position_nonneg CHECK (("position" >= 0))
);


--
-- Name: o_artefacts_strategic_template_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_strategic_template_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT o_pi_tf_name_nonempty CHECK ((length(btrim(name)) > 0))
);


--
-- Name: o_search_index_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_search_index_outbox (
    id bigint NOT NULL,
    artefact_type text NOT NULL,
    artefact_id uuid NOT NULL,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text
);


--
-- Name: o_search_index_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.o_search_index_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: o_search_index_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.o_search_index_outbox_id_seq OWNED BY public.o_search_index_outbox.id;


--
-- Name: o_subscription_artefact_type_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_subscription_artefact_type_overrides (
    subscription_id uuid NOT NULL,
    scope_key text NOT NULL,
    display_prefix text NOT NULL,
    display_label text NOT NULL,
    display_label_plural text NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT o_sato_prefix_fmt CHECK ((display_prefix ~ '^[A-Z][A-Z0-9]{0,7}$'::text))
);


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
-- Name: portfolio_item_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_item_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    colour text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_item_types_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: TABLE portfolio_item_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.portfolio_item_types IS 'Per-subscription catalogue of portfolio item type definitions. Similar to execution_item_types pattern. Types control flow_state workflows and custom field availability.';


--
-- Name: portfolio_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    type_id uuid NOT NULL,
    hierarchy_parent uuid,
    name text NOT NULL,
    description text,
    acceptance_criteria text,
    notes text,
    name_author uuid NOT NULL,
    name_owner uuid NOT NULL,
    flow_state uuid,
    flow_state_change_update_date timestamp with time zone,
    flow_state_change_owner uuid,
    blocked boolean DEFAULT false NOT NULL,
    blocked_reason text,
    date_work_planned_start date,
    date_work_planned_finish date,
    date_work_started timestamp with time zone,
    date_work_accepted timestamp with time zone,
    estimate_initial text,
    estimate_updated numeric(10,2),
    risk_impact text,
    risk_probability text,
    risk_score numeric(5,2),
    strategic_investment_group text,
    strategic_investment_weight text,
    strategic_item_type text,
    value_stream_identifier text,
    lidentifier_colour text,
    lidentifier_labels text[],
    lidentifier_tags text[],
    count_child_defects integer,
    count_child_user_stories integer,
    count_dependants integer,
    count_rollup_defect integer,
    count_rollup_defects integer,
    count_rollup_estimation numeric(10,2),
    count_rollup_risks integer,
    done_by_story_count numeric(5,2),
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_items_blocked_reason_requires_blocked CHECK (((blocked = true) OR (blocked_reason IS NULL))),
    CONSTRAINT portfolio_items_lidentifier_colour_hex CHECK (((lidentifier_colour IS NULL) OR (lidentifier_colour ~ '^#[0-9a-fA-F]{6}$'::text))),
    CONSTRAINT portfolio_items_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT portfolio_items_planned_dates_order CHECK (((date_work_planned_start IS NULL) OR (date_work_planned_finish IS NULL) OR (date_work_planned_start <= date_work_planned_finish))),
    CONSTRAINT portfolio_items_strategic_weight_enum CHECK (((strategic_investment_weight IS NULL) OR (strategic_investment_weight = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))))
);


--
-- Name: TABLE portfolio_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.portfolio_items IS 'Unified portfolio item artefact table per R007. Hierarchy via self-referencing parent_id (hierarchy_parent). Key_num allocated atomically from subscription_sequence(scope=POR). Soft-archived via archived_at (NULL = live). Rollup counts (count_*) computed/materialised on child work-item writes. flow_state_change_owner and flow_state_change_update_date are maintained by state-change handlers (not triggers). Future: item-level discussions (discussion_threads entity_kind=portfolio_item); custom field values (item_field_values portfolio_item_id FK).';


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
-- Name: user_stories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_stories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    type_id uuid NOT NULL,
    hierarchy_parent uuid,
    name text NOT NULL,
    description text,
    acceptance_criteria text,
    notes text,
    name_author uuid NOT NULL,
    name_owner uuid,
    schedule_state text DEFAULT 'defined'::text NOT NULL,
    flow_state uuid,
    flow_state_change_update_date timestamp with time zone,
    flow_state_change_owner uuid,
    date_work_accepted timestamp with time zone,
    blocked boolean DEFAULT false NOT NULL,
    blocked_reason text,
    ready boolean DEFAULT false NOT NULL,
    expedite boolean DEFAULT false NOT NULL,
    affects_doc boolean DEFAULT false NOT NULL,
    sprint uuid,
    release uuid,
    estimate_points numeric(6,1),
    estimate_hours numeric(8,2),
    estimate_remaining numeric(8,2),
    rank text DEFAULT ''::text NOT NULL,
    risk_score numeric(5,2),
    risk_impact text,
    risk_probability text,
    lidentifier_colour text,
    lidentifier_type text,
    count_child_tasks integer DEFAULT 0 NOT NULL,
    count_child_defects integer DEFAULT 0 NOT NULL,
    count_child_test_cases integer DEFAULT 0 NOT NULL,
    test_case_status text,
    defect_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT user_stories_count_child_defects_check CHECK ((count_child_defects >= 0)),
    CONSTRAINT user_stories_count_child_tasks_check CHECK ((count_child_tasks >= 0)),
    CONSTRAINT user_stories_count_child_test_cases_check CHECK ((count_child_test_cases >= 0)),
    CONSTRAINT user_stories_defect_status_check CHECK ((defect_status = ANY (ARRAY['none'::text, 'open'::text, 'fixed'::text, 'mixed'::text]))),
    CONSTRAINT user_stories_key_num_check CHECK ((key_num > 0)),
    CONSTRAINT user_stories_risk_impact_check CHECK ((risk_impact = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT user_stories_risk_probability_check CHECK ((risk_probability = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT user_stories_schedule_state_check CHECK ((schedule_state = ANY (ARRAY['defined'::text, 'in_progress'::text, 'completed'::text, 'accepted'::text]))),
    CONSTRAINT user_stories_test_case_status_check CHECK ((test_case_status = ANY (ARRAY['none'::text, 'passed'::text, 'failed'::text, 'mixed'::text])))
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
-- Name: o_search_index_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_search_index_outbox ALTER COLUMN id SET DEFAULT nextval('public.o_search_index_outbox_id_seq'::regclass);


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
681f30c8-6c39-4b80-b1e3-74be96fce7cc	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 02:01:08.261738+00
92161a18-f481-4171-b3eb-7118313bbf7b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 02:06:02.112128+00
221a87d1-375c-4f32-a546-0c9f311a08c4	6cabe266-b2f4-43f9-879c-06020c789a0b	\N	auth.logout	\N	\N	\N	::1	2026-04-29 02:49:57.227314+00
4caf68ff-25b9-435c-bbb8-d0411588e66d	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-29 02:50:11.116802+00
9c619745-2e0b-4671-936a-752b77d6aeb7	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-29 03:03:17.001993+00
31f870e9-dbcd-4885-8ff8-13ab695eb999	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:03:44.389881+00
909476e9-7649-4607-a067-5edffe6fbfca	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:08:16.733543+00
659d6713-7a50-48dc-89e1-7c44149a7bb7	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:18:16.686222+00
c5d0b65d-dc17-4e08-9238-3bd5f9627eb6	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:22:53.460493+00
f949faa4-3e56-4625-903b-70a35d94aeef	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:31:26.90486+00
9a1e7b72-fbf4-4766-acd2-6594a2c3e08f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:33:17.872144+00
18a9bd88-34d7-4f24-8925-75019ece22ba	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:38:41.032857+00
b300048a-a2b0-434a-99ea-6e8bca2dc990	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:41:14.893048+00
7b6b70f4-e245-4451-9a15-b37e57f1cfe8	583b8276-092f-4645-8e79-367fdcb5c4b6	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-29 03:46:58.764151+00
fcbccf7b-3c9f-46fa-88b7-5a0d632b7ce3	583b8276-092f-4645-8e79-367fdcb5c4b6	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-04-29 03:47:01.767977+00
30057c60-5432-4dac-8405-97348a268c0a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:48:17.870721+00
be826bf4-db92-4484-b6d4-c702d425b5c2	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 03:56:15.083531+00
94514d41-4a19-44c3-975a-afa4283a5c8d	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:02:32.890787+00
ba3e4fb6-1820-4b37-867b-ffccdad3db0d	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:03:47.786075+00
15aa3c41-42e0-43e8-8624-813f4bd6a999	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:05:05.233148+00
58296eb4-947d-4161-b2ec-3098e37a6705	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:08:38.562765+00
62460c99-0b2c-46bc-851d-d25a214a414e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:10:02.115429+00
941e8605-0b82-405a-a2bc-6beed78f845f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:13:11.61314+00
ce7f47dd-1544-4d0f-819f-b49b55bf4f62	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:18:47.79656+00
f762be28-13b1-44ca-840e-a57169f527c7	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:28:11.824487+00
95677ea2-d911-4195-9438-5af19a4e3484	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:33:47.798129+00
e2b6be21-44eb-41af-b93d-2b83e825879c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:40:51.658679+00
d9d18021-574c-4988-a118-bd283485949a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:48:47.88433+00
09589239-4a74-48b8-a2d9-670f07756ee8	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 04:55:52.873625+00
cb10adb6-dd67-4b6f-b65d-a9aae09b3731	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 05:03:47.881676+00
8b3a97dd-3b32-42da-bc4f-8b23742dd82a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 05:10:52.873729+00
0375f70f-d28e-4d9a-bfce-c900fdd1bd74	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 05:18:47.787543+00
0b7488d0-9391-40e4-b54c-80c68bc33766	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 05:26:47.786055+00
627b0032-d4a1-4e36-9306-496e0f29ff0a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 05:33:48.582879+00
64fd63cb-1f51-48ad-aedb-e8efe135aeea	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 05:41:47.885009+00
2771d256-5f76-4782-a949-b2f0543169f6	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 05:53:47.916466+00
7351c98c-54c6-46cc-83b2-3e1525a0e14b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 05:56:47.784012+00
f19fbf3d-a18e-4c6c-aff4-77f36b436ab8	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 06:08:47.864441+00
b866471c-e8e3-4b06-83d3-4952170f5619	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 06:11:47.801497+00
5643293d-76a6-4679-8e8c-30a17ccb2e83	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 06:23:47.856341+00
57935936-f2e7-4a1f-86dd-be1d62ef6e10	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 06:26:47.808887+00
6772b7dc-9e1b-43ab-8be5-9f15f2877f88	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 06:41:24.783605+00
1f1ff00c-ab50-462e-872b-c92bf1be4b1d	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 06:41:47.772131+00
1e8a1ab9-34b1-4b2e-981c-e22d4fdb1fa6	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 06:56:25.052773+00
69f5cfba-914f-44fd-bbc6-01295e2f399c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 06:56:47.973137+00
4da9d50e-659e-493e-af64-1adf4c76310c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 07:11:25.79155+00
e83c627f-d546-4a29-8d51-0dbdea1b1373	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 07:11:47.867786+00
605da6ee-3d70-49fd-87cd-84a63e75b177	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 07:23:19.7952+00
bd5f4851-6e71-4c60-9dd0-55144cc7458c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 07:26:47.790235+00
c12f9470-ccad-4b34-b7ef-e88422285009	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 07:38:19.975782+00
4854e4c1-b9d1-4c0a-8040-c971f29cdcac	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 07:41:47.796633+00
cbeaa5d2-9d73-4c62-a763-228ad5ed26fa	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 07:53:19.984735+00
05c4ad27-9996-4834-b7d8-b5f8a5d49aa3	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 07:56:48.063085+00
f2f8ce11-43f1-49d1-b63b-ac471db550e8	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 08:08:19.985344+00
f18513e0-ddcc-4e59-822a-b5f53dc8a766	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 08:25:48.721366+00
662b0155-420a-498d-8769-5637bf5734f7	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 08:27:20.869467+00
50a0731c-e8e2-4241-95c8-44db464213c5	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 08:53:13.977577+00
225f21ba-f750-41bd-bb5f-17283abe1f0b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 09:00:04.995093+00
5a40a4ae-dfe4-40d4-84f0-778113da6364	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 09:11:37.194571+00
62f6cda7-8e68-4d48-8d46-88dc50918175	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 09:15:04.925849+00
10781756-f3b2-4e1c-9c18-25f6ebf65e06	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 09:30:04.947818+00
17673096-79f2-43ff-bb9f-fefa45f29100	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 09:31:37.134251+00
93c06e42-d1c4-4d1c-a31c-35d7ec371a9c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 10:07:41.407913+00
448b0c53-4ec3-4d74-a4b7-5a5643d261f7	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 10:36:07.198065+00
6f05e2d1-cfe1-4899-98d8-a09d9347983f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 10:53:14.906833+00
2a4a8010-81d2-4e53-9020-4491d2a12b52	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 11:19:46.337575+00
cf1028f1-6666-4d34-9d02-7a0304cfd394	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 11:51:24.376212+00
499c91f2-0801-4d60-ba03-e4a8eb90ca8a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 11:52:55.135424+00
e7231d39-bf50-4083-a708-9e0205fd4641	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 12:11:33.493124+00
3748d45a-9570-4ba7-baff-052c91a5527f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 12:22:07.706939+00
0f643e96-cbfb-4f41-acaf-6ff88d5810cd	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 12:53:25.02741+00
e9008c86-19b4-4229-ad20-dad6cde4f4e4	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 12:54:57.206737+00
ae0919c4-2d5a-4d61-a0ee-97118a6ae68c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 13:08:24.956542+00
1403b7aa-9a08-4b8a-a828-c2f52b8fa55f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 13:14:57.137432+00
9da3e9eb-b8ef-42df-86e5-a1482b701c95	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 13:34:20.260113+00
f917cf5a-487d-432f-8968-62fc864dc6e9	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 13:35:52.443239+00
6e8babbc-e041-4e03-a15e-8c814b3c0931	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 14:10:52.057893+00
a3917483-f254-4ab0-9990-ba5223855e33	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 14:35:11.512715+00
c6288c71-d6af-4319-993b-9431dfb006bb	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 15:02:27.498573+00
f8fa2b9d-fd54-44a4-a1d4-190dfb8475ab	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 15:12:43.232073+00
ce6426c3-856d-4338-b784-e098133c6863	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 15:36:07.671624+00
17601175-6331-4da9-90a8-6552b02342c4	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 16:05:11.924422+00
63fd3158-e088-4619-a7a8-781f5ce68afa	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 16:34:02.145313+00
13045722-5097-4be6-b7fd-1052b434eb78	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 16:35:34.354124+00
4a5f3f9d-1f05-41bf-b48f-1a51b0148a2a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 17:07:24.702071+00
fb4f4886-d614-49cf-bd17-92d527475c14	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 17:36:40.103483+00
0722263d-2687-4ebf-84a7-90ec2bc868cc	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 18:18:34.079152+00
38d7426c-91e0-459e-84a1-e579f1778339	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 18:23:56.193319+00
47cedfa4-5140-4d32-8964-0b02673328f7	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 19:02:59.809346+00
9fef378d-42b2-4589-8798-106a7cb91e5e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 19:09:57.174413+00
a70c00e5-7370-4321-8671-dc54342fa658	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 19:54:33.462012+00
f7120c93-8759-481d-bbab-b3727897be7b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 20:11:51.716212+00
7a79363b-3bc4-4844-8f91-d21c1d40ab78	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 20:37:35.318393+00
402c429e-a3d4-4f5f-8a13-9bebc6e43c79	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 20:39:07.742158+00
33dff985-5dfe-4495-8270-6cd54a37411d	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 20:52:35.299756+00
730d1fbc-e68d-4db8-83fa-8102424b4549	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 20:54:07.538128+00
800a30b4-f561-4acb-8843-07f2e17e2462	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 21:07:35.223586+00
3a503c74-4400-4a00-8d24-4d68e7390ac8	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 21:09:07.455783+00
7ee73ab8-920d-4ad6-bddf-4a6b5bb0058b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 21:37:03.902849+00
eac6ecbf-164f-42b8-a62c-2756752569c2	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-29 21:40:15.474355+00
0eedce05-2a91-4ec0-a852-3054f600e0c4	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-30 19:11:27.16493+00
088d7d48-5ea5-4db6-9e52-62623990bd0f	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-30 19:32:56.661117+00
62277aaf-c34c-46c6-b02f-ad531be2097a	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-30 19:34:15.899238+00
bfeaffc3-5c04-4c8d-abb9-a7d292e8d419	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-30 19:35:59.417305+00
2b55b3b5-a2c3-4080-9666-db6ec0a11183	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-30 20:01:13.805965+00
8575c391-87e7-4443-98ea-dbc7d293b86e	6cabe266-b2f4-43f9-879c-06020c789a0b	\N	auth.logout	\N	\N	\N	::1	2026-04-30 21:29:58.217992+00
b90a6b74-34e5-4ff9-8207-fd28ae15b669	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-30 21:30:02.034868+00
648a8558-8df8-4698-b824-3f43e8479f55	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-30 21:38:17.266646+00
b80abd3a-bbc6-4ddb-b77a-36df65561bc2	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login	\N	\N	\N	::1	2026-04-30 21:38:22.330138+00
505707a8-1003-4d1a-bdc8-d5449e219245	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-30 21:38:29.067774+00
f38fb5bc-d7f2-41f0-98b0-e6ac40cec6fc	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.token_refresh	\N	\N	\N	::1	2026-04-30 21:38:34.483562+00
9e448ce5-2541-4153-af3f-203987039568	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-01 07:19:42.211607+00
8bc61cdf-6d57-4449-9be0-a9e5b6477905	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-01 07:22:56.889308+00
781bc02c-f7ed-43d5-b02f-60e25c9802b8	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-01 07:24:27.378563+00
6afeb0f5-5edf-4ab8-9dc6-338faa55db65	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-01 07:24:39.48073+00
5b8bd3cf-2d24-4a80-ad98-9d96c3736a3c	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-01 07:25:09.702764+00
e60e6fa0-9eab-49e8-bb7f-5e107d430093	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.account_locked	\N	\N	\N	::1	2026-05-01 07:25:09.747333+00
cca9e745-d8e1-4063-850c-173e44c66418	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:28:09.704411+00
24d658c4-1193-4a96-a761-a1131f2895b8	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.account_locked	\N	\N	\N	::1	2026-05-02 05:28:09.761072+00
dcd9920d-9c4d-45e9-879e-6acec8e6d31a	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-05-02 05:28:11.591991+00
7eecd179-3f10-4484-8744-c2cb34e73318	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-05-02 05:28:18.573099+00
f3fc51bb-99d6-4f84-ac85-7127598f4f7b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:29:27.329943+00
ded5307a-add5-45b6-8c6a-79359b00be68	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:30:05.699508+00
a84f64e8-69bd-4ed0-a68b-d1dc783e8bf9	\N	\N	auth.login_failed	\N	\N	{"email": "claude@mmffdev.com", "reason": "no_user"}	::1	2026-05-02 05:30:12.718071+00
b88eb06c-ad4c-48be-8133-334e3e29e842	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-05-02 05:31:19.257962+00
a7bd5195-efe4-4766-b7c8-f3dba90435af	\N	\N	auth.login_failed	\N	\N	{"email": "claude@mmffdev.com", "reason": "no_user"}	::1	2026-05-02 05:31:40.34874+00
f4635eca-031c-4705-86bf-5acf1a30a66c	583b8276-092f-4645-8e79-367fdcb5c4b6	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:31:40.646211+00
8a0ae562-6275-47ea-ada8-cfb131e056b9	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-05-02 05:31:40.705471+00
658c8646-afa6-4a8c-a679-9e6e56d31433	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:31:41.002795+00
cc6216fe-d84f-4d45-9138-da64436ed373	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-05-02 05:32:22.059304+00
6811b25c-ce87-4e5c-bc64-f93611a3a8d5	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-05-02 05:32:26.618223+00
54d20a46-6d2c-4a7c-adbd-edaa7aeb8018	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:32:32.129086+00
3d72ac7d-e5bf-4361-bbe2-78c641e3c5d9	583b8276-092f-4645-8e79-367fdcb5c4b6	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:32:36.32712+00
af6330d1-2788-429b-9eed-1e85c86bdef8	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:35:07.930285+00
54bff23d-c770-4a18-85aa-3e5a7b1c487a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	auth.account_locked	\N	\N	\N	::1	2026-05-02 05:35:07.965663+00
bc91db3e-3f53-4e2a-a68f-a32e38a72536	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	{"reason": "locked"}	::1	2026-05-02 05:35:08.007911+00
c097b242-25e8-4641-b5ef-a28c704763c4	583b8276-092f-4645-8e79-367fdcb5c4b6	00000000-0000-0000-0000-000000000001	auth.login_failed	\N	\N	\N	::1	2026-05-02 05:35:08.457579+00
5d948e55-0d35-4e59-973d-f27a8a6a4f92	583b8276-092f-4645-8e79-367fdcb5c4b6	00000000-0000-0000-0000-000000000001	auth.account_locked	\N	\N	\N	::1	2026-05-02 05:35:08.516242+00
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
-- Data for Name: defects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.defects (id, subscription_id, key_num, type_id, hierarchy_parent, linked_story, name, description, acceptance_criteria, notes, severity, steps_to_reproduce, environment, browser, regression, name_author, name_owner, schedule_state, flow_state, flow_state_change_update_date, flow_state_change_owner, date_work_accepted, blocked, blocked_reason, ready, expedite, sprint, release, estimate_hours, estimate_remaining, rank, risk_score, risk_impact, lidentifier_colour, lidentifier_type, created_at, updated_at, archived_at) FROM stdin;
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
-- Data for Name: item_field_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.item_field_definitions (id, subscription_id, entity_kind, item_type_id, custom_field_type, label, description, required, "position", creator_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: item_field_options; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.item_field_options (id, subscription_id, entity_kind, field_definition_id, label, value, "position", archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: item_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.item_field_values (id, subscription_id, entity_kind, entity_id, field_definition_id, value_text, value_number, value_boolean, value_date, value_jsonb, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: item_labels; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.item_labels (id, subscription_id, item_id, item_kind, label, created_at) FROM stdin;
\.


--
-- Data for Name: item_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.item_tags (id, subscription_id, item_id, item_kind, tag, created_at) FROM stdin;
\.


--
-- Data for Name: library_acknowledgements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_acknowledgements (subscription_id, release_id, acknowledged_at, acknowledged_by_user_id, action_taken) FROM stdin;
\.


--
-- Data for Name: o_artefact_note_reads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefact_note_reads (user_id, artefact_type, artefact_id, last_read_at) FROM stdin;
\.


--
-- Data for Name: o_artefact_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefact_notes (id, subscription_id, artefact_type, artefact_id, parent_note_id, content, created_by, created_at, archived_at) FROM stdin;
\.


--
-- Data for Name: o_artefact_type_registry; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefact_type_registry (scope_key, artefact_table, default_prefix, display_label, display_label_plural, description, phase, is_active, created_at) FROM stdin;
execution_user_stories	o_artefacts_execution_user_stories	US	User Story	User Stories	A unit of work expressed from the perspective of a user. Describes what a user wants to achieve and why.	PH-0005	t	2026-04-30 19:13:46.757453+00
execution_defects	o_artefacts_execution_defects	DE	Defect	Defects	A reported bug, regression, or quality issue. Tracks the problem, steps to reproduce, and resolution.	PH-0005	t	2026-04-30 19:13:46.757453+00
execution_tasks	o_artefacts_execution_tasks	TA	Task	Tasks	A discrete unit of technical or non-technical work. Typically owned by one person with a clear done state.	PH-0005	t	2026-04-30 19:13:46.757453+00
execution_test_cases	o_artefacts_execution_test_cases	TC	Test Case	Test Cases	A documented test scenario with steps and expected outcomes. Linked to user stories or defects.	PH-0005	t	2026-04-30 19:13:46.757453+00
strategic	o_artefacts_strategic	PI	Portfolio Item	Portfolio Items	A strategic planning artefact. Template forms express sub-types (Feature, Epic, Initiative, Theme).	PH-0005	t	2026-04-30 19:13:46.757453+00
\.


--
-- Data for Name: o_artefact_versions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefact_versions (id, subscription_id, artefact_type, artefact_id, version_num, snapshot_jsonb, change_summary, created_by, created_at, expires_at) FROM stdin;
\.


--
-- Data for Name: o_artefact_visibility_levels; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefact_visibility_levels (level, name, label, description, requires_scope_id) FROM stdin;
0	private	Private	Visible to the creator only.	f
1	product	Product	Visible to all members of the scoped product.	t
2	workspace	Workspace	Visible to all members of the scoped workspace.	t
3	tenant	Tenant	Visible to all members of the subscription.	f
\.


--
-- Data for Name: o_artefacts_execution_defects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_defects (id, subscription_id, key_num, title, description, content, content_plain_text, template_form_id, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_defects_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_defects_field_values (id, subscription_id, artefact_id, template_field_id, field_name, value_text, value_number, value_boolean, value_date, value_jsonb, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_defects_template_form_fields; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_defects_template_form_fields (id, template_form_id, field_name, field_label, field_type, required, "position", default_visibility, options_json, config_json, created_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_defects_template_forms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_defects_template_forms (id, subscription_id, name, description, visibility, visibility_scope_id, created_by, created_at, updated_at, archived_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_tasks (id, subscription_id, key_num, title, description, content, content_plain_text, template_form_id, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_tasks_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_tasks_field_values (id, subscription_id, artefact_id, template_field_id, field_name, value_text, value_number, value_boolean, value_date, value_jsonb, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_tasks_template_form_fields; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_tasks_template_form_fields (id, template_form_id, field_name, field_label, field_type, required, "position", default_visibility, options_json, config_json, created_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_tasks_template_forms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_tasks_template_forms (id, subscription_id, name, description, visibility, visibility_scope_id, created_by, created_at, updated_at, archived_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_test_cases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_test_cases (id, subscription_id, key_num, title, description, content, content_plain_text, template_form_id, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_test_cases_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_test_cases_field_values (id, subscription_id, artefact_id, template_field_id, field_name, value_text, value_number, value_boolean, value_date, value_jsonb, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_test_cases_template_form_fields; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_test_cases_template_form_fields (id, template_form_id, field_name, field_label, field_type, required, "position", default_visibility, options_json, config_json, created_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_test_cases_template_forms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_test_cases_template_forms (id, subscription_id, name, description, visibility, visibility_scope_id, created_by, created_at, updated_at, archived_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_user_stories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_user_stories (id, subscription_id, key_num, title, description, content, content_plain_text, template_form_id, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_user_stories_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_user_stories_field_values (id, subscription_id, artefact_id, template_field_id, field_name, value_text, value_number, value_boolean, value_date, value_jsonb, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_user_stories_template_form_fields; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_user_stories_template_form_fields (id, template_form_id, field_name, field_label, field_type, required, "position", default_visibility, options_json, config_json, created_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_user_stories_template_forms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_user_stories_template_forms (id, subscription_id, name, description, visibility, visibility_scope_id, created_by, created_at, updated_at, archived_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_strategic; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_strategic (id, subscription_id, key_num, title, description, content, content_plain_text, template_form_id, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index, hierarchy_parent_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_strategic_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_strategic_field_values (id, subscription_id, artefact_id, template_field_id, field_name, value_text, value_number, value_boolean, value_date, value_jsonb, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_strategic_template_form_fields; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_strategic_template_form_fields (id, template_form_id, field_name, field_label, field_type, required, "position", default_visibility, options_json, config_json, created_at) FROM stdin;
\.


--
-- Data for Name: o_artefacts_strategic_template_forms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_strategic_template_forms (id, subscription_id, name, description, visibility, visibility_scope_id, created_by, created_at, updated_at, archived_at) FROM stdin;
\.


--
-- Data for Name: o_search_index_outbox; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_search_index_outbox (id, artefact_type, artefact_id, enqueued_at, claimed_at, attempts, last_error) FROM stdin;
\.


--
-- Data for Name: o_subscription_artefact_type_overrides; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_subscription_artefact_type_overrides (subscription_id, scope_key, display_prefix, display_label, display_label_plural, updated_by, updated_at) FROM stdin;
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
-- Data for Name: portfolio_item_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_item_types (id, subscription_id, name, description, icon, colour, archived_at, created_at, updated_at) FROM stdin;
5bab5b36-a478-47fe-866f-43a4e88c983d	00000000-0000-0000-0000-000000000001	Feature	A feature to be built	\N	#0066CC	\N	2026-04-29 03:46:40.611389+00	2026-04-29 03:46:40.611389+00
\.


--
-- Data for Name: portfolio_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_items (id, subscription_id, key_num, type_id, hierarchy_parent, name, description, acceptance_criteria, notes, name_author, name_owner, flow_state, flow_state_change_update_date, flow_state_change_owner, blocked, blocked_reason, date_work_planned_start, date_work_planned_finish, date_work_started, date_work_accepted, estimate_initial, estimate_updated, risk_impact, risk_probability, risk_score, strategic_investment_group, strategic_investment_weight, strategic_item_type, value_stream_identifier, lidentifier_colour, lidentifier_labels, lidentifier_tags, count_child_defects, count_child_user_stories, count_dependants, count_rollup_defect, count_rollup_defects, count_rollup_estimation, count_rollup_risks, done_by_story_count, archived_at, created_at, updated_at) FROM stdin;
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
763f0ad1-7473-482d-9f71-f7286f210ac0	6cabe266-b2f4-43f9-879c-06020c789a0b	ca0339bc8f0c6f3c1b56dfdc91e5cbbdf27c86b321d162c7d62e9855af340f12	2026-04-28 23:55:09.211828+00	2026-05-05 23:55:09.222926+00	2026-04-28 23:55:09.211828+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
976ad1fb-9970-40af-86cf-ea5a6f2a6528	6cabe266-b2f4-43f9-879c-06020c789a0b	a91b74aef7802b42fe0bb1fe9f7eda21300768da758429fcef4edcbcf2490b37	2026-04-29 02:01:08.15567+00	2026-05-06 02:01:08.187617+00	2026-04-29 02:01:08.15567+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6868e5f2-2c26-4020-a5cc-07acb051a59a	6cabe266-b2f4-43f9-879c-06020c789a0b	b2bc0f31c4ca850aec339f4e52d8915e3dfd023d6f30be7d7db2fcc5554b3bc9	2026-04-29 02:06:01.983454+00	2026-05-06 02:06:02.013366+00	2026-04-29 02:06:01.983454+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9c3751f7-78a8-467e-8f98-8c500d982749	6cabe266-b2f4-43f9-879c-06020c789a0b	27a8a24c5c13546487b74a4831ae1983ae75bfab1ed16b84187b6bd6121f7511	2026-04-29 03:03:16.985227+00	2026-05-06 03:03:16.96529+00	2026-04-29 03:03:16.985227+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	f
11992a2b-a11e-47b3-9d19-5c3859a7f551	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	0fe49a2bab285683435f241b2d7df1f8df070a8dbb4bcd4a13c4706d5c92fe11	2026-04-29 02:50:11.094604+00	2026-05-06 02:50:11.063109+00	2026-04-29 02:50:11.094604+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
fb37cb4a-b4f2-4c95-adba-7bdced434c7d	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	bbdd443d819210ec35ed02562f47c9d14c6f7559a347849783679b4745075ba3	2026-04-29 03:03:44.303964+00	2026-05-06 03:03:44.33607+00	2026-04-29 03:03:44.303964+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
dcd05221-526e-4232-862a-6a2ca4d12c34	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	1e93b708266ea7086e3ba293fd8859d53ea5b3d9d31b344b059264753859571f	2026-04-29 03:08:16.520436+00	2026-05-06 03:08:16.565106+00	2026-04-29 03:08:16.520436+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
36db4735-c500-45eb-ad21-c60046afdcfd	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	6a6d25988cd31945e4a71eb5f3192f8d445182ba2653e6badebe407b864be216	2026-04-29 03:18:16.626015+00	2026-05-06 03:18:16.638825+00	2026-04-29 03:18:16.626015+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ad3b9313-8458-4cc4-8277-cd636d7147b0	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	d66e07639e7a37954505785e6046e03f64e87a74ccf75c81e66fa68899b3daa8	2026-04-29 03:22:53.359993+00	2026-05-06 03:22:53.386416+00	2026-04-29 03:22:53.359993+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
15d1c6ca-4608-4548-b449-c29a52a6ab97	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	47b0e5f196c27c6e21da2919700d7b32f16b3fab3a5212a9789132bb5d193461	2026-04-29 03:31:26.836193+00	2026-05-06 03:31:26.8491+00	2026-04-29 03:31:26.836193+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0776d5c6-7f1d-45ed-bc7d-f921861cbfec	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	ef54db0119240d9e0ab5fde4960d8dee9ef7115be9d9a1701bb581e128069a70	2026-04-29 03:33:17.763094+00	2026-05-06 03:33:17.793239+00	2026-04-29 03:33:17.763094+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
017863fb-35be-4864-8cb2-a965473c19ab	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	66c0db630337744955a205be259a9e16b741967bab283a3d92b19d29f2bbd337	2026-04-29 03:38:40.967545+00	2026-05-06 03:38:40.981442+00	2026-04-29 03:38:40.967545+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
cf9e88ac-58a9-46a7-b640-3a1df6d96d08	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	71577328d9d238fd3496613ca58d9bf8c79950a85ad29c3baf276ec001ffbeec	2026-04-29 03:41:14.777837+00	2026-05-06 03:41:14.806015+00	2026-04-29 03:41:14.777837+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
678191b9-4b98-4c08-80c0-9b770b40ec3c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	19a31d2e1d05de00f0822853fae128c13604405a2c1e69f0de634b72c23306aa	2026-04-29 03:48:17.805893+00	2026-05-06 03:48:17.822651+00	2026-04-29 03:48:17.805893+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6de4840f-10dc-4b2b-9457-f6acf0b9aad9	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	98ce30800212dc046feed9ac0eb04c72351ae483c7d03d74d8d9dce017688a03	2026-04-29 03:56:15.015557+00	2026-05-06 03:56:15.032997+00	2026-04-29 03:56:15.015557+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f0948cd1-5fb1-4e86-b26e-44e1462f16ef	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	58d514167d15f04cc68f34f4104b17d594da59feb699d43a5ee32729d27fae62	2026-04-29 04:02:32.83174+00	2026-05-06 04:02:32.84577+00	2026-04-29 04:02:32.83174+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
68b504a5-4d0d-4ae7-b613-3999b569e33b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	6a3bc039fe6af874aa34f47a6717afba10972014292eb99e896dea862e19847a	2026-04-29 04:03:47.721216+00	2026-05-06 04:03:47.735078+00	2026-04-29 04:03:47.721216+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6a8cd1c8-9a40-49bf-8cc5-4e86afb9616f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	e18ed1b529eed83dca89c1fdb3119ca61b3e147624dae7068030884a4309156a	2026-04-29 04:05:05.127924+00	2026-05-06 04:05:05.156427+00	2026-04-29 04:05:05.127924+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0e346688-2a27-46c1-b4d7-899937fe017f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	283661485a1a0f3bca8564448e194d7c25c9fb54faef3a2780f8d9f628397c80	2026-04-29 04:08:38.504645+00	2026-05-06 04:08:38.517749+00	2026-04-29 04:08:38.504645+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b51b4fdd-afeb-4c22-b56e-148a6ef1f08e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	ac2788d51af3d4c88c50729d5f592cd4aa859b1a5243193d73cbe0936564b74f	2026-04-29 04:13:11.538502+00	2026-05-06 04:13:11.556757+00	2026-04-29 04:13:11.538502+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
199c8cae-ba47-40f4-9675-26947cce3f4f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	155a92090ddcc729f1f298afea43e036c356850f13d6e51325873943e52f040d	2026-04-29 04:18:47.731578+00	2026-05-06 04:18:47.74769+00	2026-04-29 04:18:47.731578+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b58989c8-e9d9-4a05-973d-df67b5817886	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	785853f1af312c5bae66044415fd472a529cac11fd59582027b30f21e135d5a7	2026-04-29 04:33:47.732651+00	2026-05-06 04:33:47.75214+00	2026-04-29 04:33:47.732651+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
5546e1f7-f549-477c-a77f-39c2ffc25bd8	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	92df831bd65825bc01062ebb2f1e7ca57d3c63f85ea23419c99ccdb93f2c25e9	2026-04-29 04:40:51.590798+00	2026-05-06 04:40:51.602624+00	2026-04-29 04:40:51.590798+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
770cb7a4-1d11-403c-ac08-1bb3218c284f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	cdd1dd5101e8837494b968c7ff839489f932e1294f00e418394d6a24327faea3	2026-04-29 04:48:47.741015+00	2026-05-06 04:48:47.75533+00	2026-04-29 04:48:47.741015+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1b91a98f-f39a-47cf-b224-7553470c0c4e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	a2fa0e26d2ee97c6755b25c9e821178a191abbd1099c2fb686e23c2122ea6e31	2026-04-29 04:10:02.031685+00	2026-05-06 04:10:02.05726+00	2026-04-29 04:10:02.031685+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
453d464f-5a3b-4003-9bd6-3d17527d1c25	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	52f8bf1bda2188243e171ea84ebf44bdd13b0cacc84ca7c2efa9ae551a453091	2026-04-29 04:28:11.743771+00	2026-05-06 04:28:11.778714+00	2026-04-29 04:28:11.743771+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7ce383b6-a086-49c6-b9ce-158501155399	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	3177bce3e7e582f6c6ce909c844fff644b2825ae5ccc17a006c436b17278bc8f	2026-04-29 04:55:52.750127+00	2026-05-06 04:55:52.787076+00	2026-04-29 04:55:52.750127+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
48e3998c-726f-4ae3-8467-8c13e4b2b678	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	7943641a67e9f30c7d928148f57a9f2739d18c53974bdde42a30fe5794d6a4cb	2026-04-29 05:03:47.723873+00	2026-05-06 05:03:47.835739+00	2026-04-29 05:03:47.723873+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
dc26c412-2b56-46a3-952a-33756873926c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	c557c0c0b03b3d0b412cc9d53162280a256a992db066ae88b67f754113b727a5	2026-04-29 05:10:52.75199+00	2026-05-06 05:10:52.785505+00	2026-04-29 05:10:52.75199+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0b9e3877-aae3-41df-bcde-38dd994e1b1e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	b116dddeb13d7287117f52f0ec8aeb547f43363555ab7cf1cf9c2837c900d1ce	2026-04-29 05:18:47.723572+00	2026-05-06 05:18:47.738648+00	2026-04-29 05:18:47.723572+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6bc2af44-187a-4aa9-a18c-6fb3190f958a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	98a9a41b7453647a4fbbbd2e8e061e99315cc8008e4ada211ee2d03d0a97022f	2026-04-29 05:26:47.726688+00	2026-05-06 05:26:47.738131+00	2026-04-29 05:26:47.726688+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
61bc1a34-4c78-42e6-879f-b439322537e9	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	ab6c22f706f4eaf57e86c72cc15a88f16bc598079afa0ea1fc9acfbb4a36ebc7	2026-04-29 05:33:48.048914+00	2026-05-06 05:33:48.374068+00	2026-04-29 05:33:48.048914+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9c72f752-2cb4-44ee-b2d1-d6c219253b60	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	a44c5b4b5325da924f3a1f26b0dba8bc061cf0f7f1e59edd5c3513624ab5154b	2026-04-29 05:41:47.815772+00	2026-05-06 05:41:47.832769+00	2026-04-29 05:41:47.815772+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
cbdfb339-2ebc-4fa4-a0d3-cda7d2089f4d	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	88cc5f6db9d140f2c1fbec01726ed7d48dfdc9258c91da840504161d730715ba	2026-04-29 05:53:47.839362+00	2026-05-06 05:53:47.858337+00	2026-04-29 05:53:47.839362+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e94a24bf-502d-4e56-932d-5f47e4e8cfe0	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	2275fd805b61bbe1335d67fec334254140ff122f579af32dcfea97d350d9b294	2026-04-29 05:56:47.726327+00	2026-05-06 05:56:47.737238+00	2026-04-29 05:56:47.726327+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
34daa1bc-0f67-4e01-a5c4-b5788c132487	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	9dc0533ff2fe4f973a204d49578751c52bb9166659f665316933af5df3fb9e15	2026-04-29 06:08:47.806342+00	2026-05-06 06:08:47.817109+00	2026-04-29 06:08:47.806342+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
627f4463-9804-4a2a-bf4c-9f5a1042d2e5	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	26af9d3c8ea3877999471812e35fb298e4a4983a5961fb6886c74311aa1fe90d	2026-04-29 06:11:47.741336+00	2026-05-06 06:11:47.754946+00	2026-04-29 06:11:47.741336+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ff68751e-b4d9-4aa7-b6a3-fe2ecf38c2a0	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	2d5bc4fc66d8e36ba742c75bcf5aa951b50efc54b41b5e08a1aec7b768c2963d	2026-04-29 06:23:47.742125+00	2026-05-06 06:23:47.776946+00	2026-04-29 06:23:47.742125+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
d7a6ced5-5270-4360-9f69-e790c301c6bb	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	29e27efabd782b87f2cd85f7cdecf6d2f0f5af49639895c424540ed8c47393e0	2026-04-29 06:26:47.740856+00	2026-05-06 06:26:47.754901+00	2026-04-29 06:26:47.740856+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6d2a18c9-4afd-4584-926b-34ee7135b817	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	b67d73cd31a5162350c29e58196943ac61447d3fadd558dfa9d6840fc60e2292	2026-04-29 06:41:24.679617+00	2026-05-06 06:41:24.706458+00	2026-04-29 06:41:24.679617+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a8c97251-1e9c-4bd4-9693-98e48ec68f27	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	594f7357b6923c84f6ec2ffac78530a1e2b446e35613282f5f5b949a0aa81caf	2026-04-29 06:41:47.713343+00	2026-05-06 06:41:47.725337+00	2026-04-29 06:41:47.713343+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
141401af-58d7-452c-8004-c17bbfd6ef0b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	fff67634f60b397fa2f39f066188a7866d487845d845294922078bd036d40d1f	2026-04-29 06:56:24.932491+00	2026-05-06 06:56:24.970872+00	2026-04-29 06:56:24.932491+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
590723a5-2a16-49dd-83fc-ad840a2c1cc5	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	789bbf73c75da39ee699c215501a35968cba08e60b6515573407bb30f3f290e6	2026-04-29 06:56:47.750485+00	2026-05-06 06:56:47.870648+00	2026-04-29 06:56:47.750485+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
1f0a87ac-0cb5-4ed7-b557-c53e39a8fc7e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	29e6b2a798f2e752b255568fbedceec143a1e9ae57b2ac7e5ac54a5394ab563e	2026-04-29 07:11:25.721735+00	2026-05-06 07:11:25.739686+00	2026-04-29 07:11:25.721735+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
809e351f-b30c-4957-b3f0-81d4b0a600e0	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	522a593665629beb540c3d4ace4b6d8e77ec3f1435fa5ea7e69aded28503792c	2026-04-29 07:11:47.752084+00	2026-05-06 07:11:47.787094+00	2026-04-29 07:11:47.752084+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ac653daa-be1e-461b-bc83-d355ca6b8f29	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	0d181b1e821d3e40937e87d3c8ae902bac7e4df78102965d99053862538f5012	2026-04-29 07:23:19.728875+00	2026-05-06 07:23:19.746009+00	2026-04-29 07:23:19.728875+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
db3132f8-9a60-48ec-b71f-45b938d525d1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	d0ceba5a2402c83b9b9ac6d6f11e6924a86c8b5835bd2d8d1b9c28834f9203f0	2026-04-29 07:26:47.730126+00	2026-05-06 07:26:47.743736+00	2026-04-29 07:26:47.730126+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b08a2543-86c7-4f84-82a7-2bed4f683719	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	9d6a29683579b4756b76f6eeb4cccc6125856591efb984e2d13815ca9edf587b	2026-04-29 07:38:19.912086+00	2026-05-06 07:38:19.927917+00	2026-04-29 07:38:19.912086+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
72a14076-4999-461c-a36c-eb663ebc4c18	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	3134ccec09b4e0b75ba930a31a3177e32d40350184ccf7f021f293d6a7a4e2e8	2026-04-29 07:41:47.726914+00	2026-05-06 07:41:47.744379+00	2026-04-29 07:41:47.726914+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
26070a22-befb-44d0-887a-de878cb8511f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	e3ad22ee5c42c969bcda64d258d68c192446dc6a34a644c3102021e6769425c4	2026-04-29 07:53:19.915516+00	2026-05-06 07:53:19.934543+00	2026-04-29 07:53:19.915516+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
013b6bdf-f9e6-4e9a-8da6-a1c760655eae	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	37862ffd269febcf9e6d59139290adb74c946f11e6428a586ef16a577131c3e1	2026-04-29 07:56:47.777651+00	2026-05-06 07:56:47.790667+00	2026-04-29 07:56:47.777651+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a3f4ac04-46c8-4d44-9da0-b53e87836376	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	35de660174925ab84e251330e2851453bf788ff6d5775787f95ef715ee7ffff2	2026-04-29 08:08:19.914131+00	2026-05-06 08:08:19.934705+00	2026-04-29 08:08:19.914131+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
da816eb8-b25f-4659-af37-f549bb143f10	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	d9275ca44ebcfcf3b41aa97a1bb2a021126c92ecdf530a55deb084aa358e7b4a	2026-04-29 08:25:48.618759+00	2026-05-06 08:25:48.646638+00	2026-04-29 08:25:48.618759+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
661ca041-1f0b-4a8a-afb9-d2c92fbdfbf1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	d4e611ddebfe6aff0b03aa8478c29defb24ecf5efc589a841673c1050cc25787	2026-04-29 08:27:20.768692+00	2026-05-06 08:27:20.793823+00	2026-04-29 08:27:20.768692+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e59106c4-1679-494a-8745-99e548128646	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	c50541b69029bafaf881c2bddaec92baafe2028f41fa9eb800cf1979779a7e9a	2026-04-29 08:53:13.865434+00	2026-05-06 08:53:13.895016+00	2026-04-29 08:53:13.865434+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
54b7afdf-3030-4be3-b4e4-bfedd121148c	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	19b29e5b40935e74abae86f0d0a8fbea8a8979f70dd1b1f4c4682a70c77d0b91	2026-04-29 09:00:04.889735+00	2026-05-06 09:00:04.918872+00	2026-04-29 09:00:04.889735+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
deb3f4f4-1bd9-4271-a765-1f02ef199d07	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	674c67b4c87041b402227ed32157bbd5053effb63b7d03f1993f31951614e37a	2026-04-29 09:11:37.133088+00	2026-05-06 09:11:37.146433+00	2026-04-29 09:11:37.133088+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
63bbbbf9-ba90-49b5-ac8a-7c55c3a070b9	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	1cd754a95b62edfe05b55992b654070cfea001edcedd05b4a13a09319f2a0539	2026-04-29 09:15:04.867613+00	2026-05-06 09:15:04.881459+00	2026-04-29 09:15:04.867613+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
39f61eac-2e3a-4fdb-acdc-27c6a7a2d227	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	14695a82ca1292ff3318bed936297420f635cee2888b08b19de91ac2836a7488	2026-04-29 09:30:04.877208+00	2026-05-06 09:30:04.891688+00	2026-04-29 09:30:04.877208+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
98f3f143-f0aa-4e54-937f-1d10d60f0f1e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	5608d2268b6b5b199b20fee96a3a7e6f8aa1cf79bc20625c2169ae1b00e47bb8	2026-04-29 09:31:37.064227+00	2026-05-06 09:31:37.078464+00	2026-04-29 09:31:37.064227+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
03206129-aa80-44a3-a996-5aa27483d763	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	d26eaa2910fba9a4d45dbb26e5867fa97eb8877ee73f2e7ee37c0f3ecc53254b	2026-04-29 10:07:41.263799+00	2026-05-06 10:07:41.321675+00	2026-04-29 10:07:41.263799+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
399d3698-4f10-4ce4-aaf7-c0700da1217b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	a959cfa75312c2cddadcb74f28473493419fd595536147089f9977a8af359d30	2026-04-29 10:36:07.075113+00	2026-05-06 10:36:07.107894+00	2026-04-29 10:36:07.075113+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7210bfbf-a2f2-4301-aa79-a16a3dc113e8	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	05ff4666f542c9b748bf70e6860115f0fce7f3f8928adc25d7368cada52a06dc	2026-04-29 10:53:14.76731+00	2026-05-06 10:53:14.822733+00	2026-04-29 10:53:14.76731+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
58b12efc-7963-4557-8596-c39c11c59bfa	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	cc0a4e42f2fe2a98779ca04fb9e5f1cddd919368f6e7b70d11b3e9c1f07db5b1	2026-04-29 11:19:46.220266+00	2026-05-06 11:19:46.249031+00	2026-04-29 11:19:46.220266+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e06cde53-2d62-4b00-9c56-b687af24efee	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	e88517db0b7170b44481466c31293e0c5ad19da0c7cfc94957114d8b260611a0	2026-04-29 11:51:24.263885+00	2026-05-06 11:51:24.293772+00	2026-04-29 11:51:24.263885+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f1722b87-42a2-4908-ad08-49949f17a2d4	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	1856e4edb1d5557b727fcb739e6a10be44076f1663ee51eea1b09cc77c29d7f7	2026-04-29 11:52:55.031882+00	2026-05-06 11:52:55.058896+00	2026-04-29 11:52:55.031882+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
63f17d90-5107-4af0-aa4f-bee8cc059541	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	f00979829c84915f5a3159c8895e50a86228f9a6ddfae237e4218fa499b2dfc5	2026-04-29 12:11:33.374248+00	2026-05-06 12:11:33.404721+00	2026-04-29 12:11:33.374248+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9cfd2f62-209d-4c60-9c82-931797cf7085	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	dc2d832d506f5d5d7e889a08cb8eb7ef1cc471c0e0f50ac72cda290a220f4c5f	2026-04-29 12:22:07.602524+00	2026-05-06 12:22:07.630195+00	2026-04-29 12:22:07.602524+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
83a7b0c3-103a-4d5d-9f15-270764de6874	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	989a1da035adffd5d56fae96ac027a4ded4455743b5fa996eaa536d8ef73706a	2026-04-29 12:53:24.923802+00	2026-05-06 12:53:24.952828+00	2026-04-29 12:53:24.923802+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
11f2c84f-e87e-42b4-af52-1b21faa9a123	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	fc90822845e6fbad8d5bbab12676cc6b9de9e771d042b243b119f3ec4c53f03d	2026-04-29 12:54:57.095104+00	2026-05-06 12:54:57.128772+00	2026-04-29 12:54:57.095104+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bd1e7045-db4d-476e-8690-55468a9cbb19	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	37af2c99e666cf18a420f7ed4660bc3a5a48dfe61c79eb64776170678bed37ac	2026-04-29 13:08:24.899224+00	2026-05-06 13:08:24.913953+00	2026-04-29 13:08:24.899224+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
bbb80a75-ca6d-4f84-a7c5-661029176a8d	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	6f649690063b4baf7149b7e1c94857c17c58510f30771dbdee1b32c701020dd7	2026-04-29 13:14:57.079766+00	2026-05-06 13:14:57.094788+00	2026-04-29 13:14:57.079766+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
7051d6db-a267-4e44-aee6-e0a32e209c83	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	60682ef3a22e015ed0ce867b6a8550c92d3d7d78e7f5ebc39157529461564560	2026-04-29 13:34:20.20206+00	2026-05-06 13:34:20.215426+00	2026-04-29 13:34:20.20206+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9b211576-051b-4858-833b-c33401035f88	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	8f717303504137f4dcd8455d36da6312db1014540ddcd7d96f7d74773781565b	2026-04-29 13:35:52.382596+00	2026-05-06 13:35:52.39663+00	2026-04-29 13:35:52.382596+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e0711d86-2f2b-4c73-9bea-a00adef4b7a1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	349ad727e56c84f48a5ad8fb1daaafb84b78639f185179e8d98929333a2e6542	2026-04-29 14:10:51.935458+00	2026-05-06 14:10:51.962734+00	2026-04-29 14:10:51.935458+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
529bd0ba-5a73-48d4-8813-b026f96b7ac1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	fc86f33a11b3bc870cb3640abf793f9c22bbd90f145e764b32096e5163f03eaa	2026-04-29 14:35:11.409141+00	2026-05-06 14:35:11.43832+00	2026-04-29 14:35:11.409141+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ffffb920-5097-430e-b4d2-00ba52e300e4	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	ab1e19e014ee90f2e1d22d5c5178d33793912de424a3aef931569dac31d85578	2026-04-29 15:02:27.3447+00	2026-05-06 15:02:27.42368+00	2026-04-29 15:02:27.3447+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
86ef5b53-9d9a-4474-b706-efd53322dada	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	dfaf5a8ddba10ff287f837deff91a36c5562ceb21de455544b75ad82249c3c57	2026-04-29 15:12:43.109631+00	2026-05-06 15:12:43.137593+00	2026-04-29 15:12:43.109631+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
0a1045dc-3a4a-4ef5-b9a2-1c19365d5bbe	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	dea6adbc5a92dd6a4ab0cfd8cf7b3b67f5238d1350023dcec5b6d13f5def2299	2026-04-29 15:36:07.070321+00	2026-05-06 15:36:07.307578+00	2026-04-29 15:36:07.070321+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
18593a6e-c27f-4791-b2d5-27d5fc17e385	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	6961f4b18cfee96825ed57b2621b0ef8543214bab3e1b8272498eaa52e7a0887	2026-04-29 16:05:11.786315+00	2026-05-06 16:05:11.828389+00	2026-04-29 16:05:11.786315+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
dad6bc75-c2c7-485e-b5b2-fb6c58d5fc3f	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	58a8de0ab5d168e0a6dec45481d74787597c4307f497d199dedc109d3346f88b	2026-04-29 16:34:02.00358+00	2026-05-06 16:34:02.058853+00	2026-04-29 16:34:02.00358+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
712c15ea-6019-4554-bf55-8de86a760e34	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	d34eec094218d9a2b23db41c26150240f1d1f70d04b11d03a7aa82dc61f5b419	2026-04-29 16:35:34.235494+00	2026-05-06 16:35:34.268966+00	2026-04-29 16:35:34.235494+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4abff084-a6ff-40da-bcb6-70620b24c4ef	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	ed831c35a3bdc19f9d8b159dd4e5d19a713623445c412eb855df5e57cd8c8b94	2026-04-29 17:07:24.597246+00	2026-05-06 17:07:24.622124+00	2026-04-29 17:07:24.597246+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
27cc3ff3-9dd3-43fb-bc17-90d3d5e3cf33	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	6968507d8add6b129ff2d80f2d73309f2bb869e2c2ce85184db85d46e3e9b1a0	2026-04-29 17:36:39.983439+00	2026-05-06 17:36:40.017782+00	2026-04-29 17:36:39.983439+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6877aadf-e97e-459c-b2d9-50424b466949	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	a5b4ae2349e059df562dd2380b2e7d91f1b03d8da71c042018de0e7303b83a7e	2026-04-29 18:18:33.963139+00	2026-05-06 18:18:33.991842+00	2026-04-29 18:18:33.963139+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
53266c8a-e259-49a2-ac7b-64963569aecb	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	f50dade7e8650655083300f01d8843e971d131acc60a256eb87843268cacf293	2026-04-29 18:23:56.069658+00	2026-05-06 18:23:56.108352+00	2026-04-29 18:23:56.069658+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ce9e9e2c-5ab1-4599-a846-f44135609e8a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	113bb656d7265fbbdba8e3a8a0ca54cbf222836abdbebf8188c2cf2f94b5373d	2026-04-29 19:02:59.671794+00	2026-05-06 19:02:59.724139+00	2026-04-29 19:02:59.671794+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
c0d3a4a1-9f33-4754-8ac9-445f1848d67e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	82bc96fa7052a831849f7e5b2cbe11651164f3a2db7f18b851cf891743789bf3	2026-04-29 19:09:57.050585+00	2026-05-06 19:09:57.08054+00	2026-04-29 19:09:57.050585+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
4b792e5b-cc85-4379-a9ab-4b3d739e4e7a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	7406522ec87cfebd6bbc7bc5d6de9202c95cbb7156494fce368cbe45fa0a9db8	2026-04-29 19:54:33.320127+00	2026-05-06 19:54:33.357492+00	2026-04-29 19:54:33.320127+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
931be623-aa8f-4f04-a943-248df5d30fb1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	becac522c33d4569b5b970a4ec10b7d2999bc08527197b0cb5f4189abe052037	2026-04-29 20:11:51.507623+00	2026-05-06 20:11:51.580253+00	2026-04-29 20:11:51.507623+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
de7a6386-1842-4892-bd63-a34e7cd66f77	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	644ce349af8f99c44c796af17bdfc5e7bbbf9f0aff8e7206ce24b1660fd79ffd	2026-04-29 20:37:35.196858+00	2026-05-06 20:37:35.229873+00	2026-04-29 20:37:35.196858+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a634aa67-dcd1-4c08-904d-cacaf8fd60d7	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	c5b2241a79e1869d1af882498ee933c9b4d7c513d160a7f95642ee309c02da36	2026-04-29 20:39:07.458664+00	2026-05-06 20:39:07.572104+00	2026-04-29 20:39:07.458664+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e935aa43-b4c4-4abe-8e40-59d206d1e1ee	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	22cb446aa653595c39ba05205bd1e299c7b1606b5b2765ffa62b4363c701fee1	2026-04-29 20:52:35.176222+00	2026-05-06 20:52:35.208258+00	2026-04-29 20:52:35.176222+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
6b5f8bd5-fcc9-4325-b581-f712793eaac1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	b97db0c21f032c86c6e421dd2a86e1abd3a5ca2bbc2031d6b999961833d6b4dc	2026-04-29 20:54:07.450525+00	2026-05-06 20:54:07.467252+00	2026-04-29 20:54:07.450525+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
ea5b5475-f28b-45e1-8f05-fc7e43a1ee92	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	a5acb5a048c005085ffc2ed58e75cfbd739587b5d09e542cb6c26bb1b37c62d2	2026-04-29 21:07:35.156723+00	2026-05-06 21:07:35.170741+00	2026-04-29 21:07:35.156723+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
af7fa564-a392-4273-90e2-da209b4d92d9	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	354ebe57ea96015b4baafc30b438f9f001feba18a85535454ae460883e192997	2026-04-29 21:09:07.338945+00	2026-05-06 21:09:07.382885+00	2026-04-29 21:09:07.338945+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9c39c3ab-1f74-43f7-9cc0-33f2668ef174	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	89212401d283eb4ecc59c6dff9427ed7ed3c8a287bbd0ba0ea3e43fded96f711	2026-04-29 21:37:03.396344+00	2026-05-06 21:37:03.500509+00	2026-04-29 21:37:03.396344+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
8a8f1e52-8663-44a9-baaf-2b1bdf7c5ad1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	d7b22bdd64566a1b522775f0f0615a352ebb65606ec9d5e197cf619f1fbb3286	2026-04-29 21:40:15.252956+00	2026-05-06 21:40:15.357597+00	2026-04-29 21:40:15.252956+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
d3b402a2-e381-4242-99d2-0d860172704c	6cabe266-b2f4-43f9-879c-06020c789a0b	8e13473cdeb10d1b5ceaacdb5e3faced95c9ceba138aa3e3ba67f498eb54f7e7	2026-04-30 19:11:27.122037+00	2026-05-07 19:11:27.084888+00	2026-04-30 19:11:27.122037+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
a651e57f-c40c-42ff-8fad-4968587fee39	6cabe266-b2f4-43f9-879c-06020c789a0b	a6c5b1d885ad42310a6441884fa918bfdaf8d8a3fde5b981dec4a5f15e68ae7a	2026-04-30 19:32:56.575643+00	2026-05-07 19:32:56.607946+00	2026-04-30 19:32:56.575643+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f8071e6b-6965-4204-ada9-b993035c3c1f	6cabe266-b2f4-43f9-879c-06020c789a0b	e246e69b3eb7a9809ad2c462c7d3e0a96296a1b2a89addc0575cee59902932b6	2026-04-30 19:34:15.351648+00	2026-05-07 19:34:15.525353+00	2026-04-30 19:34:15.351648+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
9f4d5bf1-c029-48c7-b706-b523ed7d832f	6cabe266-b2f4-43f9-879c-06020c789a0b	2164cbec707867fc7f9f9a43321603dd434e4a3a61dd594da576c855db0b039c	2026-04-30 19:35:59.313339+00	2026-05-07 19:35:59.340321+00	2026-04-30 19:35:59.313339+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
46296988-b9b5-4586-8e3a-3b89cc10b09a	6cabe266-b2f4-43f9-879c-06020c789a0b	4d4fcd6d9ace90f3684fbf52e1a5512dada04b09e05e37f6c66a015e9e111362	2026-04-30 20:01:13.740056+00	2026-05-07 20:01:13.756253+00	2026-04-30 20:01:13.740056+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
e88cf4aa-01c0-4273-a916-5c6e3a2a9b4b	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	c09005a49d5a1dedd080b59db8a56e165a7b12639e422734e3f372a4e028c081	2026-04-30 21:30:02.00996+00	2026-05-07 21:30:01.97883+00	2026-04-30 21:30:02.00996+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
02dcffb6-c113-4963-a668-e7d3f70ae9b2	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	f9a4128808f80d012789b55337c41f2a716c03bf8f09bfd831dfcb55ef19e4ba	2026-04-30 21:38:17.195357+00	2026-05-07 21:38:17.224161+00	2026-04-30 21:38:17.195357+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
a231dc42-d07b-4824-8f8d-7192b0c31be5	6cabe266-b2f4-43f9-879c-06020c789a0b	a41b01f8d217ee64215a5df5de4220476b7a85c00a644fed6aaa120f68950215	2026-04-30 21:38:22.315829+00	2026-05-07 21:38:22.302203+00	2026-04-30 21:38:22.315829+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
f33d86c6-3664-4a3c-8ac7-89c32f5b672c	6cabe266-b2f4-43f9-879c-06020c789a0b	1dfe9b93f9d91745116876df8bb2fa68a7c24e2eb1899b64eb0dcf6d11591451	2026-04-30 21:38:28.961081+00	2026-05-07 21:38:28.989978+00	2026-04-30 21:38:28.961081+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	t
b8dd2ac4-3790-4532-8839-58674fb82854	6cabe266-b2f4-43f9-879c-06020c789a0b	3d7c91d2dce675913c8de738b4086124097f4c132eb59275174fa932815a608f	2026-04-30 21:38:34.425618+00	2026-05-07 21:38:34.440947+00	2026-04-30 21:38:34.425618+00	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	f
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
164a6043-e7c5-44cd-b9e3-af51d50a47bc	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	library-releases	0	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
5a3a3d7c-2fa6-4da8-af73-1a43acb030df	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	workspace-settings	1	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
1e218bcb-9973-41f1-8ba8-7b1522868172	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	portfolio-settings	2	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
df7f907f-f230-41df-8374-9bd3f8596fa1	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	theme	3	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
c094ff6d-babe-4d1e-97f8-b0baa45f6643	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	dashboard	4	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
49a4d438-25be-4206-a448-73555fa426bc	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	my-vista	5	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
742cbc6e-2156-4c94-8250-ec21dcbcc56e	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	favourites	6	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
825bfddc-6d18-4daa-9ef9-e458795d1593	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	backlog	7	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
6b8659f6-93b4-480c-ac05-47706e0bd563	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	planning	8	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
2962b59f-31b1-459e-a1bd-378d77dcb27a	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	portfolio	9	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
cba849cd-929d-49d9-8d62-8bc080a65223	4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	7a3b1532-92c1-4bd8-af12-6d176cb5f238	risk	10	f	2026-04-29 03:19:01.830856+00	2026-04-29 03:19:01.830856+00	\N	\N	\N
cf510ecf-ebdc-48e0-a6f6-ed53554b29b0	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	backlog	0	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
7a8e482c-39ad-470f-b350-2f9918396521	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	planning	1	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
cb8e6164-6966-4073-ba34-f92337b4a302	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	portfolio	2	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
6f503048-ddaa-4012-bdc8-51aad4b28d12	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	dashboard	3	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
4ee1439b-6671-4734-80e9-173c52765014	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	my-vista	4	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
cdac7ead-a354-4289-9415-355cf3f11245	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	favourites	5	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
bfff9ca0-567e-4e51-bab9-21f6c227405b	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	risk	6	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
c6302ed5-2c52-4a30-a736-b22f556ca612	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	portfolio-settings	7	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
7c43b82f-b804-45b7-8da1-2cb7995bfeb2	6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	bdba043f-5196-4c89-94fd-3bb7893e1bf1	portfolio-model	8	f	2026-04-30 21:38:51.297925+00	2026-04-30 21:38:51.297925+00	\N	\N	\N
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
-- Data for Name: user_stories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_stories (id, subscription_id, key_num, type_id, hierarchy_parent, name, description, acceptance_criteria, notes, name_author, name_owner, schedule_state, flow_state, flow_state_change_update_date, flow_state_change_owner, date_work_accepted, blocked, blocked_reason, ready, expedite, affects_doc, sprint, release, estimate_points, estimate_hours, estimate_remaining, rank, risk_score, risk_impact, risk_probability, lidentifier_colour, lidentifier_type, count_child_tasks, count_child_defects, count_child_test_cases, test_case_status, defect_status, created_at, updated_at, archived_at) FROM stdin;
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
6cabe266-b2f4-43f9-879c-06020c789a0b	00000000-0000-0000-0000-000000000001	padmin@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	padmin	t	2026-04-30 21:38:22.297403+00	2026-04-27 10:56:53.920205+00	2026-05-02 05:28:09.739175+00	local	\N	f	\N	6	2026-05-02 05:43:09.70665+00	f	\N	\N	\N	bdba043f-5196-4c89-94fd-3bb7893e1bf1	coral-tide
4932dd55-7cb3-4ff1-8c09-58324cb0c8ed	00000000-0000-0000-0000-000000000001	gadmin@mmffdev.com	$2a$12$c5bqRYJr1TqLc5MN3cP2j.AnFofNIl/X00u3aDAFlMiSY/fv9TwBK	gadmin	t	2026-04-30 21:30:01.970137+00	2026-04-27 10:56:53.920205+00	2026-05-02 05:35:07.949392+00	local	\N	f	2026-04-28 02:44:27.437598+00	5	2026-05-02 05:50:07.93277+00	f	\N	\N	\N	7a3b1532-92c1-4bd8-af12-6d176cb5f238	default
583b8276-092f-4645-8e79-367fdcb5c4b6	00000000-0000-0000-0000-000000000001	user@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	user	t	\N	2026-04-27 10:56:53.920205+00	2026-05-02 05:35:08.480693+00	local	\N	f	\N	5	2026-05-02 05:50:08.463844+00	f	\N	\N	\N	\N	default
\.


--
-- Data for Name: workspace; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workspace (id, subscription_id, company_roadmap_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Name: o_search_index_outbox_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.o_search_index_outbox_id_seq', 1, false);


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
-- Name: defects defects_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: defects defects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_pkey PRIMARY KEY (id);


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
-- Name: item_field_definitions item_field_definitions_label_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_definitions
    ADD CONSTRAINT item_field_definitions_label_unique UNIQUE (subscription_id, entity_kind, item_type_id, label);


--
-- Name: item_field_definitions item_field_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_definitions
    ADD CONSTRAINT item_field_definitions_pkey PRIMARY KEY (id);


--
-- Name: item_field_options item_field_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_options
    ADD CONSTRAINT item_field_options_pkey PRIMARY KEY (id);


--
-- Name: item_field_options item_field_options_value_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_options
    ADD CONSTRAINT item_field_options_value_unique UNIQUE (field_definition_id, value);


--
-- Name: item_field_values item_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_values
    ADD CONSTRAINT item_field_values_pkey PRIMARY KEY (id);


--
-- Name: item_labels item_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_labels
    ADD CONSTRAINT item_labels_pkey PRIMARY KEY (id);


--
-- Name: item_labels item_labels_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_labels
    ADD CONSTRAINT item_labels_unique UNIQUE (subscription_id, item_id, item_kind, label);


--
-- Name: item_tags item_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tags
    ADD CONSTRAINT item_tags_pkey PRIMARY KEY (id);


--
-- Name: item_tags item_tags_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tags
    ADD CONSTRAINT item_tags_unique UNIQUE (subscription_id, item_id, item_kind, tag);


--
-- Name: library_acknowledgements library_acknowledgements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_acknowledgements
    ADD CONSTRAINT library_acknowledgements_pkey PRIMARY KEY (subscription_id, release_id);


--
-- Name: o_artefact_note_reads o_artefact_note_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_note_reads
    ADD CONSTRAINT o_artefact_note_reads_pkey PRIMARY KEY (user_id, artefact_type, artefact_id);


--
-- Name: o_artefact_notes o_artefact_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_notes
    ADD CONSTRAINT o_artefact_notes_pkey PRIMARY KEY (id);


--
-- Name: o_artefact_type_registry o_artefact_type_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_type_registry
    ADD CONSTRAINT o_artefact_type_registry_pkey PRIMARY KEY (scope_key);


--
-- Name: o_artefact_versions o_artefact_versions_artefact_type_artefact_id_version_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_versions
    ADD CONSTRAINT o_artefact_versions_artefact_type_artefact_id_version_num_key UNIQUE (artefact_type, artefact_id, version_num);


--
-- Name: o_artefact_versions o_artefact_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_versions
    ADD CONSTRAINT o_artefact_versions_pkey PRIMARY KEY (id);


--
-- Name: o_artefact_visibility_levels o_artefact_visibility_levels_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_visibility_levels
    ADD CONSTRAINT o_artefact_visibility_levels_name_key UNIQUE (name);


--
-- Name: o_artefact_visibility_levels o_artefact_visibility_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_visibility_levels
    ADD CONSTRAINT o_artefact_visibility_levels_pkey PRIMARY KEY (level);


--
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field__artefact_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field__artefact_id_field_name_key UNIQUE (artefact_id, field_name);


--
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field_values_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_subscription_id_key_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_subscription_id_key_num_key UNIQUE (subscription_id, key_num);


--
-- Name: o_artefacts_execution_defects_template_form_fields o_artefacts_execution_defects_t_template_form_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_defects_t_template_form_id_field_name_key UNIQUE (template_form_id, field_name);


--
-- Name: o_artefacts_execution_defects_template_form_fields o_artefacts_execution_defects_template_form_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_defects_template_form_fields_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_defects_template_forms o_artefacts_execution_defects_template_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_template_forms
    ADD CONSTRAINT o_artefacts_execution_defects_template_forms_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_va_artefact_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_va_artefact_id_field_name_key UNIQUE (artefact_id, field_name);


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_subscription_id_key_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_subscription_id_key_num_key UNIQUE (subscription_id, key_num);


--
-- Name: o_artefacts_execution_tasks_template_form_fields o_artefacts_execution_tasks_tem_template_form_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_tasks_tem_template_form_id_field_name_key UNIQUE (template_form_id, field_name);


--
-- Name: o_artefacts_execution_tasks_template_form_fields o_artefacts_execution_tasks_template_form_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_tasks_template_form_fields_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_tasks_template_forms o_artefacts_execution_tasks_template_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_template_forms
    ADD CONSTRAINT o_artefacts_execution_tasks_template_forms_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_test_cases_template_form_fields o_artefacts_execution_test_case_template_form_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_test_case_template_form_id_field_name_key UNIQUE (template_form_id, field_name);


--
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_fie_artefact_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_fie_artefact_id_field_name_key UNIQUE (artefact_id, field_name);


--
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_field_values_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_test_cases o_artefacts_execution_test_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases
    ADD CONSTRAINT o_artefacts_execution_test_cases_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_test_cases o_artefacts_execution_test_cases_subscription_id_key_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases
    ADD CONSTRAINT o_artefacts_execution_test_cases_subscription_id_key_num_key UNIQUE (subscription_id, key_num);


--
-- Name: o_artefacts_execution_test_cases_template_form_fields o_artefacts_execution_test_cases_template_form_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_test_cases_template_form_fields_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_test_cases_template_forms o_artefacts_execution_test_cases_template_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_template_forms
    ADD CONSTRAINT o_artefacts_execution_test_cases_template_forms_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_user_stories_template_form_fields o_artefacts_execution_user_stor_template_form_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_user_stor_template_form_id_field_name_key UNIQUE (template_form_id, field_name);


--
-- Name: o_artefacts_execution_user_stories_field_values o_artefacts_execution_user_stories_f_artefact_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_f_artefact_id_field_name_key UNIQUE (artefact_id, field_name);


--
-- Name: o_artefacts_execution_user_stories_field_values o_artefacts_execution_user_stories_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_values_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_user_stories o_artefacts_execution_user_stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories
    ADD CONSTRAINT o_artefacts_execution_user_stories_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_user_stories o_artefacts_execution_user_stories_subscription_id_key_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories
    ADD CONSTRAINT o_artefacts_execution_user_stories_subscription_id_key_num_key UNIQUE (subscription_id, key_num);


--
-- Name: o_artefacts_execution_user_stories_template_form_fields o_artefacts_execution_user_stories_template_form_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_user_stories_template_form_fields_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_user_stories_template_forms o_artefacts_execution_user_stories_template_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_template_forms
    ADD CONSTRAINT o_artefacts_execution_user_stories_template_forms_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_artefact_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_artefact_id_field_name_key UNIQUE (artefact_id, field_name);


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_strategic o_artefacts_strategic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_strategic o_artefacts_strategic_subscription_id_key_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_subscription_id_key_num_key UNIQUE (subscription_id, key_num);


--
-- Name: o_artefacts_strategic_template_form_fields o_artefacts_strategic_template__template_form_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_template_form_fields
    ADD CONSTRAINT o_artefacts_strategic_template__template_form_id_field_name_key UNIQUE (template_form_id, field_name);


--
-- Name: o_artefacts_strategic_template_form_fields o_artefacts_strategic_template_form_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_template_form_fields
    ADD CONSTRAINT o_artefacts_strategic_template_form_fields_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_strategic_template_forms o_artefacts_strategic_template_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_template_forms
    ADD CONSTRAINT o_artefacts_strategic_template_forms_pkey PRIMARY KEY (id);


--
-- Name: o_search_index_outbox o_search_index_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_search_index_outbox
    ADD CONSTRAINT o_search_index_outbox_pkey PRIMARY KEY (id);


--
-- Name: o_subscription_artefact_type_overrides o_subscription_artefact_type_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_subscription_artefact_type_overrides
    ADD CONSTRAINT o_subscription_artefact_type_overrides_pkey PRIMARY KEY (subscription_id, scope_key);


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
-- Name: portfolio_item_types portfolio_item_types_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_item_types
    ADD CONSTRAINT portfolio_item_types_name_unique UNIQUE (subscription_id, name);


--
-- Name: portfolio_item_types portfolio_item_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_item_types
    ADD CONSTRAINT portfolio_item_types_pkey PRIMARY KEY (id);


--
-- Name: portfolio_items portfolio_items_key_num_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_key_num_unique UNIQUE (subscription_id, key_num);


--
-- Name: portfolio_items portfolio_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_pkey PRIMARY KEY (id);


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
-- Name: user_stories user_stories_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stories
    ADD CONSTRAINT user_stories_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: user_stories user_stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stories
    ADD CONSTRAINT user_stories_pkey PRIMARY KEY (id);


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
-- Name: idx_defects_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defects_active ON public.defects USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_defects_linked_story; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defects_linked_story ON public.defects USING btree (linked_story) WHERE (linked_story IS NOT NULL);


--
-- Name: idx_defects_schedule_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defects_schedule_state ON public.defects USING btree (subscription_id, schedule_state) WHERE (archived_at IS NULL);


--
-- Name: idx_defects_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defects_severity ON public.defects USING btree (subscription_id, severity) WHERE (archived_at IS NULL);


--
-- Name: idx_defects_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defects_subscription_id ON public.defects USING btree (subscription_id);


--
-- Name: idx_defects_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defects_type_id ON public.defects USING btree (subscription_id, type_id);


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
-- Name: idx_item_field_definitions_entity_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_definitions_entity_kind ON public.item_field_definitions USING btree (subscription_id, entity_kind) WHERE (archived_at IS NULL);


--
-- Name: idx_item_field_definitions_item_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_definitions_item_type ON public.item_field_definitions USING btree (item_type_id) WHERE (archived_at IS NULL);


--
-- Name: idx_item_field_definitions_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_definitions_subscription ON public.item_field_definitions USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_item_field_options_entity_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_options_entity_kind ON public.item_field_options USING btree (subscription_id, entity_kind) WHERE (archived_at IS NULL);


--
-- Name: idx_item_field_options_field_definition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_options_field_definition ON public.item_field_options USING btree (field_definition_id) WHERE (archived_at IS NULL);


--
-- Name: idx_item_field_options_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_options_subscription ON public.item_field_options USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_item_field_values_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_values_entity_id ON public.item_field_values USING btree (entity_kind, entity_id);


--
-- Name: idx_item_field_values_entity_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_values_entity_kind ON public.item_field_values USING btree (subscription_id, entity_kind);


--
-- Name: idx_item_field_values_field_definition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_values_field_definition ON public.item_field_values USING btree (field_definition_id);


--
-- Name: idx_item_field_values_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_field_values_subscription ON public.item_field_values USING btree (subscription_id);


--
-- Name: idx_item_labels_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_labels_item ON public.item_labels USING btree (item_id, item_kind);


--
-- Name: idx_item_labels_label_scan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_labels_label_scan ON public.item_labels USING btree (subscription_id, item_kind, label);


--
-- Name: idx_item_tags_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_tags_item ON public.item_tags USING btree (item_id, item_kind);


--
-- Name: idx_item_tags_tag_scan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_tags_tag_scan ON public.item_tags USING btree (subscription_id, item_kind, tag);


--
-- Name: idx_library_acks_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_acks_release ON public.library_acknowledgements USING btree (release_id);


--
-- Name: idx_library_acks_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_acks_subscription ON public.library_acknowledgements USING btree (subscription_id, acknowledged_at DESC);


--
-- Name: idx_o_an_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_an_artefact ON public.o_artefact_notes USING btree (artefact_type, artefact_id, created_at) WHERE (archived_at IS NULL);


--
-- Name: idx_o_an_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_an_parent ON public.o_artefact_notes USING btree (parent_note_id) WHERE ((parent_note_id IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: idx_o_an_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_an_sub ON public.o_artefact_notes USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_anr_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_anr_user ON public.o_artefact_note_reads USING btree (user_id, last_read_at DESC);


--
-- Name: idx_o_av_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_av_artefact ON public.o_artefact_versions USING btree (artefact_type, artefact_id, version_num DESC);


--
-- Name: idx_o_av_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_av_expires ON public.o_artefact_versions USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_o_de_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_fv_artefact ON public.o_artefacts_execution_defects_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_de_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_fv_sub ON public.o_artefacts_execution_defects_field_values USING btree (subscription_id);


--
-- Name: idx_o_de_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_search ON public.o_artefacts_execution_defects USING gin (search_index);


--
-- Name: idx_o_de_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_sub_created ON public.o_artefacts_execution_defects USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_de_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_sub_owner ON public.o_artefacts_execution_defects USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_de_tf_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_tf_sub ON public.o_artefacts_execution_defects_template_forms USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_de_tff_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_tff_form ON public.o_artefacts_execution_defects_template_form_fields USING btree (template_form_id, "position");


--
-- Name: idx_o_pi_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_pi_fv_artefact ON public.o_artefacts_strategic_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_pi_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_pi_fv_sub ON public.o_artefacts_strategic_field_values USING btree (subscription_id);


--
-- Name: idx_o_pi_hierarchy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_pi_hierarchy ON public.o_artefacts_strategic USING btree (hierarchy_parent_id) WHERE ((hierarchy_parent_id IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: idx_o_pi_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_pi_search ON public.o_artefacts_strategic USING gin (search_index);


--
-- Name: idx_o_pi_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_pi_sub_created ON public.o_artefacts_strategic USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_pi_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_pi_sub_owner ON public.o_artefacts_strategic USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_pi_tf_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_pi_tf_sub ON public.o_artefacts_strategic_template_forms USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_pi_tff_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_pi_tff_form ON public.o_artefacts_strategic_template_form_fields USING btree (template_form_id, "position");


--
-- Name: idx_o_sato_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_sato_sub ON public.o_subscription_artefact_type_overrides USING btree (subscription_id);


--
-- Name: idx_o_sio_claimed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_sio_claimed ON public.o_search_index_outbox USING btree (claimed_at) WHERE (claimed_at IS NOT NULL);


--
-- Name: idx_o_sio_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_o_sio_dedup ON public.o_search_index_outbox USING btree (artefact_type, artefact_id) WHERE (claimed_at IS NULL);


--
-- Name: idx_o_sio_unclaimed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_sio_unclaimed ON public.o_search_index_outbox USING btree (enqueued_at) WHERE (claimed_at IS NULL);


--
-- Name: idx_o_ta_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_fv_artefact ON public.o_artefacts_execution_tasks_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_ta_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_fv_sub ON public.o_artefacts_execution_tasks_field_values USING btree (subscription_id);


--
-- Name: idx_o_ta_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_search ON public.o_artefacts_execution_tasks USING gin (search_index);


--
-- Name: idx_o_ta_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_sub_created ON public.o_artefacts_execution_tasks USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_ta_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_sub_owner ON public.o_artefacts_execution_tasks USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_ta_tf_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_tf_sub ON public.o_artefacts_execution_tasks_template_forms USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_ta_tff_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_tff_form ON public.o_artefacts_execution_tasks_template_form_fields USING btree (template_form_id, "position");


--
-- Name: idx_o_tc_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_fv_artefact ON public.o_artefacts_execution_test_cases_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_tc_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_fv_sub ON public.o_artefacts_execution_test_cases_field_values USING btree (subscription_id);


--
-- Name: idx_o_tc_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_search ON public.o_artefacts_execution_test_cases USING gin (search_index);


--
-- Name: idx_o_tc_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_sub_created ON public.o_artefacts_execution_test_cases USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_tc_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_sub_owner ON public.o_artefacts_execution_test_cases USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_tc_tf_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_tf_sub ON public.o_artefacts_execution_test_cases_template_forms USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_tc_tff_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_tff_form ON public.o_artefacts_execution_test_cases_template_form_fields USING btree (template_form_id, "position");


--
-- Name: idx_o_us_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_us_fv_artefact ON public.o_artefacts_execution_user_stories_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_us_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_us_fv_sub ON public.o_artefacts_execution_user_stories_field_values USING btree (subscription_id);


--
-- Name: idx_o_us_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_us_search ON public.o_artefacts_execution_user_stories USING gin (search_index);


--
-- Name: idx_o_us_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_us_sub_created ON public.o_artefacts_execution_user_stories USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_us_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_us_sub_owner ON public.o_artefacts_execution_user_stories USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_us_tf_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_us_tf_sub ON public.o_artefacts_execution_user_stories_template_forms USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_us_tff_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_us_tff_form ON public.o_artefacts_execution_user_stories_template_form_fields USING btree (template_form_id, "position");


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
-- Name: idx_portfolio_item_types_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_item_types_subscription ON public.portfolio_item_types USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_items_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_items_created_at ON public.portfolio_items USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_items_flow_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_items_flow_state ON public.portfolio_items USING btree (flow_state) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_items_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_items_owner ON public.portfolio_items USING btree (name_owner) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_items_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_items_parent ON public.portfolio_items USING btree (hierarchy_parent) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_items_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_items_subscription ON public.portfolio_items USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_items_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_items_type ON public.portfolio_items USING btree (type_id) WHERE (archived_at IS NULL);


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
-- Name: idx_user_stories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_stories_active ON public.user_stories USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_user_stories_hierarchy_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_stories_hierarchy_parent ON public.user_stories USING btree (hierarchy_parent) WHERE (hierarchy_parent IS NOT NULL);


--
-- Name: idx_user_stories_schedule_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_stories_schedule_state ON public.user_stories USING btree (subscription_id, schedule_state) WHERE (archived_at IS NULL);


--
-- Name: idx_user_stories_sprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_stories_sprint ON public.user_stories USING btree (sprint) WHERE (sprint IS NOT NULL);


--
-- Name: idx_user_stories_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_stories_subscription_id ON public.user_stories USING btree (subscription_id);


--
-- Name: idx_user_stories_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_stories_type_id ON public.user_stories USING btree (subscription_id, type_id);


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
-- Name: defects trg_defects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defects_updated_at BEFORE UPDATE ON public.defects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: item_field_definitions trg_item_field_definitions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_field_definitions_updated_at BEFORE UPDATE ON public.item_field_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: item_field_options trg_item_field_options_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_field_options_updated_at BEFORE UPDATE ON public.item_field_options FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: item_field_values trg_item_field_values_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_field_values_updated_at BEFORE UPDATE ON public.item_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_defects_field_values trg_o_de_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_de_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_defects_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_defects_template_forms trg_o_de_tf_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_de_tf_updated_at BEFORE UPDATE ON public.o_artefacts_execution_defects_template_forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_defects trg_o_de_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_de_updated_at BEFORE UPDATE ON public.o_artefacts_execution_defects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_strategic_field_values trg_o_pi_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_pi_fv_updated_at BEFORE UPDATE ON public.o_artefacts_strategic_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_strategic_template_forms trg_o_pi_tf_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_pi_tf_updated_at BEFORE UPDATE ON public.o_artefacts_strategic_template_forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_strategic trg_o_pi_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_pi_updated_at BEFORE UPDATE ON public.o_artefacts_strategic FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_tasks_field_values trg_o_ta_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_ta_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_tasks_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_tasks_template_forms trg_o_ta_tf_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_ta_tf_updated_at BEFORE UPDATE ON public.o_artefacts_execution_tasks_template_forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_tasks trg_o_ta_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_ta_updated_at BEFORE UPDATE ON public.o_artefacts_execution_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_test_cases_field_values trg_o_tc_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_tc_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_test_cases_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_test_cases_template_forms trg_o_tc_tf_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_tc_tf_updated_at BEFORE UPDATE ON public.o_artefacts_execution_test_cases_template_forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_test_cases trg_o_tc_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_tc_updated_at BEFORE UPDATE ON public.o_artefacts_execution_test_cases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_user_stories_field_values trg_o_us_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_us_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_user_stories_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_user_stories_template_forms trg_o_us_tf_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_us_tf_updated_at BEFORE UPDATE ON public.o_artefacts_execution_user_stories_template_forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_user_stories trg_o_us_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_us_updated_at BEFORE UPDATE ON public.o_artefacts_execution_user_stories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: portfolio_item_types trg_portfolio_item_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_item_types_updated_at BEFORE UPDATE ON public.portfolio_item_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_items trg_portfolio_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_items_updated_at BEFORE UPDATE ON public.portfolio_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: user_stories trg_user_stories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_stories_updated_at BEFORE UPDATE ON public.user_stories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: defects defects_flow_state_change_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_flow_state_change_owner_fkey FOREIGN KEY (flow_state_change_owner) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: defects defects_linked_story_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_linked_story_fkey FOREIGN KEY (linked_story) REFERENCES public.user_stories(id) ON DELETE SET NULL;


--
-- Name: defects defects_name_author_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_name_author_fkey FOREIGN KEY (name_author) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: defects defects_name_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_name_owner_fkey FOREIGN KEY (name_owner) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: defects defects_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: defects defects_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defects
    ADD CONSTRAINT defects_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.execution_item_types(id) ON DELETE RESTRICT;


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
-- Name: item_field_definitions item_field_definitions_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_definitions
    ADD CONSTRAINT item_field_definitions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: item_field_definitions item_field_definitions_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_definitions
    ADD CONSTRAINT item_field_definitions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: item_field_options item_field_options_field_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_options
    ADD CONSTRAINT item_field_options_field_definition_id_fkey FOREIGN KEY (field_definition_id) REFERENCES public.item_field_definitions(id) ON DELETE RESTRICT;


--
-- Name: item_field_options item_field_options_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_options
    ADD CONSTRAINT item_field_options_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: item_field_values item_field_values_field_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_values
    ADD CONSTRAINT item_field_values_field_definition_id_fkey FOREIGN KEY (field_definition_id) REFERENCES public.item_field_definitions(id) ON DELETE RESTRICT;


--
-- Name: item_field_values item_field_values_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_field_values
    ADD CONSTRAINT item_field_values_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: item_labels item_labels_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_labels
    ADD CONSTRAINT item_labels_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: item_tags item_tags_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_tags
    ADD CONSTRAINT item_tags_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


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
-- Name: o_artefact_note_reads o_artefact_note_reads_artefact_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_note_reads
    ADD CONSTRAINT o_artefact_note_reads_artefact_type_fkey FOREIGN KEY (artefact_type) REFERENCES public.o_artefact_type_registry(scope_key) ON DELETE CASCADE;


--
-- Name: o_artefact_note_reads o_artefact_note_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_note_reads
    ADD CONSTRAINT o_artefact_note_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: o_artefact_notes o_artefact_notes_artefact_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_notes
    ADD CONSTRAINT o_artefact_notes_artefact_type_fkey FOREIGN KEY (artefact_type) REFERENCES public.o_artefact_type_registry(scope_key) ON DELETE RESTRICT;


--
-- Name: o_artefact_notes o_artefact_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_notes
    ADD CONSTRAINT o_artefact_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefact_notes o_artefact_notes_parent_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_notes
    ADD CONSTRAINT o_artefact_notes_parent_note_id_fkey FOREIGN KEY (parent_note_id) REFERENCES public.o_artefact_notes(id) ON DELETE SET NULL;


--
-- Name: o_artefact_notes o_artefact_notes_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_notes
    ADD CONSTRAINT o_artefact_notes_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefact_versions o_artefact_versions_artefact_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_versions
    ADD CONSTRAINT o_artefact_versions_artefact_type_fkey FOREIGN KEY (artefact_type) REFERENCES public.o_artefact_type_registry(scope_key) ON DELETE RESTRICT;


--
-- Name: o_artefact_versions o_artefact_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_versions
    ADD CONSTRAINT o_artefact_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefact_versions o_artefact_versions_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefact_versions
    ADD CONSTRAINT o_artefact_versions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field_valu_template_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field_valu_template_field_id_fkey FOREIGN KEY (template_field_id) REFERENCES public.o_artefacts_execution_defects_template_form_fields(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field_values_artefact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field_values_artefact_id_fkey FOREIGN KEY (artefact_id) REFERENCES public.o_artefacts_execution_defects(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field_values_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field_values_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field_values_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field_values_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field_values_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field_values_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects_template_form_fields o_artefacts_execution_defects_template__default_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_defects_template__default_visibility_fkey FOREIGN KEY (default_visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_defects_template_form_fields o_artefacts_execution_defects_template_fo_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_defects_template_fo_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_execution_defects_template_forms(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_defects_template_forms o_artefacts_execution_defects_template_for_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_template_forms
    ADD CONSTRAINT o_artefacts_execution_defects_template_for_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_execution_defects_template_forms(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_defects_template_forms o_artefacts_execution_defects_template_forms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_template_forms
    ADD CONSTRAINT o_artefacts_execution_defects_template_forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects_template_forms o_artefacts_execution_defects_template_forms_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_template_forms
    ADD CONSTRAINT o_artefacts_execution_defects_template_forms_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_artefact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_artefact_id_fkey FOREIGN KEY (artefact_id) REFERENCES public.o_artefacts_execution_tasks(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_template_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_template_field_id_fkey FOREIGN KEY (template_field_id) REFERENCES public.o_artefacts_execution_tasks_template_form_fields(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks_template_form_fields o_artefacts_execution_tasks_template_fo_default_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_tasks_template_fo_default_visibility_fkey FOREIGN KEY (default_visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_execution_tasks_template_forms(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_tasks_template_form_fields o_artefacts_execution_tasks_template_form_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_tasks_template_form_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_execution_tasks_template_forms(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_tasks_template_forms o_artefacts_execution_tasks_template_forms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_template_forms
    ADD CONSTRAINT o_artefacts_execution_tasks_template_forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks_template_forms o_artefacts_execution_tasks_template_forms_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_template_forms
    ADD CONSTRAINT o_artefacts_execution_tasks_template_forms_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks_template_forms o_artefacts_execution_tasks_template_forms_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_template_forms
    ADD CONSTRAINT o_artefacts_execution_tasks_template_forms_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_test_cases o_artefacts_execution_test_cases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases
    ADD CONSTRAINT o_artefacts_execution_test_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_field_v_template_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_field_v_template_field_id_fkey FOREIGN KEY (template_field_id) REFERENCES public.o_artefacts_execution_test_cases_template_form_fields(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_field_val_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_field_val_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_field_values_artefact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_field_values_artefact_id_fkey FOREIGN KEY (artefact_id) REFERENCES public.o_artefacts_execution_test_cases(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_field_values_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_field_values_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_field_values_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_field_values_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_test_cases o_artefacts_execution_test_cases_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases
    ADD CONSTRAINT o_artefacts_execution_test_cases_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_test_cases o_artefacts_execution_test_cases_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases
    ADD CONSTRAINT o_artefacts_execution_test_cases_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_test_cases_template_form_fields o_artefacts_execution_test_cases_templa_default_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_test_cases_templa_default_visibility_fkey FOREIGN KEY (default_visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_test_cases_template_forms o_artefacts_execution_test_cases_template__subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_template_forms
    ADD CONSTRAINT o_artefacts_execution_test_cases_template__subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_test_cases o_artefacts_execution_test_cases_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases
    ADD CONSTRAINT o_artefacts_execution_test_cases_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_execution_test_cases_template_forms(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_test_cases_template_forms o_artefacts_execution_test_cases_template_forms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_template_forms
    ADD CONSTRAINT o_artefacts_execution_test_cases_template_forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_test_cases_template_forms o_artefacts_execution_test_cases_template_forms_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_template_forms
    ADD CONSTRAINT o_artefacts_execution_test_cases_template_forms_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_test_cases_template_form_fields o_artefacts_execution_test_cases_template_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_test_cases_template_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_execution_test_cases_template_forms(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_test_cases o_artefacts_execution_test_cases_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases
    ADD CONSTRAINT o_artefacts_execution_test_cases_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_test_cases o_artefacts_execution_test_cases_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases
    ADD CONSTRAINT o_artefacts_execution_test_cases_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_user_stories o_artefacts_execution_user_stories_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories
    ADD CONSTRAINT o_artefacts_execution_user_stories_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_user_stories_field_values o_artefacts_execution_user_stories_field_template_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_template_field_id_fkey FOREIGN KEY (template_field_id) REFERENCES public.o_artefacts_execution_user_stories_template_form_fields(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_user_stories_field_values o_artefacts_execution_user_stories_field_v_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_v_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_user_stories_field_values o_artefacts_execution_user_stories_field_value_artefact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_value_artefact_id_fkey FOREIGN KEY (artefact_id) REFERENCES public.o_artefacts_execution_user_stories(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_user_stories_field_values o_artefacts_execution_user_stories_field_values_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_values_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_user_stories_field_values o_artefacts_execution_user_stories_field_values_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_values_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_user_stories o_artefacts_execution_user_stories_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories
    ADD CONSTRAINT o_artefacts_execution_user_stories_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_user_stories o_artefacts_execution_user_stories_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories
    ADD CONSTRAINT o_artefacts_execution_user_stories_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_user_stories_template_form_fields o_artefacts_execution_user_stories_temp_default_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_user_stories_temp_default_visibility_fkey FOREIGN KEY (default_visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_user_stories_template_form_fields o_artefacts_execution_user_stories_templa_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_template_form_fields
    ADD CONSTRAINT o_artefacts_execution_user_stories_templa_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_execution_user_stories_template_forms(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_user_stories_template_forms o_artefacts_execution_user_stories_templat_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_template_forms
    ADD CONSTRAINT o_artefacts_execution_user_stories_templat_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_user_stories_template_forms o_artefacts_execution_user_stories_template_for_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_template_forms
    ADD CONSTRAINT o_artefacts_execution_user_stories_template_for_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_user_stories_template_forms o_artefacts_execution_user_stories_template_for_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories_template_forms
    ADD CONSTRAINT o_artefacts_execution_user_stories_template_for_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_user_stories o_artefacts_execution_user_stories_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories
    ADD CONSTRAINT o_artefacts_execution_user_stories_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_execution_user_stories_template_forms(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_user_stories o_artefacts_execution_user_stories_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories
    ADD CONSTRAINT o_artefacts_execution_user_stories_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_user_stories o_artefacts_execution_user_stories_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_user_stories
    ADD CONSTRAINT o_artefacts_execution_user_stories_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_strategic o_artefacts_strategic_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_artefact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_artefact_id_fkey FOREIGN KEY (artefact_id) REFERENCES public.o_artefacts_strategic(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_template_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_template_field_id_fkey FOREIGN KEY (template_field_id) REFERENCES public.o_artefacts_strategic_template_form_fields(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_strategic o_artefacts_strategic_hierarchy_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_hierarchy_parent_id_fkey FOREIGN KEY (hierarchy_parent_id) REFERENCES public.o_artefacts_strategic(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_strategic o_artefacts_strategic_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic o_artefacts_strategic_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic_template_form_fields o_artefacts_strategic_template_form_fie_default_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_template_form_fields
    ADD CONSTRAINT o_artefacts_strategic_template_form_fie_default_visibility_fkey FOREIGN KEY (default_visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_strategic_template_form_fields o_artefacts_strategic_template_form_field_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_template_form_fields
    ADD CONSTRAINT o_artefacts_strategic_template_form_field_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_strategic_template_forms(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_strategic o_artefacts_strategic_template_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_template_form_id_fkey FOREIGN KEY (template_form_id) REFERENCES public.o_artefacts_strategic_template_forms(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_strategic_template_forms o_artefacts_strategic_template_forms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_template_forms
    ADD CONSTRAINT o_artefacts_strategic_template_forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic_template_forms o_artefacts_strategic_template_forms_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_template_forms
    ADD CONSTRAINT o_artefacts_strategic_template_forms_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic_template_forms o_artefacts_strategic_template_forms_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_template_forms
    ADD CONSTRAINT o_artefacts_strategic_template_forms_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_strategic o_artefacts_strategic_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic o_artefacts_strategic_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic
    ADD CONSTRAINT o_artefacts_strategic_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_search_index_outbox o_search_index_outbox_artefact_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_search_index_outbox
    ADD CONSTRAINT o_search_index_outbox_artefact_type_fkey FOREIGN KEY (artefact_type) REFERENCES public.o_artefact_type_registry(scope_key) ON DELETE CASCADE;


--
-- Name: o_subscription_artefact_type_overrides o_subscription_artefact_type_overrides_scope_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_subscription_artefact_type_overrides
    ADD CONSTRAINT o_subscription_artefact_type_overrides_scope_key_fkey FOREIGN KEY (scope_key) REFERENCES public.o_artefact_type_registry(scope_key) ON DELETE CASCADE;


--
-- Name: o_subscription_artefact_type_overrides o_subscription_artefact_type_overrides_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_subscription_artefact_type_overrides
    ADD CONSTRAINT o_subscription_artefact_type_overrides_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: o_subscription_artefact_type_overrides o_subscription_artefact_type_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_subscription_artefact_type_overrides
    ADD CONSTRAINT o_subscription_artefact_type_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


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
-- Name: portfolio_item_types portfolio_item_types_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_item_types
    ADD CONSTRAINT portfolio_item_types_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: portfolio_items portfolio_items_flow_state_change_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_flow_state_change_owner_fkey FOREIGN KEY (flow_state_change_owner) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: portfolio_items portfolio_items_hierarchy_parent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_hierarchy_parent_fkey FOREIGN KEY (hierarchy_parent) REFERENCES public.portfolio_items(id) ON DELETE RESTRICT;


--
-- Name: portfolio_items portfolio_items_name_author_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_name_author_fkey FOREIGN KEY (name_author) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: portfolio_items portfolio_items_name_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_name_owner_fkey FOREIGN KEY (name_owner) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: portfolio_items portfolio_items_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: portfolio_items portfolio_items_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.portfolio_item_types(id) ON DELETE RESTRICT;


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
-- Name: user_stories user_stories_flow_state_change_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stories
    ADD CONSTRAINT user_stories_flow_state_change_owner_fkey FOREIGN KEY (flow_state_change_owner) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_stories user_stories_name_author_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stories
    ADD CONSTRAINT user_stories_name_author_fkey FOREIGN KEY (name_author) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: user_stories user_stories_name_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stories
    ADD CONSTRAINT user_stories_name_owner_fkey FOREIGN KEY (name_owner) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_stories user_stories_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stories
    ADD CONSTRAINT user_stories_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: user_stories user_stories_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stories
    ADD CONSTRAINT user_stories_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.execution_item_types(id) ON DELETE RESTRICT;


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

\unrestrict Ggs426PFfX4AzYfLB5c8ObMn1KqW8aPKfTqSyxb8rGTPVgP7WepDlVWEzkyed7M

