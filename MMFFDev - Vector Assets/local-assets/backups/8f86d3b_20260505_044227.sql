--
-- PostgreSQL database dump
--

\restrict YnSpaf76Z5uTnAlB39KLRbGqJHUCQdi6vCjEVNOJLvmCn5GG5B9hsnLcp2MENav

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
-- Name: notify_rank_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_rank_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    rec          record;
    resource_arg text;
    payload      jsonb;
    scope_label  text;
    scope_id     uuid;
BEGIN
    -- Resource type is passed as a trigger argument so one
    -- function serves every adopter table.
    resource_arg := TG_ARGV[0];

    IF (TG_OP = 'DELETE') THEN
        rec := OLD;
    ELSE
        rec := NEW;
    END IF;

    IF rec.sprint_id IS NULL THEN
        scope_label := 'backlog';
        scope_id    := NULL;
    ELSE
        scope_label := 'sprint';
        scope_id    := rec.sprint_id;
    END IF;

    payload := jsonb_build_object(
        'resource_type',   resource_arg,
        'subscription_id', rec.subscription_id,
        'scope',           scope_label,
        'scope_id',        scope_id,
        'row_id',          rec.id,
        'op',              TG_OP
    );

    -- pg_notify is async; channel name is fixed, payload <8000 bytes.
    PERFORM pg_notify('rank_changed', payload::text);

    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: page_addressables_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.page_addressables_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: page_help_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.page_help_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: provision_on_first_gadmin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.provision_on_first_gadmin() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_gadmin_role_id UUID := '00000000-0000-0000-0000-00000000ad30';
BEGIN
    IF NEW.role_id = v_gadmin_role_id AND NEW.is_active = TRUE THEN
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
-- Name: library_help_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_help_defaults (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name_pattern text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    body_html text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    video_embeds jsonb DEFAULT '[]'::jsonb NOT NULL,
    image_urls jsonb DEFAULT '[]'::jsonb NOT NULL
);


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
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    parent_id uuid,
    root_feature_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    priority text,
    severity text,
    sprint_id uuid,
    CONSTRAINT o_de_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_de_priority_valid CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text])))),
    CONSTRAINT o_de_severity_valid CHECK (((severity IS NULL) OR (severity = ANY (ARRAY['blocker'::text, 'major'::text, 'minor'::text, 'trivial'::text])))),
    CONSTRAINT o_de_status_valid CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text, 'wont_fix'::text]))),
    CONSTRAINT o_de_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_execution_defects_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_defects_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    field_name text NOT NULL,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    string_value text,
    number_value numeric(19,4),
    text_value text,
    date_value date,
    schema_field_id uuid,
    field_library_id uuid,
    template_id uuid,
    CONSTRAINT o_de_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
);


--
-- Name: o_artefacts_execution_epics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_epics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    title text NOT NULL,
    description text,
    content jsonb,
    content_plain_text text,
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    root_feature_id uuid,
    CONSTRAINT o_ep_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_ep_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_execution_epics_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_epics_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    field_name text NOT NULL,
    string_value text,
    number_value numeric(19,4),
    text_value text,
    date_value date,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    field_library_id uuid,
    template_id uuid,
    CONSTRAINT o_ep_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
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
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    parent_work_item_id uuid,
    parent_defect_id uuid,
    root_feature_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    priority text,
    estimated_hours numeric(6,1),
    sprint_id uuid,
    CONSTRAINT o_ta_estimated_hours_nonneg CHECK (((estimated_hours IS NULL) OR (estimated_hours >= (0)::numeric))),
    CONSTRAINT o_ta_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_ta_parent_xor CHECK ((NOT ((parent_work_item_id IS NOT NULL) AND (parent_defect_id IS NOT NULL)))),
    CONSTRAINT o_ta_priority_valid CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text])))),
    CONSTRAINT o_ta_status_valid CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'done'::text, 'blocked'::text]))),
    CONSTRAINT o_ta_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_execution_tasks_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_tasks_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    field_name text NOT NULL,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    string_value text,
    number_value numeric(19,4),
    text_value text,
    date_value date,
    schema_field_id uuid,
    field_library_id uuid,
    template_id uuid,
    CONSTRAINT o_ta_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
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
    field_name text NOT NULL,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    string_value text,
    number_value numeric(19,4),
    text_value text,
    date_value date,
    schema_field_id uuid,
    field_library_id uuid,
    template_id uuid,
    CONSTRAINT o_tc_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
);


--
-- Name: o_artefacts_execution_work_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_work_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    key_num bigint NOT NULL,
    title text NOT NULL,
    description text,
    content jsonb,
    content_plain_text text,
    owner_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    search_index tsvector,
    item_type text DEFAULT 'story'::text NOT NULL,
    parent_id uuid,
    root_feature_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    priority text,
    story_points integer,
    sprint_id uuid,
    backlog_position integer,
    sprint_position integer,
    CONSTRAINT o_wi_item_type_valid CHECK ((item_type = ANY (ARRAY['epic'::text, 'story'::text, 'task'::text, 'defect'::text]))),
    CONSTRAINT o_wi_key_num_positive CHECK ((key_num > 0)),
    CONSTRAINT o_wi_position_scope CHECK ((((sprint_id IS NULL) AND (sprint_position IS NULL)) OR ((sprint_id IS NOT NULL) AND (backlog_position IS NULL)))),
    CONSTRAINT o_wi_priority_valid CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text])))),
    CONSTRAINT o_wi_status_valid CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text]))),
    CONSTRAINT o_wi_story_points_nonneg CHECK (((story_points IS NULL) OR (story_points >= 0))),
    CONSTRAINT o_wi_title_nonempty CHECK ((length(btrim(title)) > 0))
);


--
-- Name: o_artefacts_execution_work_items_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_artefacts_execution_work_items_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    artefact_id uuid NOT NULL,
    field_name text NOT NULL,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    string_value text,
    number_value numeric(19,4),
    text_value text,
    date_value date,
    field_library_id uuid,
    template_id uuid,
    CONSTRAINT o_wi_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
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
    field_name text NOT NULL,
    visibility smallint DEFAULT 0 NOT NULL,
    visibility_scope_id uuid,
    source_artefact_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    string_value text,
    number_value numeric(19,4),
    text_value text,
    date_value date,
    schema_field_id uuid,
    field_library_id uuid,
    template_id uuid,
    CONSTRAINT o_pi_fv_field_name_nonempty CHECK ((length(btrim(field_name)) > 0))
);


--
-- Name: o_execution_custom_field_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_execution_custom_field_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    field_name text NOT NULL,
    label text NOT NULL,
    type text NOT NULL,
    options_json jsonb,
    config_json jsonb,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT o_cfl_field_name_nonempty CHECK ((length(btrim(field_name)) > 0)),
    CONSTRAINT o_cfl_label_nonempty CHECK ((length(btrim(label)) > 0)),
    CONSTRAINT o_cfl_type_valid CHECK ((type = ANY (ARRAY['textbox'::text, 'richtext'::text, 'integer'::text, 'decimal'::text, 'date'::text, 'boolean'::text, 'select'::text, 'multiselect'::text, 'radio'::text, 'user'::text, 'url'::text])))
);


--
-- Name: o_execution_work_item_template_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_execution_work_item_template_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    field_library_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    required boolean DEFAULT false NOT NULL,
    default_value text,
    CONSTRAINT o_witf_position_nonneg CHECK (("position" >= 0))
);


--
-- Name: o_execution_work_item_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.o_execution_work_item_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    item_type text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT o_wit_item_type_valid CHECK (((item_type IS NULL) OR (item_type = ANY (ARRAY['epic'::text, 'story'::text, 'defect'::text, 'task'::text, 'test_case'::text, 'strategic'::text])))),
    CONSTRAINT o_wit_name_nonempty CHECK ((length(btrim(name)) > 0))
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
-- Name: org_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_levels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    depth integer NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_levels_depth_check CHECK ((depth >= 0)),
    CONSTRAINT org_levels_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: TABLE org_levels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.org_levels IS 'Topology hierarchy levels (PLA-0006 / 00313). One row per (subscription, depth). Sole writer: backend/internal/orgdesign. Depth invariant against org_nodes.level_id is enforced at the service layer.';


--
-- Name: org_node_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_node_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    node_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    can_redelegate boolean DEFAULT false NOT NULL,
    granted_by uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_node_roles_revoked_pair CHECK ((((revoked_at IS NULL) AND (revoked_by IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL)))),
    CONSTRAINT org_node_roles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])))
);


--
-- Name: TABLE org_node_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.org_node_roles IS 'Node-scoped role grants for Topology (PLA-0006). Overlays the subscription role on a per-node basis. revoked_at IS NULL = active. MVP single-admin constraint enforced via partial unique index org_node_roles_single_admin_mvp — drop to enable multi-admin in Phase X. can_redelegate ships from day one but MVP UI does not expose it.';


--
-- Name: org_node_view_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_node_view_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    node_id uuid NOT NULL,
    user_id uuid NOT NULL,
    collapsed boolean DEFAULT true NOT NULL,
    last_viewed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE org_node_view_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.org_node_view_state IS 'Per-user collapse/expand state for /topology canvas (PLA-0006). ON DELETE CASCADE on both FKs because the row has no value once either parent is gone. Not audited — last_viewed_at is a UI hint.';


--
-- Name: org_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    label_override text,
    icon text,
    colour text,
    avatar_url text,
    layout_mode text DEFAULT 'auto-horizontal'::text NOT NULL,
    manual_x integer,
    manual_y integer,
    collapsed_default boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    level_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    CONSTRAINT org_nodes_colour_check CHECK (((colour IS NULL) OR (colour ~ '^#[0-9a-fA-F]{6}$'::text))),
    CONSTRAINT org_nodes_layout_mode_check CHECK ((layout_mode = ANY (ARRAY['auto-horizontal'::text, 'auto-vertical'::text, 'auto-radial'::text, 'manual'::text]))),
    CONSTRAINT org_nodes_manual_xy_pair CHECK ((((layout_mode = 'manual'::text) AND (manual_x IS NOT NULL) AND (manual_y IS NOT NULL)) OR ((layout_mode <> 'manual'::text) AND (manual_x IS NULL) AND (manual_y IS NULL)))),
    CONSTRAINT org_nodes_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: TABLE org_nodes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.org_nodes IS 'Topology tree (PLA-0006). Self-referential per subscription. parent_id NULL = root. label_override NULL falls back to default noun "Office". Sole writer: backend/internal/orgdesign. archived_at = limbo (greyed on canvas, kept reachable, kept revertable). Cascade-on-archive deferred to Phase X.';


--
-- Name: COLUMN org_nodes.level_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.org_nodes.level_id IS 'FK to org_levels (PLA-0006 / 00313). Depth invariant — level.depth = tree-depth(node) — is enforced by backend/internal/orgdesign/service.go, not by a DB trigger. Sole writer: orgdesign.Service.';


--
-- Name: COLUMN org_nodes.workspace_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.org_nodes.workspace_id IS 'FK to workspaces (PLA-0006 / 00374). Every org_nodes row belongs to exactly one workspace; archive of the workspace places the entire subtree in limbo. Sole writer for the column itself: backend/internal/orgdesign/service.go (cross-workspace moves go through orgdesign + workspaces.Service together).';


--
-- Name: page_addressables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_addressables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    kind text NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    page_route text NOT NULL,
    source text NOT NULL,
    custom_app_id uuid,
    soft_archived boolean DEFAULT false NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    helpable boolean DEFAULT true NOT NULL,
    CONSTRAINT page_addressables_source_check CHECK ((source = ANY (ARRAY['build'::text, 'runtime'::text, 'custom_app'::text])))
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
-- Name: page_help; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_help (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    addressable_id uuid NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    body_html text DEFAULT ''::text NOT NULL,
    seeded_from text,
    library_ref uuid,
    soft_archived boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    video_embeds jsonb DEFAULT '[]'::jsonb NOT NULL,
    image_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT page_help_seeded_from_check CHECK ((seeded_from = ANY (ARRAY['library'::text, 'manual'::text, 'sdk_manifest'::text])))
);


--
-- Name: page_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_roles (
    page_id uuid NOT NULL,
    role_id uuid NOT NULL
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
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


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
    org_node_id uuid NOT NULL,
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
-- Name: COLUMN portfolio_items.org_node_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.portfolio_items.org_node_id IS 'PLA-0006: org node this item is scoped to. Backfilled to subscription root in migration 085, then NOT NULL. Read by clamp predicate middleware on every list endpoint.';


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
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid,
    code text NOT NULL,
    label text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    rank integer NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    is_external boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT roles_rank_positive CHECK ((rank > 0)),
    CONSTRAINT roles_system_no_tenant CHECK ((((is_system = true) AND (subscription_id IS NULL)) OR (is_system = false))),
    CONSTRAINT roles_tenant_rank_band CHECK (((subscription_id IS NULL) OR (rank <> ALL (ARRAY[5, 10, 20, 25, 30]))))
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
-- Name: sprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sprints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    goal text,
    start_date date,
    end_date date,
    status text DEFAULT 'planned'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT sp_dates_valid CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT sp_name_nonempty CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT sp_status_valid CHECK ((status = ANY (ARRAY['planned'::text, 'active'::text, 'completed'::text])))
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
-- Name: subscription_item_type_icons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_item_type_icons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    item_type text NOT NULL,
    icon_id uuid NOT NULL,
    set_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT siti_item_type_valid CHECK ((item_type = ANY (ARRAY['epic'::text, 'story'::text, 'task'::text, 'defect'::text])))
);


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
    topology_committed_at timestamp with time zone,
    topology_committed_by uuid,
    CONSTRAINT subscriptions_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])))
);


--
-- Name: COLUMN subscriptions.tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriptions.tier IS 'Entitlement tier for mmff_library access. Values: free, pro, enterprise. Default pro for backfilled rows; billing service will set this going forward.';


--
-- Name: COLUMN subscriptions.topology_committed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriptions.topology_committed_at IS 'Last gadmin commit of the Topology working model (PLA-0006 / 00322). NULL = never committed. Compare against MAX(org_nodes.updated_at) to detect "dirty since commit".';


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
    org_node_id uuid NOT NULL,
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
-- Name: COLUMN user_stories.org_node_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stories.org_node_id IS 'PLA-0006: org node this story is scoped to. Backfilled to subscription root in migration 085, then NOT NULL. Read by clamp predicate middleware on every list endpoint.';


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
    first_name text,
    last_name text,
    department text,
    role_id uuid NOT NULL,
    CONSTRAINT users_auth_method_check CHECK ((auth_method = ANY (ARRAY['local'::text, 'ldap'::text])))
);


--
-- Name: vector_icons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vector_icons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pack text NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    default_for text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vi_default_for_valid CHECK (((default_for IS NULL) OR (default_for = ANY (ARRAY['epic'::text, 'story'::text, 'task'::text, 'defect'::text])))),
    CONSTRAINT vi_label_nonempty CHECK ((length(btrim(label)) > 0)),
    CONSTRAINT vi_name_nonempty CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT vi_pack_valid CHECK ((pack = ANY (ARRAY['fa6'::text, 'md'::text, 'bs'::text, 'tb'::text, 'ri'::text])))
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
-- Name: workspace_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    can_redelegate boolean DEFAULT false NOT NULL,
    granted_by uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_roles_revoked_pair CHECK ((((revoked_at IS NULL) AND (revoked_by IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL)))),
    CONSTRAINT workspace_roles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])))
);


--
-- Name: TABLE workspace_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workspace_roles IS 'Workspace-scoped role grants (PLA-0006). Mirrors org_node_roles at the workspace tier. revoked_at IS NULL = active. MVP single-admin constraint enforced via partial unique index workspace_roles_single_admin — drop to enable multi-admin in Phase X. can_redelegate ships from day one but MVP UI does not expose it.';


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    CONSTRAINT workspaces_archived_pair CHECK ((((archived_at IS NULL) AND (archived_by IS NULL)) OR ((archived_at IS NOT NULL) AND (archived_by IS NOT NULL)))),
    CONSTRAINT workspaces_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT workspaces_slug_check CHECK (((length(TRIM(BOTH FROM slug)) > 0) AND (slug ~ '^[a-z0-9][a-z0-9-]*$'::text)))
);


--
-- Name: TABLE workspaces; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workspaces IS 'Workspace tier above org_nodes (PLA-0006). A subscription holds 1..N workspaces; each workspace owns its own org_nodes tree. Sole writer: backend/internal/workspaces. archived_at = limbo; slug is unique only among live rows.';


--
-- Name: o_search_index_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_search_index_outbox ALTER COLUMN id SET DEFAULT nextval('public.o_search_index_outbox_id_seq'::regclass);


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_log (id, user_id, subscription_id, action, resource, resource_id, metadata, ip_address, created_at) FROM stdin;
\.


--
-- Data for Name: canonical_states; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.canonical_states (code, label, clock_role, sort_order, created_at) FROM stdin;
defined	Defined	none	10	2026-05-05 01:04:04.632512+00
ready	Ready	lead_start	20	2026-05-05 01:04:04.632512+00
in_progress	In Progress	cycle_active	30	2026-05-05 01:04:04.632512+00
completed	Completed	cycle_stop	40	2026-05-05 01:04:04.632512+00
accepted	Accepted	lead_stop	50	2026-05-05 01:04:04.632512+00
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
-- Data for Name: library_help_defaults; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_help_defaults (id, kind, name_pattern, locale, body_html, created_at, updated_at, title, video_embeds, image_urls) FROM stdin;
a214ae03-944f-4a2e-8f96-427ad74d645a	panel	*	en	<p>This panel groups related controls and information for the surrounding section. Hover any element to see its address; click the help hexagon to open this popover.</p>	2026-05-05 01:04:11.913858+00	2026-05-05 01:04:11.913858+00	\N	[]	[]
6e1bae22-7c6a-4807-ba17-540c377e54ff	table	*	en	<p>This table lists records you can sort, filter, and act on. Column headers sort; row actions appear in the rightmost column or via right-click.</p>	2026-05-05 01:04:11.913858+00	2026-05-05 01:04:11.913858+00	\N	[]	[]
c72dd337-d3db-45e6-a6f7-a74b7ad320f7	navigation	*	en	<p>This navigation block lets you move between sections. Pinned items render above custom navigation; drag to reorder in your preferences.</p>	2026-05-05 01:04:11.913858+00	2026-05-05 01:04:11.913858+00	\N	[]	[]
d0375cdd-2ece-4f54-8639-4fd17187c0a5	panel	page_summary	en	<p>This strip summarises the page below at a glance. Each cell shows a labelled count or value drawn from the data on the page.</p><p><strong>Warning-tone cells</strong> (e.g. <em>Defects</em>, <em>Blocked</em>) paint amber only when their value is greater than zero; resting state stays neutral so the strip does not shout when there is nothing to act on.</p><p>If a search box is shown on the right, it filters the rows below by title or key. Cells update to reflect the filtered subset.</p>	2026-05-05 01:04:14.569021+00	2026-05-05 01:04:14.569021+00	Page summary	[]	[]
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
execution_defects	o_artefacts_execution_defects	DE	Defect	Defects	A reported bug, regression, or quality issue. Tracks the problem, steps to reproduce, and resolution.	PH-0005	t	2026-05-05 01:04:10.090806+00
execution_tasks	o_artefacts_execution_tasks	TA	Task	Tasks	A discrete unit of technical or non-technical work. Typically owned by one person with a clear done state.	PH-0005	t	2026-05-05 01:04:10.090806+00
execution_test_cases	o_artefacts_execution_test_cases	TC	Test Case	Test Cases	A documented test scenario with steps and expected outcomes. Linked to user stories or defects.	PH-0005	t	2026-05-05 01:04:10.090806+00
strategic	o_artefacts_strategic	PI	Portfolio Item	Portfolio Items	A strategic planning artefact. Template forms express sub-types (Feature, Epic, Initiative, Theme).	PH-0005	t	2026-05-05 01:04:10.090806+00
execution_work_items	o_artefacts_execution_work_items	US	Work Item	Work Items	An execution-layer work item: a user story or epic. Stories describe work from a user perspective; epics group related stories too large to fit a single iteration.	PH-0005	t	2026-05-05 01:04:10.090806+00
execution_epics	o_artefacts_execution_epics	EP	Epic	Epics	An execution-layer container for related user stories. Sits between a Feature and its child stories. Created directly or promoted from a story split.	PH-0005	t	2026-05-05 01:04:10.613357+00
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

COPY public.o_artefacts_execution_defects (id, subscription_id, key_num, title, description, content, content_plain_text, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index, parent_id, root_feature_id, status, priority, severity, sprint_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_defects_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_defects_field_values (id, subscription_id, artefact_id, field_name, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at, string_value, number_value, text_value, date_value, schema_field_id, field_library_id, template_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_epics; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_epics (id, subscription_id, key_num, title, description, content, content_plain_text, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index, root_feature_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_epics_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_epics_field_values (id, subscription_id, artefact_id, field_name, string_value, number_value, text_value, date_value, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at, field_library_id, template_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_tasks (id, subscription_id, key_num, title, description, content, content_plain_text, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index, parent_work_item_id, parent_defect_id, root_feature_id, status, priority, estimated_hours, sprint_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_tasks_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_tasks_field_values (id, subscription_id, artefact_id, field_name, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at, string_value, number_value, text_value, date_value, schema_field_id, field_library_id, template_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_test_cases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_test_cases (id, subscription_id, key_num, title, description, content, content_plain_text, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_test_cases_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_test_cases_field_values (id, subscription_id, artefact_id, field_name, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at, string_value, number_value, text_value, date_value, schema_field_id, field_library_id, template_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_work_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_work_items (id, subscription_id, key_num, title, description, content, content_plain_text, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index, item_type, parent_id, root_feature_id, status, priority, story_points, sprint_id, backlog_position, sprint_position) FROM stdin;
\.


--
-- Data for Name: o_artefacts_execution_work_items_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_execution_work_items_field_values (id, subscription_id, artefact_id, field_name, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at, string_value, number_value, text_value, date_value, field_library_id, template_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_strategic; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_strategic (id, subscription_id, key_num, title, description, content, content_plain_text, owner_id, created_by, updated_by, created_at, updated_at, archived_at, visibility, visibility_scope_id, search_index, hierarchy_parent_id) FROM stdin;
\.


--
-- Data for Name: o_artefacts_strategic_field_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_artefacts_strategic_field_values (id, subscription_id, artefact_id, field_name, visibility, visibility_scope_id, source_artefact_id, created_by, created_at, updated_at, string_value, number_value, text_value, date_value, schema_field_id, field_library_id, template_id) FROM stdin;
\.


--
-- Data for Name: o_execution_custom_field_library; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_execution_custom_field_library (id, subscription_id, field_name, label, type, options_json, config_json, created_by, created_at, updated_at, archived_at) FROM stdin;
\.


--
-- Data for Name: o_execution_work_item_template_fields; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_execution_work_item_template_fields (id, template_id, field_library_id, "position", required, default_value) FROM stdin;
\.


--
-- Data for Name: o_execution_work_item_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.o_execution_work_item_templates (id, subscription_id, name, description, item_type, created_by, created_at, updated_at, archived_at) FROM stdin;
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
-- Data for Name: org_levels; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.org_levels (id, subscription_id, depth, name, "position", archived_at, created_at, updated_at) FROM stdin;
37318b6d-0bfc-4775-9ee9-7a0028c54b92	00000000-0000-0000-0000-000000000001	0	Organisation	0	\N	2026-05-05 01:04:13.38159+00	2026-05-05 01:04:13.38159+00
f3d96b47-1e2d-4a57-a341-1971aa3ada18	00000000-0000-0000-0000-000000000001	1	Department	1	\N	2026-05-05 01:04:13.38159+00	2026-05-05 01:04:13.38159+00
866bb0c7-ae21-4c67-a896-ae679d890c61	00000000-0000-0000-0000-000000000001	2	Division	2	\N	2026-05-05 01:04:13.38159+00	2026-05-05 01:04:13.38159+00
\.


--
-- Data for Name: org_node_roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.org_node_roles (id, subscription_id, node_id, user_id, role, can_redelegate, granted_by, granted_at, revoked_at, revoked_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: org_node_view_state; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.org_node_view_state (id, subscription_id, node_id, user_id, collapsed, last_viewed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: org_nodes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.org_nodes (id, subscription_id, parent_id, name, description, label_override, icon, colour, avatar_url, layout_mode, manual_x, manual_y, collapsed_default, "position", archived_at, created_at, updated_at, level_id, workspace_id) FROM stdin;
6e6b1b5d-4989-4c2f-950c-af9d31a16d01	00000000-0000-0000-0000-000000000001	\N	MMFFDev		Office	\N	\N	\N	auto-horizontal	\N	\N	t	0	\N	2026-05-05 01:04:12.833707+00	2026-05-05 01:04:14.277684+00	37318b6d-0bfc-4775-9ee9-7a0028c54b92	34d75204-4ff8-4fa5-be61-35610928ed14
\.


--
-- Data for Name: page_addressables; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_addressables (id, parent_id, kind, name, address, page_route, source, custom_app_id, soft_archived, last_seen_at, created_at, updated_at, helpable) FROM stdin;
93b68811-8b31-4755-9ab2-68d346940ef0	\N	panel	nav_prefs_available	samantha._viewport.app._panel.nav_prefs_available	/preferences/navigation	build	\N	f	\N	2026-05-05 01:04:12.017994+00	2026-05-05 01:04:12.017994+00	t
5024aade-29af-4a33-8623-1753751a085b	\N	panel	nav_prefs_custom_nav	samantha._viewport.app._panel.nav_prefs_custom_nav	/preferences/navigation	build	\N	f	\N	2026-05-05 01:04:12.017994+00	2026-05-05 01:04:12.017994+00	t
e8b18709-4531-4519-a9e2-e1668c43af4a	\N	panel	nav_prefs_pinned	samantha._viewport.app._panel.nav_prefs_pinned	/preferences/navigation	build	\N	f	\N	2026-05-05 01:04:12.017994+00	2026-05-05 01:04:12.017994+00	t
266aeeec-8b86-4cd6-87fa-6d20853e0885	\N	panel	nav_prefs_new_page	samantha._viewport.app._panel.nav_prefs_new_page	/preferences/navigation	build	\N	f	\N	2026-05-05 01:04:12.017994+00	2026-05-05 01:04:12.017994+00	t
dc6120a3-a8ac-4830-a338-50988fb47725	\N	panel	nav_prefs_new_group	samantha._viewport.app._panel.nav_prefs_new_group	/preferences/navigation	build	\N	f	\N	2026-05-05 01:04:12.017994+00	2026-05-05 01:04:12.017994+00	t
cc758ed7-e320-49bc-9121-ec2ec8388049	\N	panel	dev_health	samantha._viewport.app._panel.dev_health	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
2fee4adf-1d1c-4c65-8d3b-6710d4ae0210	\N	panel	dev_debug	samantha._viewport.app._panel.dev_debug	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
c853c8a6-0809-4fd5-a78d-58b3fdd39f24	\N	panel	dev_portfolio_adoption	samantha._viewport.app._panel.dev_portfolio_adoption	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
e49a107c-458b-44cb-9dad-137e82a695fc	\N	panel	dev_ssh_tunnel	samantha._viewport.app._panel.dev_ssh_tunnel	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
117df333-447c-4d1a-8a44-6ca5194f4673	\N	panel	dev_ssh_what	samantha._viewport.app._panel.dev_ssh_what	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
4d166d6d-e080-4e2e-bbd4-10daa83f5f2a	\N	panel	dev_ssh_reqs	samantha._viewport.app._panel.dev_ssh_reqs	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
c68cf0a2-a6ac-482d-93bc-e57c64805109	\N	panel	dev_plans	samantha._viewport.app._panel.dev_plans	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
ca397ea9-6686-4b55-82b6-96dc47adbe28	\N	panel	dev_reports	samantha._viewport.app._panel.dev_reports	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
87661612-39c8-4203-89eb-1e750f994e9c	\N	panel	dev_research	samantha._viewport.app._panel.dev_research	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
a160999f-2e9d-4944-8e77-0d645b5c78ac	\N	panel	dev_page_help	samantha._viewport.app._panel.dev_page_help	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
207fbb1a-721a-483e-bfb6-308093a81c81	\N	panel	dev_shortcuts	samantha._viewport.app._panel.dev_shortcuts	/dev	build	\N	f	\N	2026-05-05 01:04:12.119876+00	2026-05-05 01:04:12.119876+00	t
a478c45f-b78e-4a59-93ee-7bddb5afbd49	\N	panel	portfolio_settings_identity	samantha._viewport.app._panel.portfolio_settings_identity	/portfolio-settings	build	\N	f	\N	2026-05-05 01:04:12.22356+00	2026-05-05 01:04:12.22356+00	t
523f62a8-224f-4f15-bb63-fd3dfa6849ef	\N	panel	portfolio_settings_stakeholders	samantha._viewport.app._panel.portfolio_settings_stakeholders	/portfolio-settings	build	\N	f	\N	2026-05-05 01:04:12.22356+00	2026-05-05 01:04:12.22356+00	t
6053a7cb-9ee0-429e-a550-eb5b0b395c4d	\N	panel	portfolio_settings_danger_zone	samantha._viewport.app._panel.portfolio_settings_danger_zone	/portfolio-settings	build	\N	f	\N	2026-05-05 01:04:12.22356+00	2026-05-05 01:04:12.22356+00	t
eda92ed4-a086-4432-9698-f8bb437558eb	\N	panel	portfolio_model_hierarchy	samantha._viewport.app._panel.portfolio_model_hierarchy	/portfolio-model	build	\N	f	\N	2026-05-05 01:04:12.22356+00	2026-05-05 01:04:12.22356+00	t
2d458197-0ab2-4c5d-ba6d-2d7c5752af03	\N	panel	portfolio_model_artifacts	samantha._viewport.app._panel.portfolio_model_artifacts	/portfolio-model	build	\N	f	\N	2026-05-05 01:04:12.22356+00	2026-05-05 01:04:12.22356+00	t
a7fb05a0-63b3-41e4-a5f2-feb95792ddb7	\N	panel	portfolio_model_terminology	samantha._viewport.app._panel.portfolio_model_terminology	/portfolio-model	build	\N	f	\N	2026-05-05 01:04:12.22356+00	2026-05-05 01:04:12.22356+00	t
349f20a8-929f-4fc5-918a-e87cae9faae9	\N	panel	work_items_filters	samantha._viewport.app._panel.work_items_filters	/work-items	build	\N	f	\N	2026-05-05 01:04:12.315438+00	2026-05-05 01:04:12.315438+00	t
d6197a1b-eefd-4ecd-a937-9a9c8cd57ede	\N	panel	work_items_tree	samantha._viewport.app._panel.work_items_tree	/work-items	build	\N	f	\N	2026-05-05 01:04:12.315438+00	2026-05-05 01:04:12.315438+00	t
64151cb4-b306-4a36-9e91-0edfb9291794	\N	panel	backlog_filters	samantha._viewport.app._panel.backlog_filters	/backlog	build	\N	f	\N	2026-05-05 01:04:12.315438+00	2026-05-05 01:04:12.315438+00	t
07db3fc7-fc5c-4507-970e-4873448d80d3	\N	panel	backlog_list	samantha._viewport.app._panel.backlog_list	/backlog	build	\N	f	\N	2026-05-05 01:04:12.315438+00	2026-05-05 01:04:12.315438+00	t
36deb424-4943-416b-b858-e09a165569a9	\N	panel	work_items_settings_fields	samantha._viewport.app._panel.work_items_settings_fields	/work-items/settings	build	\N	f	\N	2026-05-05 01:04:12.315438+00	2026-05-05 01:04:12.315438+00	t
67b6d606-ac88-4047-9794-4ca5d96bfae7	\N	panel	work_items_settings_templates	samantha._viewport.app._panel.work_items_settings_templates	/work-items/settings	build	\N	f	\N	2026-05-05 01:04:12.315438+00	2026-05-05 01:04:12.315438+00	t
bdc56736-635f-43e7-82eb-c9d01adda270	\N	panel	library_releases_outstanding	samantha._viewport.app._panel.library_releases_outstanding	/library-releases	build	\N	f	\N	2026-05-05 01:04:12.400073+00	2026-05-05 01:04:12.400073+00	t
\.


--
-- Data for Name: page_entity_refs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_entity_refs (page_id, entity_kind, entity_id) FROM stdin;
\.


--
-- Data for Name: page_help; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_help (id, addressable_id, locale, body_html, seeded_from, library_ref, soft_archived, updated_at, updated_by_user_id, created_at, title, video_embeds, image_urls) FROM stdin;
e1a66c81-5a28-459e-bd8b-49ee78d1eb39	93b68811-8b31-4755-9ab2-68d346940ef0	en	<p>Drag a pane from this list onto Custom Navigation or Pinned to make it appear in your sidebar. Panes already in use show a faded state but stay draggable so you can put them in a second slot.</p>	manual	\N	f	2026-05-05 01:04:11.521661+00	\N	2026-05-05 01:04:12.017994+00	\N	[]	[]
bae3db5d-a09c-41e0-8a71-125786058ddc	5024aade-29af-4a33-8623-1753751a085b	en	<p>Your personal sidebar layout. Drag rows to reorder, drop a pane from Available Panes to add it, drop on a header row to start a new group.</p>	manual	\N	f	2026-05-05 01:04:11.521661+00	\N	2026-05-05 01:04:12.017994+00	\N	[]	[]
bb5272c1-ae44-4b9c-accc-52cbdf8d08f3	e8b18709-4531-4519-a9e2-e1668c43af4a	en	<p>Panes pinned here render above Custom Navigation in the sidebar so they are always one click away. Drag to reorder; drop back into Available Panes to unpin.</p>	manual	\N	f	2026-05-05 01:04:11.521661+00	\N	2026-05-05 01:04:12.017994+00	\N	[]	[]
05a3a9c2-ede3-4a1c-b2a1-e4ac1a2d0f2d	266aeeec-8b86-4cd6-87fa-6d20853e0885	en	<p>Create a blank page (URL <code>/p/&lt;uuid&gt;</code>) that you can later fill with apps and charts. The page becomes available as a draggable pane in Available Panes immediately.</p>	manual	\N	f	2026-05-05 01:04:11.521661+00	\N	2026-05-05 01:04:12.017994+00	\N	[]	[]
36adfcae-7c58-4a05-81e8-f1f31a872b6d	dc6120a3-a8ac-4830-a338-50988fb47725	en	<p>Create a header row for grouping panes inside Custom Navigation. Groups are collapsible, draggable, and render as a section heading in the sidebar.</p>	manual	\N	f	2026-05-05 01:04:11.521661+00	\N	2026-05-05 01:04:12.017994+00	\N	[]	[]
\.


--
-- Data for Name: page_roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_roles (page_id, role_id) FROM stdin;
ea18b4b3-2af5-4545-8bc5-1ef87b8d1013	00000000-0000-0000-0000-00000000ad30
c20a213e-df9a-46f5-91f8-0c3a30f22a20	00000000-0000-0000-0000-00000000ad30
3590dc96-aafb-4c14-ba07-390059dfc1c5	00000000-0000-0000-0000-00000000ad30
8215c1da-6c31-4752-bec6-03588d9d1fe0	00000000-0000-0000-0000-00000000ad30
06a1ae8f-3b96-4fd1-9561-afe4956ffe91	00000000-0000-0000-0000-00000000ad30
5f553816-0a69-4ba3-bd23-19de90fbc144	00000000-0000-0000-0000-00000000ad30
d1c1d94b-96c0-4e34-ac9a-9f7874bef311	00000000-0000-0000-0000-00000000ad30
8d8bc553-d1a2-476b-b847-b8a8c20f1bcb	00000000-0000-0000-0000-00000000ad30
06c13907-9132-421b-a765-a9adf09a8c0c	00000000-0000-0000-0000-00000000ad30
be81b2fa-9695-4fbf-8371-c67ab3ed52fa	00000000-0000-0000-0000-00000000ad30
6e887d90-7c31-4e85-b789-867c41f1656a	00000000-0000-0000-0000-00000000ad30
c4478c21-f090-40e0-8101-b1f49e0cd802	00000000-0000-0000-0000-00000000ad30
29f16879-27c5-488d-8494-dbe929eaffb4	00000000-0000-0000-0000-00000000ad30
077854b4-30ef-4e18-8d79-83517096c95b	00000000-0000-0000-0000-00000000ad30
ac90b7b5-1be9-4bc0-8987-4f6930def2d9	00000000-0000-0000-0000-00000000ad30
114fc92f-688a-416e-b844-78872f8af280	00000000-0000-0000-0000-00000000ad30
ea18b4b3-2af5-4545-8bc5-1ef87b8d1013	00000000-0000-0000-0000-00000000ad25
c20a213e-df9a-46f5-91f8-0c3a30f22a20	00000000-0000-0000-0000-00000000ad25
3590dc96-aafb-4c14-ba07-390059dfc1c5	00000000-0000-0000-0000-00000000ad25
8215c1da-6c31-4752-bec6-03588d9d1fe0	00000000-0000-0000-0000-00000000ad25
06a1ae8f-3b96-4fd1-9561-afe4956ffe91	00000000-0000-0000-0000-00000000ad25
5f553816-0a69-4ba3-bd23-19de90fbc144	00000000-0000-0000-0000-00000000ad25
d1c1d94b-96c0-4e34-ac9a-9f7874bef311	00000000-0000-0000-0000-00000000ad25
8d8bc553-d1a2-476b-b847-b8a8c20f1bcb	00000000-0000-0000-0000-00000000ad25
06c13907-9132-421b-a765-a9adf09a8c0c	00000000-0000-0000-0000-00000000ad25
be81b2fa-9695-4fbf-8371-c67ab3ed52fa	00000000-0000-0000-0000-00000000ad25
c4478c21-f090-40e0-8101-b1f49e0cd802	00000000-0000-0000-0000-00000000ad25
b9209034-0701-4d56-8bbd-44d55d2aac87	00000000-0000-0000-0000-00000000ad25
077854b4-30ef-4e18-8d79-83517096c95b	00000000-0000-0000-0000-00000000ad25
ac90b7b5-1be9-4bc0-8987-4f6930def2d9	00000000-0000-0000-0000-00000000ad25
114fc92f-688a-416e-b844-78872f8af280	00000000-0000-0000-0000-00000000ad25
8e531814-48a4-4ba2-9769-2779983fe8d0	00000000-0000-0000-0000-00000000ad25
8ce4531f-09e0-4d09-b6e3-798809ffe86b	00000000-0000-0000-0000-00000000ad25
ea18b4b3-2af5-4545-8bc5-1ef87b8d1013	00000000-0000-0000-0000-00000000ad10
c20a213e-df9a-46f5-91f8-0c3a30f22a20	00000000-0000-0000-0000-00000000ad10
3590dc96-aafb-4c14-ba07-390059dfc1c5	00000000-0000-0000-0000-00000000ad10
8215c1da-6c31-4752-bec6-03588d9d1fe0	00000000-0000-0000-0000-00000000ad10
06a1ae8f-3b96-4fd1-9561-afe4956ffe91	00000000-0000-0000-0000-00000000ad10
5f553816-0a69-4ba3-bd23-19de90fbc144	00000000-0000-0000-0000-00000000ad10
d1c1d94b-96c0-4e34-ac9a-9f7874bef311	00000000-0000-0000-0000-00000000ad10
8d8bc553-d1a2-476b-b847-b8a8c20f1bcb	00000000-0000-0000-0000-00000000ad10
06c13907-9132-421b-a765-a9adf09a8c0c	00000000-0000-0000-0000-00000000ad10
c4478c21-f090-40e0-8101-b1f49e0cd802	00000000-0000-0000-0000-00000000ad10
077854b4-30ef-4e18-8d79-83517096c95b	00000000-0000-0000-0000-00000000ad10
ac90b7b5-1be9-4bc0-8987-4f6930def2d9	00000000-0000-0000-0000-00000000ad10
114fc92f-688a-416e-b844-78872f8af280	00000000-0000-0000-0000-00000000ad10
8e531814-48a4-4ba2-9769-2779983fe8d0	00000000-0000-0000-0000-00000000ad10
8ce4531f-09e0-4d09-b6e3-798809ffe86b	00000000-0000-0000-0000-00000000ad10
6aca2fa0-b59e-47e1-936d-8fbdf5cdb065	00000000-0000-0000-0000-00000000ad30
\.


--
-- Data for Name: page_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_tags (tag_enum, display_name, default_order, is_admin_menu, created_at) FROM stdin;
personal_settings	Personal Settings	5	t	2026-05-05 01:04:04.931361+00
bookmarks	Bookmarks	0	f	2026-05-05 01:04:05.047706+00
personal	Personal	0	f	2026-05-05 01:04:04.931361+00
admin_settings	Admin Settings	1	f	2026-05-05 01:04:04.931361+00
planning	Planning	2	f	2026-05-05 01:04:04.931361+00
strategic	Strategic	3	f	2026-05-05 01:04:04.931361+00
\.


--
-- Data for Name: pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pages (id, key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id, created_at, updated_at) FROM stdin;
ea18b4b3-2af5-4545-8bc5-1ef87b8d1013	dashboard	Dashboard	/dashboard	home	personal	static	t	t	0	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:04.931361+00
c20a213e-df9a-46f5-91f8-0c3a30f22a20	my-vista	My Vista	/my-vista	eye	personal	static	t	t	1	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:04.931361+00
5f553816-0a69-4ba3-bd23-19de90fbc144	favourites	Favourites	/favourites	star	personal	static	t	t	2	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:04.931361+00
d1c1d94b-96c0-4e34-ac9a-9f7874bef311	risk	Risk	/risk	warning	strategic	static	t	t	0	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:04.931361+00
6e887d90-7c31-4e85-b789-867c41f1656a	workspace-settings	Workspace Settings	/workspace-settings	cog	admin_settings	static	t	t	0	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:04.931361+00
be81b2fa-9695-4fbf-8371-c67ab3ed52fa	portfolio-settings	Portfolio Settings	/portfolio-settings	briefcase	admin_settings	static	t	t	1	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:04.931361+00
06c13907-9132-421b-a765-a9adf09a8c0c	dev	Dev Setup	/dev	wrench	personal	static	f	f	99	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:04.931361+00
b9209034-0701-4d56-8bbd-44d55d2aac87	portfolio-model	Portfolio Model	/portfolio-model	package	admin_settings	static	t	t	2	\N	\N	2026-05-05 01:04:05.960943+00	2026-05-05 01:04:05.960943+00
29f16879-27c5-488d-8494-dbe929eaffb4	library-releases	Library Releases	/library-releases	bell	admin_settings	static	t	t	3	\N	\N	2026-05-05 01:04:06.139604+00	2026-05-05 01:04:06.139604+00
8d8bc553-d1a2-476b-b847-b8a8c20f1bcb	account-settings	Account Settings	/account-settings	user	personal_settings	static	f	f	0	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:06.402783+00
077854b4-30ef-4e18-8d79-83517096c95b	dev-library	Library	/dev/library	book-open	personal	static	f	f	101	\N	\N	2026-05-05 01:04:07.091574+00	2026-05-05 01:04:07.091574+00
c4478c21-f090-40e0-8101-b1f49e0cd802	theme	Theme	/theme	theme	personal	static	t	f	99	\N	\N	2026-05-05 01:04:05.401394+00	2026-05-05 01:04:08.096816+00
06a1ae8f-3b96-4fd1-9561-afe4956ffe91	portfolio	Portfolio	/portfolio	briefcase	planning	static	t	t	0	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:11.725531+00
8e531814-48a4-4ba2-9769-2779983fe8d0	portfolio-items	Portfolio Items	/portfolio-items	briefcase	planning	static	t	t	1	\N	\N	2026-05-05 01:04:11.621826+00	2026-05-05 01:04:11.725531+00
ac90b7b5-1be9-4bc0-8987-4f6930def2d9	work-items	Work Items	/work-items	layers	planning	static	t	t	2	\N	\N	2026-05-05 01:04:10.51464+00	2026-05-05 01:04:11.725531+00
8215c1da-6c31-4752-bec6-03588d9d1fe0	planning	Planning	/planning	list	planning	static	t	t	3	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:11.725531+00
3590dc96-aafb-4c14-ba07-390059dfc1c5	backlog	Backlog	/backlog	clipboard	planning	static	t	t	4	\N	\N	2026-05-05 01:04:04.931361+00	2026-05-05 01:04:11.725531+00
114fc92f-688a-416e-b844-78872f8af280	scope	Scope	/scope	folder	planning	static	t	t	5	\N	\N	2026-05-05 01:04:11.438634+00	2026-05-05 01:04:11.725531+00
8ce4531f-09e0-4d09-b6e3-798809ffe86b	topology	Topology	/topology	sitemap	planning	static	t	t	6	\N	\N	2026-05-05 01:04:13.009403+00	2026-05-05 01:04:13.009403+00
6aca2fa0-b59e-47e1-936d-8fbdf5cdb065	admin-roles	Roles	/admin/roles	users	admin_settings	static	t	t	5	\N	\N	2026-05-05 01:04:13.622448+00	2026-05-05 01:04:13.622448+00
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
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.permissions (id, code, label, category, description, created_at) FROM stdin;
6bc41620-9065-4643-becc-4ed36556cb2b	menu.admin.view	View admin menu	menu	Render the admin menu group in the navigation.	2026-05-05 01:04:13.093015+00
e479fce1-ce42-4abf-8f26-4da5e8db075a	menu.dev.view	View dev menu	menu	Render the developer menu (Dev Setup) — gadmin only by default.	2026-05-05 01:04:13.093015+00
6f181d8a-4be0-4827-87c4-55a06729c46e	users.list	List users	users	Read-only list of users in the actor's tenant.	2026-05-05 01:04:13.093015+00
1165d1f0-51a7-4f0c-9253-5f402426fb90	users.read	Read user detail	users	Read individual user records.	2026-05-05 01:04:13.093015+00
a3e9c41b-1922-4b7b-b950-e90f0822fe91	users.archive	Archive (soft-delete) user	users	Soft-archive a user.	2026-05-05 01:04:13.093015+00
6d034b1b-56c0-48ab-aaf5-899eaa96914d	users.update_profile	Update user profile	users	Edit profile fields (name, department).	2026-05-05 01:04:13.093015+00
be8aca1a-586f-49e2-89d8-f35b5a0db325	users.update_active	Activate / deactivate user	users	Toggle is_active on a user.	2026-05-05 01:04:13.093015+00
9a0bc4b8-a2b1-48c3-8717-d8da98cb3c37	users.issue_reset	Issue password reset link	users	Generate a password-reset link for a user.	2026-05-05 01:04:13.093015+00
29b4a528-edf3-459d-8bd2-f7f03dc639f7	users.create.gadmin	Create gadmin users	users	Create users with the gadmin system role.	2026-05-05 01:04:13.093015+00
e6a8b0be-4047-4e69-b846-aa7bc8d96067	users.create.padmin	Create padmin users	users	Create users with the padmin system role.	2026-05-05 01:04:13.093015+00
5daf810d-4b74-4db8-9d1e-cc2211331c26	users.create.team_lead	Create team_lead users	users	Create users with the team_lead system role.	2026-05-05 01:04:13.093015+00
0fb86bbb-0db4-445d-bb0c-c3a792569961	users.create.user	Create standard users	users	Create users with the user system role.	2026-05-05 01:04:13.093015+00
9098b4f3-a951-488b-8fd8-bc083c3c2914	users.create.external	Create external users	users	Create users under any is_external role within tenant scope.	2026-05-05 01:04:13.093015+00
410d4b50-98be-4fc1-8c47-b99a5d3e4b39	roles.list	List roles	roles	Read tenant + system roles.	2026-05-05 01:04:13.093015+00
4e603b69-3ab9-4ad1-acad-03f48dd432e0	roles.read	Read role detail	roles	Read role permission grid + audit.	2026-05-05 01:04:13.093015+00
3f632111-ccbd-44f3-ac85-cdc33e579120	roles.create	Create custom role	roles	Create tenant-custom roles.	2026-05-05 01:04:13.093015+00
5f3c2c09-fc3f-4f72-a99c-63f2ccc66802	roles.update	Update role	roles	Edit tenant-custom roles (and label/description on system roles).	2026-05-05 01:04:13.093015+00
d796eaf2-dbae-4ad9-8eee-66dca45d5f86	roles.archive	Archive role	roles	Soft-archive a tenant-custom role.	2026-05-05 01:04:13.093015+00
f74beac7-b241-4980-9f5d-d67cc052389b	roles.assign_permissions	Grant permissions	roles	Grant permissions to a role.	2026-05-05 01:04:13.093015+00
33012c31-1c52-48f2-b8d7-304f7994cf70	roles.revoke_permissions	Revoke permissions	roles	Revoke permissions from a role.	2026-05-05 01:04:13.093015+00
c48dc1c7-633d-4460-8735-87eaf37efe1b	portfolio.list	List portfolios	portfolio	Read portfolios visible to the actor.	2026-05-05 01:04:13.093015+00
5ea22285-fb7f-403e-9a1d-4ed89e2e05d7	workspace.create	Create workspace	workspace	Create new workspaces in this tenant.	2026-05-05 01:04:14.359847+00
ced0fd7e-b1e2-4b12-a529-0019265fa1cb	workspace.rename	Rename workspace	workspace	Rename a workspace.	2026-05-05 01:04:14.359847+00
95389519-8a65-4634-9265-884ee7d659ff	workspace.archive	Archive workspace	workspace	Archive a workspace (soft-delete); preserves grants and tree for restore.	2026-05-05 01:04:14.359847+00
3b450de8-66ff-4af1-a8d3-a7a7a9a882db	workspace.restore	Restore workspace	workspace	Restore an archived workspace.	2026-05-05 01:04:14.359847+00
0c045e06-dc1b-43ae-b3de-420fc483c5ae	workspace.view_archived	View archived workspaces	workspace	View the archived workspaces section in the workspace switcher / manage UI.	2026-05-05 01:04:14.359847+00
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
\.


--
-- Data for Name: portfolio_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_items (id, subscription_id, key_num, type_id, hierarchy_parent, name, description, acceptance_criteria, notes, name_author, name_owner, flow_state, flow_state_change_update_date, flow_state_change_owner, blocked, blocked_reason, date_work_planned_start, date_work_planned_finish, date_work_started, date_work_accepted, estimate_initial, estimate_updated, risk_impact, risk_probability, risk_score, strategic_investment_group, strategic_investment_weight, strategic_item_type, value_stream_identifier, lidentifier_colour, lidentifier_labels, lidentifier_tags, count_child_defects, count_child_user_stories, count_dependants, count_rollup_defect, count_rollup_defects, count_rollup_estimation, count_rollup_risks, done_by_story_count, archived_at, created_at, updated_at, org_node_id) FROM stdin;
\.


--
-- Data for Name: product; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.product (id, subscription_id, workspace_id, parent_portfolio_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.role_permissions (role_id, permission_id, granted_by, granted_at) FROM stdin;
00000000-0000-0000-0000-00000000ad30	6bc41620-9065-4643-becc-4ed36556cb2b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	e479fce1-ce42-4abf-8f26-4da5e8db075a	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	6f181d8a-4be0-4827-87c4-55a06729c46e	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	1165d1f0-51a7-4f0c-9253-5f402426fb90	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	a3e9c41b-1922-4b7b-b950-e90f0822fe91	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	6d034b1b-56c0-48ab-aaf5-899eaa96914d	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	be8aca1a-586f-49e2-89d8-f35b5a0db325	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	9a0bc4b8-a2b1-48c3-8717-d8da98cb3c37	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	29b4a528-edf3-459d-8bd2-f7f03dc639f7	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	e6a8b0be-4047-4e69-b846-aa7bc8d96067	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	5daf810d-4b74-4db8-9d1e-cc2211331c26	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	0fb86bbb-0db4-445d-bb0c-c3a792569961	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	9098b4f3-a951-488b-8fd8-bc083c3c2914	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	410d4b50-98be-4fc1-8c47-b99a5d3e4b39	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	4e603b69-3ab9-4ad1-acad-03f48dd432e0	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	3f632111-ccbd-44f3-ac85-cdc33e579120	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	5f3c2c09-fc3f-4f72-a99c-63f2ccc66802	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	d796eaf2-dbae-4ad9-8eee-66dca45d5f86	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	f74beac7-b241-4980-9f5d-d67cc052389b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	33012c31-1c52-48f2-b8d7-304f7994cf70	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	c48dc1c7-633d-4460-8735-87eaf37efe1b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	6bc41620-9065-4643-becc-4ed36556cb2b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	6f181d8a-4be0-4827-87c4-55a06729c46e	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	1165d1f0-51a7-4f0c-9253-5f402426fb90	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	a3e9c41b-1922-4b7b-b950-e90f0822fe91	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	6d034b1b-56c0-48ab-aaf5-899eaa96914d	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	be8aca1a-586f-49e2-89d8-f35b5a0db325	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	9a0bc4b8-a2b1-48c3-8717-d8da98cb3c37	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	5daf810d-4b74-4db8-9d1e-cc2211331c26	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	0fb86bbb-0db4-445d-bb0c-c3a792569961	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	9098b4f3-a951-488b-8fd8-bc083c3c2914	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	410d4b50-98be-4fc1-8c47-b99a5d3e4b39	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	4e603b69-3ab9-4ad1-acad-03f48dd432e0	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad25	c48dc1c7-633d-4460-8735-87eaf37efe1b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	6bc41620-9065-4643-becc-4ed36556cb2b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	6f181d8a-4be0-4827-87c4-55a06729c46e	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	1165d1f0-51a7-4f0c-9253-5f402426fb90	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	a3e9c41b-1922-4b7b-b950-e90f0822fe91	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	6d034b1b-56c0-48ab-aaf5-899eaa96914d	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	be8aca1a-586f-49e2-89d8-f35b5a0db325	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	9a0bc4b8-a2b1-48c3-8717-d8da98cb3c37	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	5daf810d-4b74-4db8-9d1e-cc2211331c26	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	0fb86bbb-0db4-445d-bb0c-c3a792569961	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	9098b4f3-a951-488b-8fd8-bc083c3c2914	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	410d4b50-98be-4fc1-8c47-b99a5d3e4b39	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	4e603b69-3ab9-4ad1-acad-03f48dd432e0	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad20	c48dc1c7-633d-4460-8735-87eaf37efe1b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad10	c48dc1c7-633d-4460-8735-87eaf37efe1b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad05	c48dc1c7-633d-4460-8735-87eaf37efe1b	\N	2026-05-05 01:04:13.093015+00
00000000-0000-0000-0000-00000000ad30	5ea22285-fb7f-403e-9a1d-4ed89e2e05d7	\N	2026-05-05 01:04:14.359847+00
00000000-0000-0000-0000-00000000ad30	ced0fd7e-b1e2-4b12-a529-0019265fa1cb	\N	2026-05-05 01:04:14.359847+00
00000000-0000-0000-0000-00000000ad30	95389519-8a65-4634-9265-884ee7d659ff	\N	2026-05-05 01:04:14.359847+00
00000000-0000-0000-0000-00000000ad30	3b450de8-66ff-4af1-a8d3-a7a7a9a882db	\N	2026-05-05 01:04:14.359847+00
00000000-0000-0000-0000-00000000ad30	0c045e06-dc1b-43ae-b3de-420fc483c5ae	\N	2026-05-05 01:04:14.359847+00
00000000-0000-0000-0000-00000000ad25	5ea22285-fb7f-403e-9a1d-4ed89e2e05d7	\N	2026-05-05 01:04:14.359847+00
00000000-0000-0000-0000-00000000ad25	ced0fd7e-b1e2-4b12-a529-0019265fa1cb	\N	2026-05-05 01:04:14.359847+00
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.roles (id, subscription_id, code, label, description, rank, is_system, is_external, archived_at, created_at, updated_at, created_by) FROM stdin;
00000000-0000-0000-0000-00000000ad30	\N	gadmin	Global Admin	Full administrative authority within a tenant; can manage roles and users at every level.	30	t	f	\N	2026-05-05 01:04:13.093015+00	2026-05-05 01:04:13.093015+00	\N
00000000-0000-0000-0000-00000000ad25	\N	padmin	Portfolio Admin	Portfolio-level admin; can create Team Leads and Users and manage portfolio-scoped settings.	25	t	f	\N	2026-05-05 01:04:13.093015+00	2026-05-05 01:04:13.093015+00	\N
00000000-0000-0000-0000-00000000ad20	\N	team_lead	Team Lead	Mid-tier role with the same operational rights as Portfolio Admin in v0; ranks differ so role-ceiling is preserved.	20	t	f	\N	2026-05-05 01:04:13.093015+00	2026-05-05 01:04:13.093015+00	\N
00000000-0000-0000-0000-00000000ad10	\N	user	User	Standard end-user. No account-creation rights.	10	t	f	\N	2026-05-05 01:04:13.093015+00	2026-05-05 01:04:13.093015+00	\N
00000000-0000-0000-0000-00000000ad05	\N	external	External (archetype)	Bespoke external account archetype. Tenants clone-and-edit to define auditor / contractor / agent roles.	5	t	t	\N	2026-05-05 01:04:13.093015+00	2026-05-05 01:04:13.093015+00	\N
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (filename, applied_at) FROM stdin;
001_init.sql	2026-05-05 01:04:04.149115+00
002_auth_permissions.sql	2026-05-05 01:04:04.257489+00
003_mfa_scaffold.sql	2026-05-05 01:04:04.338048+00
004_portfolio_stack.sql	2026-05-05 01:04:04.477927+00
005_item_types.sql	2026-05-05 01:04:04.569578+00
006_states.sql	2026-05-05 01:04:04.703064+00
007_rename_permissions.sql	2026-05-05 01:04:04.797081+00
008_user_nav_prefs.sql	2026-05-05 01:04:04.881304+00
009_page_registry.sql	2026-05-05 01:04:04.974485+00
010_nav_entity_bookmarks.sql	2026-05-05 01:04:05.07934+00
011_nav_subpages_custom_groups.sql	2026-05-05 01:04:05.17397+00
012_pages_partial_unique.sql	2026-05-05 01:04:05.258591+00
013_polymorphic_dispatch_triggers.sql	2026-05-05 01:04:05.351865+00
014_page_theme.sql	2026-05-05 01:04:05.428829+00
015_user_nav_icon_override.sql	2026-05-05 01:04:05.513657+00
016_user_custom_pages.sql	2026-05-05 01:04:05.619629+00
017_subscriptions_rename.sql	2026-05-05 01:04:05.719532+00
018_subscription_tier.sql	2026-05-05 01:04:05.81322+00
019_pending_library_cleanup_jobs.sql	2026-05-05 01:04:05.892561+00
020_portfolio_model_page.sql	2026-05-05 01:04:05.990303+00
021_library_acknowledgements.sql	2026-05-05 01:04:06.089031+00
022_library_releases_page.sql	2026-05-05 01:04:06.16886+00
023_backfill_library_releases_pin.sql	2026-05-05 01:04:06.263809+00
024_backfill_portfolio_model_pin.sql	2026-05-05 01:04:06.34905+00
025_nav_group_reorder.sql	2026-05-05 01:04:06.438644+00
026_subscription_portfolio_model_state.sql	2026-05-05 01:04:06.538333+00
028_error_events.sql	2026-05-05 01:04:06.674553+00
029_adoption_mirror_tables.sql	2026-05-05 01:04:06.879616+00
030_unpin_gadmin_portfolio_model.sql	2026-05-05 01:04:07.013484+00
031_nav_dev_library.sql	2026-05-05 01:04:07.207441+00
032_drop_pre_adoption_item_types.sql	2026-05-05 01:04:07.318007+00
033_theme_unpinnable_product_strategic.sql	2026-05-05 01:04:07.400877+00
034_user_nav_profiles.sql	2026-05-05 01:04:07.550311+00
035_user_nav_profiles_links.sql	2026-05-05 01:04:07.63248+00
036_backfill_default_profiles.sql	2026-05-05 01:04:07.729047+00
037_user_nav_prefs_position_per_parent.sql	2026-05-05 01:04:07.811988+00
038_pin_product_entity_bookmark.sql	2026-05-05 01:04:07.923085+00
039_user_theme_pack.sql	2026-05-05 01:04:08.04068+00
040_theme_page_library.sql	2026-05-05 01:04:08.127111+00
041_fix_subscription_layer_sort_order.sql	2026-05-05 01:04:08.216116+00
042_theme_pack_drop_check.sql	2026-05-05 01:04:08.300009+00
043_user_stories.sql	2026-05-05 01:04:08.392624+00
044_defects.sql	2026-05-05 01:04:08.486697+00
045_item_labels_tags.sql	2026-05-05 01:04:08.590256+00
046_portfolio_items.sql	2026-05-05 01:04:08.702868+00
047_custom_fields.sql	2026-05-05 01:04:08.808102+00
048_item_field_options.sql	2026-05-05 01:04:08.892137+00
049_artefact_type_registry.sql	2026-05-05 01:04:08.999788+00
050_artefact_visibility.sql	2026-05-05 01:04:09.089497+00
051_artefacts_execution_user_stories.sql	2026-05-05 01:04:09.228724+00
052_artefacts_execution_defects.sql	2026-05-05 01:04:09.381232+00
053_artefacts_execution_tasks.sql	2026-05-05 01:04:09.514656+00
054_artefacts_execution_test_cases.sql	2026-05-05 01:04:09.647652+00
055_artefacts_strategic.sql	2026-05-05 01:04:09.784025+00
056_artefact_notes.sql	2026-05-05 01:04:09.871957+00
057_artefact_versions.sql	2026-05-05 01:04:09.954794+00
058_search_index_outbox.sql	2026-05-05 01:04:10.039156+00
059_artefact_type_registry_seed.sql	2026-05-05 01:04:10.12938+00
060_artefact_schema_tables.sql	2026-05-05 01:04:10.367732+00
061_artefact_field_values_reshape.sql	2026-05-05 01:04:10.466635+00
062_work_items_page.sql	2026-05-05 01:04:10.551048+00
063_work_items_rename_and_epics.sql	2026-05-05 01:04:10.717827+00
064_custom_field_library.sql	2026-05-05 01:04:10.942108+00
065_execution_core_columns.sql	2026-05-05 01:04:11.065454+00
066_work_items_expand_types.sql	2026-05-05 01:04:11.151866+00
067_icon_catalogue.sql	2026-05-05 01:04:11.236579+00
068_ranking_position_columns.sql	2026-05-05 01:04:11.307978+00
069_ranking_notify_trigger.sql	2026-05-05 01:04:11.384509+00
070_page_scope.sql	2026-05-05 01:04:11.472596+00
071_pane_help.sql	2026-05-05 01:04:11.556703+00
072_portfolio_items_page.sql	2026-05-05 01:04:11.659435+00
073_planning_canonical_order.sql	2026-05-05 01:04:11.769853+00
074_page_addressables.sql	2026-05-05 01:04:11.864983+00
075_page_help.sql	2026-05-05 01:04:11.967731+00
076_drop_pane_help.sql	2026-05-05 01:04:12.057775+00
077_seed_dev_addressables.sql	2026-05-05 01:04:12.150649+00
078_seed_portfolio_addressables.sql	2026-05-05 01:04:12.254962+00
079_seed_work_items_addressables.sql	2026-05-05 01:04:12.344567+00
080_seed_library_releases_addressables.sql	2026-05-05 01:04:12.43126+00
081_addressables_helpable.sql	2026-05-05 01:04:12.511504+00
082_org_nodes.sql	2026-05-05 01:04:12.595403+00
083_org_node_roles.sql	2026-05-05 01:04:12.683006+00
084_org_node_view_state.sql	2026-05-05 01:04:12.766912+00
085_org_node_id_fk.sql	2026-05-05 01:04:12.875169+00
086_users_profile_fields.sql	2026-05-05 01:04:12.962748+00
087_topology_page.sql	2026-05-05 01:04:13.041473+00
088_roles_permissions.sql	2026-05-05 01:04:13.144592+00
089_users_page_roles_role_id.sql	2026-05-05 01:04:13.237434+00
090_org_levels.sql	2026-05-05 01:04:13.329802+00
091_org_nodes_level_id.sql	2026-05-05 01:04:13.41585+00
092_subscriptions_topology_committed.sql	2026-05-05 01:04:13.50901+00
093_org_nodes_description_not_null.sql	2026-05-05 01:04:13.571782+00
094_admin_roles_page.sql	2026-05-05 01:04:13.666746+00
095_seed_team_lead_account.sql	2026-05-05 01:04:13.985027+00
096_org_nodes_drop_name_unique.sql	2026-05-05 01:04:14.053346+00
097_page_help_rich_content.sql	2026-05-05 01:04:14.137468+00
098_workspaces.sql	2026-05-05 01:04:14.22812+00
099_org_nodes_workspace_id.sql	2026-05-05 01:04:14.308828+00
100_workspace_permissions_seed.sql	2026-05-05 01:04:14.391183+00
101_workspace_roles_backfill.sql	2026-05-05 01:04:14.493214+00
102_seed_page_summary_help.sql	2026-05-05 01:04:14.597486+00
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (id, user_id, token_hash, created_at, expires_at, last_used_at, ip_address, user_agent, revoked) FROM stdin;
\.


--
-- Data for Name: sprints; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sprints (id, subscription_id, name, goal, start_date, end_date, status, created_by, created_at, updated_at, archived_at) FROM stdin;
\.


--
-- Data for Name: subscription_artifacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_artifacts (id, subscription_id, source_library_id, source_library_version, artifact_key, enabled, config, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_item_type_icons; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_item_type_icons (id, subscription_id, item_type, icon_id, set_by, created_at, updated_at) FROM stdin;
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

COPY public.subscriptions (id, name, slug, is_active, created_at, updated_at, tier, topology_committed_at, topology_committed_by) FROM stdin;
00000000-0000-0000-0000-000000000001	MMFFDev	mmffdev	t	2026-05-05 01:04:04.082109+00	2026-05-05 01:04:04.082109+00	pro	\N	\N
\.


--
-- Data for Name: user_custom_page_views; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_custom_page_views (id, page_id, label, kind, "position", config, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_custom_pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_custom_pages (id, user_id, subscription_id, label, icon, created_at, updated_at) FROM stdin;
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
5f6ba980-e292-45b8-8eaa-f254316d7992	381f3c45-ea28-4e2a-8391-421eeb1a7923	00000000-0000-0000-0000-000000000001	6f8ff22a-4975-41a0-8a21-07ba73fe6253	library-releases	0	f	2026-05-05 01:04:06.234782+00	2026-05-05 01:04:07.684699+00	\N	\N	\N
588d9ef7-7ea1-4e9d-82cf-9252e16e6d46	b26f9009-e9a6-4b84-8445-8773bb5b0c55	00000000-0000-0000-0000-000000000001	1f80ce30-d9df-48f3-9dc1-5b4b33d69f22	portfolio-model	0	f	2026-05-05 01:04:06.315544+00	2026-05-05 01:04:07.684699+00	\N	\N	\N
6c23464f-2652-4361-ae26-680c5f0be6fe	b26f9009-e9a6-4b84-8445-8773bb5b0c55	00000000-0000-0000-0000-000000000001	1f80ce30-d9df-48f3-9dc1-5b4b33d69f22	portfolio-items	1	f	2026-05-05 01:04:11.621826+00	2026-05-05 01:04:11.621826+00	\N	\N	\N
5b5142b7-d2cd-469b-8dd6-202c26b63a84	b26f9009-e9a6-4b84-8445-8773bb5b0c55	00000000-0000-0000-0000-000000000001	1f80ce30-d9df-48f3-9dc1-5b4b33d69f22	topology	2	f	2026-05-05 01:04:13.009403+00	2026-05-05 01:04:13.009403+00	\N	\N	\N
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
6f8ff22a-4975-41a0-8a21-07ba73fe6253	381f3c45-ea28-4e2a-8391-421eeb1a7923	00000000-0000-0000-0000-000000000001	Default	0	t	\N	2026-05-05 01:04:07.684699+00	2026-05-05 01:04:07.684699+00
1f80ce30-d9df-48f3-9dc1-5b4b33d69f22	b26f9009-e9a6-4b84-8445-8773bb5b0c55	00000000-0000-0000-0000-000000000001	Default	0	t	\N	2026-05-05 01:04:07.684699+00	2026-05-05 01:04:07.684699+00
\.


--
-- Data for Name: user_stories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_stories (id, subscription_id, key_num, type_id, hierarchy_parent, name, description, acceptance_criteria, notes, name_author, name_owner, schedule_state, flow_state, flow_state_change_update_date, flow_state_change_owner, date_work_accepted, blocked, blocked_reason, ready, expedite, affects_doc, sprint, release, estimate_points, estimate_hours, estimate_remaining, rank, risk_score, risk_impact, risk_probability, lidentifier_colour, lidentifier_type, count_child_tasks, count_child_defects, count_child_test_cases, test_case_status, defect_status, created_at, updated_at, archived_at, org_node_id) FROM stdin;
\.


--
-- Data for Name: user_workspace_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_workspace_permissions (id, user_id, workspace_id, can_view, can_edit, can_admin, granted_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, subscription_id, email, password_hash, role, is_active, last_login, created_at, updated_at, auth_method, ldap_dn, force_password_change, password_changed_at, failed_login_count, locked_until, mfa_enrolled, mfa_secret, mfa_enrolled_at, mfa_recovery_codes, active_nav_profile_id, theme_pack, first_name, last_name, department, role_id) FROM stdin;
381f3c45-ea28-4e2a-8391-421eeb1a7923	00000000-0000-0000-0000-000000000001	gadmin@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	gadmin	t	\N	2026-05-05 01:04:04.082109+00	2026-05-05 01:04:13.203515+00	local	\N	t	\N	0	\N	f	\N	\N	\N	6f8ff22a-4975-41a0-8a21-07ba73fe6253	default	\N	\N	\N	00000000-0000-0000-0000-00000000ad30
b26f9009-e9a6-4b84-8445-8773bb5b0c55	00000000-0000-0000-0000-000000000001	padmin@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	padmin	t	\N	2026-05-05 01:04:04.082109+00	2026-05-05 01:04:13.203515+00	local	\N	f	\N	0	\N	f	\N	\N	\N	1f80ce30-d9df-48f3-9dc1-5b4b33d69f22	default	\N	\N	\N	00000000-0000-0000-0000-00000000ad25
8f1dd2f8-93f5-4edf-8296-ee380e7366a3	00000000-0000-0000-0000-000000000001	user@mmffdev.com	$2a$12$l2ob1iI5uyFTCImkyQIeyO3/YJifBmmyOJxOQRt3t5cxtw6Z5/4pi	user	t	\N	2026-05-05 01:04:04.082109+00	2026-05-05 01:04:13.203515+00	local	\N	f	\N	0	\N	f	\N	\N	\N	\N	default	\N	\N	\N	00000000-0000-0000-0000-00000000ad10
d491e6fc-e621-449e-944b-d095a9e85ac8	00000000-0000-0000-0000-000000000001	team_lead@mmffdev.com	$2a$12$Te3JM3/nMBuMRfawx.kBKumpuztXVTxBI.Dg6SoEzXT9q6e4BmtJy	user	t	\N	2026-05-05 01:04:13.717073+00	2026-05-05 01:04:13.717073+00	local	\N	f	\N	0	\N	f	\N	\N	\N	\N	default	\N	\N	\N	00000000-0000-0000-0000-00000000ad20
\.


--
-- Data for Name: vector_icons; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vector_icons (id, pack, name, label, is_default, default_for, created_at) FROM stdin;
f5ab712a-04d3-4e46-ab7b-ea7a1dd38da1	md	MdOutlineCreateNewFolder	Epic	t	epic	2026-05-05 01:04:11.199307+00
bc294803-d74f-4125-b9f2-2c7b78a19ddf	md	MdOutlineFolder	Story	t	story	2026-05-05 01:04:11.199307+00
97a3f4df-c72f-4120-a050-9c71aaa2bdf1	md	MdChecklist	Task	t	task	2026-05-05 01:04:11.199307+00
5aaa5c3f-b683-477f-9c78-dd4fd1e1462a	md	MdOutlineBugReport	Defect	t	defect	2026-05-05 01:04:11.199307+00
\.


--
-- Data for Name: workspace; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workspace (id, subscription_id, company_roadmap_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: workspace_roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workspace_roles (id, subscription_id, workspace_id, user_id, role, can_redelegate, granted_by, granted_at, revoked_at, revoked_by, created_at, updated_at) FROM stdin;
d8229d1f-e982-4968-99d2-ccec90c1b415	00000000-0000-0000-0000-000000000001	34d75204-4ff8-4fa5-be61-35610928ed14	381f3c45-ea28-4e2a-8391-421eeb1a7923	admin	f	381f3c45-ea28-4e2a-8391-421eeb1a7923	2026-05-05 01:04:14.445662+00	\N	\N	2026-05-05 01:04:14.445662+00	2026-05-05 01:04:14.445662+00
\.


--
-- Data for Name: workspaces; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workspaces (id, subscription_id, name, slug, description, created_by, created_at, updated_at, archived_at, archived_by) FROM stdin;
34d75204-4ff8-4fa5-be61-35610928ed14	00000000-0000-0000-0000-000000000001	Default	default	Default workspace seeded by migration 099 for backfill of org_nodes.workspace_id.	381f3c45-ea28-4e2a-8391-421eeb1a7923	2026-05-05 01:04:14.277684+00	2026-05-05 01:04:14.277684+00	\N	\N
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
-- Name: library_help_defaults library_help_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_help_defaults
    ADD CONSTRAINT library_help_defaults_pkey PRIMARY KEY (id);


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
-- Name: o_artefacts_execution_epics_field_values o_artefacts_execution_epics_field_va_artefact_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics_field_values
    ADD CONSTRAINT o_artefacts_execution_epics_field_va_artefact_id_field_name_key UNIQUE (artefact_id, field_name);


--
-- Name: o_artefacts_execution_epics_field_values o_artefacts_execution_epics_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics_field_values
    ADD CONSTRAINT o_artefacts_execution_epics_field_values_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_epics o_artefacts_execution_epics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics
    ADD CONSTRAINT o_artefacts_execution_epics_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_epics o_artefacts_execution_epics_subscription_id_key_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics
    ADD CONSTRAINT o_artefacts_execution_epics_subscription_id_key_num_key UNIQUE (subscription_id, key_num);


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
-- Name: o_artefacts_execution_work_items_field_values o_artefacts_execution_user_stories_f_artefact_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_f_artefact_id_field_name_key UNIQUE (artefact_id, field_name);


--
-- Name: o_artefacts_execution_work_items_field_values o_artefacts_execution_user_stories_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_values_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_work_items o_artefacts_execution_user_stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_user_stories_pkey PRIMARY KEY (id);


--
-- Name: o_artefacts_execution_work_items o_artefacts_execution_user_stories_subscription_id_key_num_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_user_stories_subscription_id_key_num_key UNIQUE (subscription_id, key_num);


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
-- Name: o_execution_custom_field_library o_execution_custom_field_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_custom_field_library
    ADD CONSTRAINT o_execution_custom_field_library_pkey PRIMARY KEY (id);


--
-- Name: o_execution_custom_field_library o_execution_custom_field_library_subscription_id_field_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_custom_field_library
    ADD CONSTRAINT o_execution_custom_field_library_subscription_id_field_name_key UNIQUE (subscription_id, field_name);


--
-- Name: o_execution_work_item_template_fields o_execution_work_item_template_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_work_item_template_fields
    ADD CONSTRAINT o_execution_work_item_template_fields_pkey PRIMARY KEY (id);


--
-- Name: o_execution_work_item_template_fields o_execution_work_item_template_template_id_field_library_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_work_item_template_fields
    ADD CONSTRAINT o_execution_work_item_template_template_id_field_library_id_key UNIQUE (template_id, field_library_id);


--
-- Name: o_execution_work_item_templates o_execution_work_item_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_work_item_templates
    ADD CONSTRAINT o_execution_work_item_templates_pkey PRIMARY KEY (id);


--
-- Name: o_execution_work_item_templates o_execution_work_item_templates_subscription_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_work_item_templates
    ADD CONSTRAINT o_execution_work_item_templates_subscription_id_name_key UNIQUE (subscription_id, name);


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
-- Name: org_levels org_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_levels
    ADD CONSTRAINT org_levels_pkey PRIMARY KEY (id);


--
-- Name: org_node_roles org_node_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_roles
    ADD CONSTRAINT org_node_roles_pkey PRIMARY KEY (id);


--
-- Name: org_node_view_state org_node_view_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_view_state
    ADD CONSTRAINT org_node_view_state_pkey PRIMARY KEY (id);


--
-- Name: org_node_view_state org_node_view_state_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_view_state
    ADD CONSTRAINT org_node_view_state_unique UNIQUE (node_id, user_id);


--
-- Name: org_nodes org_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_nodes
    ADD CONSTRAINT org_nodes_pkey PRIMARY KEY (id);


--
-- Name: page_addressables page_addressables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_addressables
    ADD CONSTRAINT page_addressables_pkey PRIMARY KEY (id);


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
-- Name: page_help page_help_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_help
    ADD CONSTRAINT page_help_pkey PRIMARY KEY (id);


--
-- Name: page_roles page_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_roles
    ADD CONSTRAINT page_roles_pkey PRIMARY KEY (page_id, role_id);


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
-- Name: permissions permissions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_code_key UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


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
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


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
-- Name: subscription_item_type_icons siti_sub_type_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_item_type_icons
    ADD CONSTRAINT siti_sub_type_unique UNIQUE (subscription_id, item_type);


--
-- Name: sprints sprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprints
    ADD CONSTRAINT sprints_pkey PRIMARY KEY (id);


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
-- Name: subscription_item_type_icons subscription_item_type_icons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_item_type_icons
    ADD CONSTRAINT subscription_item_type_icons_pkey PRIMARY KEY (id);


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
-- Name: vector_icons vector_icons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vector_icons
    ADD CONSTRAINT vector_icons_pkey PRIMARY KEY (id);


--
-- Name: vector_icons vi_pack_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vector_icons
    ADD CONSTRAINT vi_pack_name_unique UNIQUE (pack, name);


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
-- Name: workspace_roles workspace_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_roles
    ADD CONSTRAINT workspace_roles_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


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
-- Name: idx_o_cfl_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_cfl_sub ON public.o_execution_custom_field_library USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_de_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_fv_artefact ON public.o_artefacts_execution_defects_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_de_fv_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_fv_library ON public.o_artefacts_execution_defects_field_values USING btree (field_library_id) WHERE (field_library_id IS NOT NULL);


--
-- Name: idx_o_de_fv_schema_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_fv_schema_field ON public.o_artefacts_execution_defects_field_values USING btree (schema_field_id) WHERE (schema_field_id IS NOT NULL);


--
-- Name: idx_o_de_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_fv_sub ON public.o_artefacts_execution_defects_field_values USING btree (subscription_id);


--
-- Name: idx_o_de_fv_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_fv_template ON public.o_artefacts_execution_defects_field_values USING btree (template_id) WHERE (template_id IS NOT NULL);


--
-- Name: idx_o_de_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_parent ON public.o_artefacts_execution_defects USING btree (parent_id) WHERE (parent_id IS NOT NULL);


--
-- Name: idx_o_de_root_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_root_feature ON public.o_artefacts_execution_defects USING btree (root_feature_id) WHERE (root_feature_id IS NOT NULL);


--
-- Name: idx_o_de_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_search ON public.o_artefacts_execution_defects USING gin (search_index);


--
-- Name: idx_o_de_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_severity ON public.o_artefacts_execution_defects USING btree (subscription_id, severity) WHERE ((severity IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: idx_o_de_sprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_sprint ON public.o_artefacts_execution_defects USING btree (sprint_id) WHERE (sprint_id IS NOT NULL);


--
-- Name: idx_o_de_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_status ON public.o_artefacts_execution_defects USING btree (subscription_id, status) WHERE (archived_at IS NULL);


--
-- Name: idx_o_de_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_sub_created ON public.o_artefacts_execution_defects USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_de_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_de_sub_owner ON public.o_artefacts_execution_defects USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_ep_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ep_fv_artefact ON public.o_artefacts_execution_epics_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_ep_fv_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ep_fv_library ON public.o_artefacts_execution_epics_field_values USING btree (field_library_id) WHERE (field_library_id IS NOT NULL);


--
-- Name: idx_o_ep_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ep_fv_sub ON public.o_artefacts_execution_epics_field_values USING btree (subscription_id);


--
-- Name: idx_o_ep_fv_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ep_fv_template ON public.o_artefacts_execution_epics_field_values USING btree (template_id) WHERE (template_id IS NOT NULL);


--
-- Name: idx_o_ep_root_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ep_root_feature ON public.o_artefacts_execution_epics USING btree (root_feature_id) WHERE (root_feature_id IS NOT NULL);


--
-- Name: idx_o_ep_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ep_search ON public.o_artefacts_execution_epics USING gin (search_index);


--
-- Name: idx_o_ep_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ep_sub_created ON public.o_artefacts_execution_epics USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_ep_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ep_sub_owner ON public.o_artefacts_execution_epics USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


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
-- Name: idx_o_st_fv_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_st_fv_library ON public.o_artefacts_strategic_field_values USING btree (field_library_id) WHERE (field_library_id IS NOT NULL);


--
-- Name: idx_o_st_fv_schema_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_st_fv_schema_field ON public.o_artefacts_strategic_field_values USING btree (schema_field_id) WHERE (schema_field_id IS NOT NULL);


--
-- Name: idx_o_st_fv_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_st_fv_template ON public.o_artefacts_strategic_field_values USING btree (template_id) WHERE (template_id IS NOT NULL);


--
-- Name: idx_o_ta_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_fv_artefact ON public.o_artefacts_execution_tasks_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_ta_fv_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_fv_library ON public.o_artefacts_execution_tasks_field_values USING btree (field_library_id) WHERE (field_library_id IS NOT NULL);


--
-- Name: idx_o_ta_fv_schema_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_fv_schema_field ON public.o_artefacts_execution_tasks_field_values USING btree (schema_field_id) WHERE (schema_field_id IS NOT NULL);


--
-- Name: idx_o_ta_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_fv_sub ON public.o_artefacts_execution_tasks_field_values USING btree (subscription_id);


--
-- Name: idx_o_ta_fv_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_fv_template ON public.o_artefacts_execution_tasks_field_values USING btree (template_id) WHERE (template_id IS NOT NULL);


--
-- Name: idx_o_ta_parent_de; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_parent_de ON public.o_artefacts_execution_tasks USING btree (parent_defect_id) WHERE (parent_defect_id IS NOT NULL);


--
-- Name: idx_o_ta_parent_wi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_parent_wi ON public.o_artefacts_execution_tasks USING btree (parent_work_item_id) WHERE (parent_work_item_id IS NOT NULL);


--
-- Name: idx_o_ta_root_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_root_feature ON public.o_artefacts_execution_tasks USING btree (root_feature_id) WHERE (root_feature_id IS NOT NULL);


--
-- Name: idx_o_ta_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_search ON public.o_artefacts_execution_tasks USING gin (search_index);


--
-- Name: idx_o_ta_sprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_sprint ON public.o_artefacts_execution_tasks USING btree (sprint_id) WHERE (sprint_id IS NOT NULL);


--
-- Name: idx_o_ta_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_status ON public.o_artefacts_execution_tasks USING btree (subscription_id, status) WHERE (archived_at IS NULL);


--
-- Name: idx_o_ta_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_sub_created ON public.o_artefacts_execution_tasks USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_ta_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_ta_sub_owner ON public.o_artefacts_execution_tasks USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_tc_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_fv_artefact ON public.o_artefacts_execution_test_cases_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_tc_fv_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_fv_library ON public.o_artefacts_execution_test_cases_field_values USING btree (field_library_id) WHERE (field_library_id IS NOT NULL);


--
-- Name: idx_o_tc_fv_schema_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_fv_schema_field ON public.o_artefacts_execution_test_cases_field_values USING btree (schema_field_id) WHERE (schema_field_id IS NOT NULL);


--
-- Name: idx_o_tc_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_fv_sub ON public.o_artefacts_execution_test_cases_field_values USING btree (subscription_id);


--
-- Name: idx_o_tc_fv_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_tc_fv_template ON public.o_artefacts_execution_test_cases_field_values USING btree (template_id) WHERE (template_id IS NOT NULL);


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
-- Name: idx_o_wi_backlog_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_backlog_position ON public.o_artefacts_execution_work_items USING btree (subscription_id, backlog_position) WHERE ((archived_at IS NULL) AND (sprint_id IS NULL));


--
-- Name: idx_o_wi_fv_artefact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_fv_artefact ON public.o_artefacts_execution_work_items_field_values USING btree (artefact_id, field_name);


--
-- Name: idx_o_wi_fv_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_fv_library ON public.o_artefacts_execution_work_items_field_values USING btree (field_library_id) WHERE (field_library_id IS NOT NULL);


--
-- Name: idx_o_wi_fv_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_fv_sub ON public.o_artefacts_execution_work_items_field_values USING btree (subscription_id);


--
-- Name: idx_o_wi_fv_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_fv_template ON public.o_artefacts_execution_work_items_field_values USING btree (template_id) WHERE (template_id IS NOT NULL);


--
-- Name: idx_o_wi_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_parent ON public.o_artefacts_execution_work_items USING btree (parent_id) WHERE (parent_id IS NOT NULL);


--
-- Name: idx_o_wi_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_priority ON public.o_artefacts_execution_work_items USING btree (subscription_id, priority) WHERE ((priority IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: idx_o_wi_root_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_root_feature ON public.o_artefacts_execution_work_items USING btree (root_feature_id) WHERE (root_feature_id IS NOT NULL);


--
-- Name: idx_o_wi_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_search ON public.o_artefacts_execution_work_items USING gin (search_index);


--
-- Name: idx_o_wi_sprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_sprint ON public.o_artefacts_execution_work_items USING btree (sprint_id) WHERE (sprint_id IS NOT NULL);


--
-- Name: idx_o_wi_sprint_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_sprint_position ON public.o_artefacts_execution_work_items USING btree (subscription_id, sprint_id, sprint_position) WHERE ((archived_at IS NULL) AND (sprint_id IS NOT NULL));


--
-- Name: idx_o_wi_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_status ON public.o_artefacts_execution_work_items USING btree (subscription_id, status) WHERE (archived_at IS NULL);


--
-- Name: idx_o_wi_sub_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_sub_created ON public.o_artefacts_execution_work_items USING btree (subscription_id, created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_o_wi_sub_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_sub_owner ON public.o_artefacts_execution_work_items USING btree (subscription_id, owner_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_wi_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wi_type ON public.o_artefacts_execution_work_items USING btree (subscription_id, item_type) WHERE (archived_at IS NULL);


--
-- Name: idx_o_wit_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_wit_sub ON public.o_execution_work_item_templates USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_o_witf_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_o_witf_template ON public.o_execution_work_item_template_fields USING btree (template_id, "position");


--
-- Name: idx_org_levels_subscription_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_levels_subscription_position ON public.org_levels USING btree (subscription_id, "position") WHERE (archived_at IS NULL);


--
-- Name: idx_org_node_roles_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_node_roles_node ON public.org_node_roles USING btree (node_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_org_node_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_node_roles_user ON public.org_node_roles USING btree (subscription_id, user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_org_node_view_state_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_node_view_state_user ON public.org_node_view_state USING btree (subscription_id, user_id);


--
-- Name: idx_org_nodes_level_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_nodes_level_id ON public.org_nodes USING btree (level_id) WHERE (archived_at IS NULL);


--
-- Name: idx_org_nodes_sibling_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_nodes_sibling_order ON public.org_nodes USING btree (subscription_id, parent_id, "position") WHERE (archived_at IS NULL);


--
-- Name: idx_org_nodes_subscription_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_nodes_subscription_parent ON public.org_nodes USING btree (subscription_id, parent_id) WHERE (archived_at IS NULL);


--
-- Name: idx_org_nodes_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_nodes_workspace_id ON public.org_nodes USING btree (workspace_id) WHERE (archived_at IS NULL);


--
-- Name: idx_page_entity_refs_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_entity_refs_lookup ON public.page_entity_refs USING btree (entity_kind, entity_id);


--
-- Name: idx_page_roles_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_roles_role_id ON public.page_roles USING btree (role_id);


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
-- Name: idx_permissions_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permissions_category ON public.permissions USING btree (category);


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
-- Name: idx_portfolio_items_org_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_items_org_node ON public.portfolio_items USING btree (org_node_id) WHERE (archived_at IS NULL);


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
-- Name: idx_role_permissions_perm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_perm ON public.role_permissions USING btree (permission_id);


--
-- Name: idx_roles_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_rank ON public.roles USING btree (rank);


--
-- Name: idx_roles_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_subscription ON public.roles USING btree (subscription_id) WHERE (subscription_id IS NOT NULL);


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
-- Name: idx_siti_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_siti_sub ON public.subscription_item_type_icons USING btree (subscription_id);


--
-- Name: idx_sp_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sp_sub ON public.sprints USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_sp_sub_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sp_sub_status ON public.sprints USING btree (subscription_id, status) WHERE (archived_at IS NULL);


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
-- Name: idx_user_stories_org_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_stories_org_node ON public.user_stories USING btree (org_node_id) WHERE (archived_at IS NULL);


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
-- Name: idx_users_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_department ON public.users USING btree (department);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_last_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_last_name ON public.users USING btree (last_name);


--
-- Name: idx_users_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role_id ON public.users USING btree (role_id);


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
-- Name: idx_vi_default_for; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vi_default_for ON public.vector_icons USING btree (default_for) WHERE ((is_default = true) AND (default_for IS NOT NULL));


--
-- Name: idx_vi_pack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vi_pack ON public.vector_icons USING btree (pack);


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
-- Name: library_help_defaults_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX library_help_defaults_lookup ON public.library_help_defaults USING btree (kind, name_pattern, locale);


--
-- Name: org_levels_subscription_depth_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX org_levels_subscription_depth_unique ON public.org_levels USING btree (subscription_id, depth) WHERE (archived_at IS NULL);


--
-- Name: org_node_roles_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX org_node_roles_active_unique ON public.org_node_roles USING btree (node_id, user_id) WHERE (revoked_at IS NULL);


--
-- Name: org_node_roles_single_admin_mvp; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX org_node_roles_single_admin_mvp ON public.org_node_roles USING btree (node_id) WHERE ((revoked_at IS NULL) AND (role = 'admin'::text));


--
-- Name: page_addressables_address_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_addressables_address_idx ON public.page_addressables USING btree (address) WHERE (soft_archived = false);


--
-- Name: page_addressables_gc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_addressables_gc_idx ON public.page_addressables USING btree (last_seen_at) WHERE ((source = ANY (ARRAY['runtime'::text, 'custom_app'::text])) AND (soft_archived = false));


--
-- Name: page_addressables_root_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX page_addressables_root_unique ON public.page_addressables USING btree (page_route, kind, name) WHERE ((soft_archived = false) AND (parent_id IS NULL));


--
-- Name: page_addressables_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_addressables_route_idx ON public.page_addressables USING btree (page_route, soft_archived);


--
-- Name: page_addressables_sibling_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX page_addressables_sibling_unique ON public.page_addressables USING btree (parent_id, kind, name) WHERE (soft_archived = false);


--
-- Name: page_help_addressable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX page_help_addressable_idx ON public.page_help USING btree (addressable_id) WHERE (soft_archived = false);


--
-- Name: page_help_addressable_locale; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX page_help_addressable_locale ON public.page_help USING btree (addressable_id, locale) WHERE (soft_archived = false);


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
-- Name: uq_roles_system_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_roles_system_code ON public.roles USING btree (code) WHERE (subscription_id IS NULL);


--
-- Name: uq_roles_tenant_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_roles_tenant_code ON public.roles USING btree (subscription_id, code) WHERE (subscription_id IS NOT NULL);


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
-- Name: workspace_roles_active_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_roles_active_user ON public.workspace_roles USING btree (workspace_id, user_id) WHERE (revoked_at IS NULL);


--
-- Name: workspace_roles_single_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_roles_single_admin ON public.workspace_roles USING btree (workspace_id) WHERE ((role = 'admin'::text) AND (revoked_at IS NULL));


--
-- Name: workspace_roles_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_roles_user_idx ON public.workspace_roles USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: workspaces_subscription_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspaces_subscription_idx ON public.workspaces USING btree (subscription_id);


--
-- Name: workspaces_subscription_slug_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspaces_subscription_slug_live ON public.workspaces USING btree (subscription_id, slug) WHERE (archived_at IS NULL);


--
-- Name: library_help_defaults library_help_defaults_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER library_help_defaults_updated_at BEFORE UPDATE ON public.library_help_defaults FOR EACH ROW EXECUTE FUNCTION public.page_help_set_updated_at();


--
-- Name: page_addressables page_addressables_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER page_addressables_updated_at BEFORE UPDATE ON public.page_addressables FOR EACH ROW EXECUTE FUNCTION public.page_addressables_set_updated_at();


--
-- Name: page_help page_help_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER page_help_updated_at BEFORE UPDATE ON public.page_help FOR EACH ROW EXECUTE FUNCTION public.page_help_set_updated_at();


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
-- Name: o_execution_custom_field_library trg_o_cfl_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_cfl_updated_at BEFORE UPDATE ON public.o_execution_custom_field_library FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_defects_field_values trg_o_de_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_de_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_defects_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_defects trg_o_de_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_de_updated_at BEFORE UPDATE ON public.o_artefacts_execution_defects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_epics_field_values trg_o_ep_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_ep_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_epics_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_epics trg_o_ep_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_ep_updated_at BEFORE UPDATE ON public.o_artefacts_execution_epics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_strategic_field_values trg_o_pi_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_pi_fv_updated_at BEFORE UPDATE ON public.o_artefacts_strategic_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_strategic trg_o_pi_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_pi_updated_at BEFORE UPDATE ON public.o_artefacts_strategic FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_tasks_field_values trg_o_ta_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_ta_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_tasks_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_tasks trg_o_ta_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_ta_updated_at BEFORE UPDATE ON public.o_artefacts_execution_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_test_cases_field_values trg_o_tc_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_tc_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_test_cases_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_test_cases trg_o_tc_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_tc_updated_at BEFORE UPDATE ON public.o_artefacts_execution_test_cases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_work_items_field_values trg_o_wi_fv_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_wi_fv_updated_at BEFORE UPDATE ON public.o_artefacts_execution_work_items_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_artefacts_execution_work_items trg_o_wi_rank_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_wi_rank_changed AFTER INSERT OR DELETE OR UPDATE ON public.o_artefacts_execution_work_items FOR EACH ROW EXECUTE FUNCTION public.notify_rank_changed('work_item');


--
-- Name: o_artefacts_execution_work_items trg_o_wi_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_wi_updated_at BEFORE UPDATE ON public.o_artefacts_execution_work_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: o_execution_work_item_templates trg_o_wit_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_o_wit_updated_at BEFORE UPDATE ON public.o_execution_work_item_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: org_levels trg_org_levels_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_org_levels_updated_at BEFORE UPDATE ON public.org_levels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: org_node_roles trg_org_node_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_org_node_roles_updated_at BEFORE UPDATE ON public.org_node_roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: org_node_view_state trg_org_node_view_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_org_node_view_state_updated_at BEFORE UPDATE ON public.org_node_view_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: org_nodes trg_org_nodes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_org_nodes_updated_at BEFORE UPDATE ON public.org_nodes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: roles trg_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_item_type_icons trg_siti_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_siti_updated_at BEFORE UPDATE ON public.subscription_item_type_icons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sprints trg_sp_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sp_updated_at BEFORE UPDATE ON public.sprints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: workspace_roles trg_workspace_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspace_roles_updated_at BEFORE UPDATE ON public.workspace_roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace trg_workspace_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspace_updated_at BEFORE UPDATE ON public.workspace FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspaces trg_workspaces_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field_value_field_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field_value_field_library_id_fkey FOREIGN KEY (field_library_id) REFERENCES public.o_execution_custom_field_library(id) ON DELETE SET NULL;


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
-- Name: o_artefacts_execution_defects_field_values o_artefacts_execution_defects_field_values_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects_field_values
    ADD CONSTRAINT o_artefacts_execution_defects_field_values_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.o_execution_work_item_templates(id) ON DELETE SET NULL;


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
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.o_artefacts_execution_work_items(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_sprint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.sprints(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_defects o_artefacts_execution_defects_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_defects
    ADD CONSTRAINT o_artefacts_execution_defects_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


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
-- Name: o_artefacts_execution_epics o_artefacts_execution_epics_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics
    ADD CONSTRAINT o_artefacts_execution_epics_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_epics_field_values o_artefacts_execution_epics_field_values_artefact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics_field_values
    ADD CONSTRAINT o_artefacts_execution_epics_field_values_artefact_id_fkey FOREIGN KEY (artefact_id) REFERENCES public.o_artefacts_execution_epics(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_epics_field_values o_artefacts_execution_epics_field_values_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics_field_values
    ADD CONSTRAINT o_artefacts_execution_epics_field_values_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_epics_field_values o_artefacts_execution_epics_field_values_field_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics_field_values
    ADD CONSTRAINT o_artefacts_execution_epics_field_values_field_library_id_fkey FOREIGN KEY (field_library_id) REFERENCES public.o_execution_custom_field_library(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_epics_field_values o_artefacts_execution_epics_field_values_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics_field_values
    ADD CONSTRAINT o_artefacts_execution_epics_field_values_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_epics_field_values o_artefacts_execution_epics_field_values_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics_field_values
    ADD CONSTRAINT o_artefacts_execution_epics_field_values_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.o_execution_work_item_templates(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_epics_field_values o_artefacts_execution_epics_field_values_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics_field_values
    ADD CONSTRAINT o_artefacts_execution_epics_field_values_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_epics o_artefacts_execution_epics_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics
    ADD CONSTRAINT o_artefacts_execution_epics_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_epics o_artefacts_execution_epics_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics
    ADD CONSTRAINT o_artefacts_execution_epics_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_epics o_artefacts_execution_epics_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics
    ADD CONSTRAINT o_artefacts_execution_epics_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_epics o_artefacts_execution_epics_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_epics
    ADD CONSTRAINT o_artefacts_execution_epics_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


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
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_field_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_field_library_id_fkey FOREIGN KEY (field_library_id) REFERENCES public.o_execution_custom_field_library(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_tasks_field_values o_artefacts_execution_tasks_field_values_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks_field_values
    ADD CONSTRAINT o_artefacts_execution_tasks_field_values_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.o_execution_work_item_templates(id) ON DELETE SET NULL;


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
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_parent_defect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_parent_defect_id_fkey FOREIGN KEY (parent_defect_id) REFERENCES public.o_artefacts_execution_defects(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_parent_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_parent_work_item_id_fkey FOREIGN KEY (parent_work_item_id) REFERENCES public.o_artefacts_execution_work_items(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_sprint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.sprints(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_tasks o_artefacts_execution_tasks_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_tasks
    ADD CONSTRAINT o_artefacts_execution_tasks_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


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
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_field_va_field_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_field_va_field_library_id_fkey FOREIGN KEY (field_library_id) REFERENCES public.o_execution_custom_field_library(id) ON DELETE SET NULL;


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
-- Name: o_artefacts_execution_test_cases_field_values o_artefacts_execution_test_cases_field_values_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_test_cases_field_values
    ADD CONSTRAINT o_artefacts_execution_test_cases_field_values_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.o_execution_work_item_templates(id) ON DELETE SET NULL;


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
-- Name: o_artefacts_execution_work_items o_artefacts_execution_user_stories_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_user_stories_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_work_items_field_values o_artefacts_execution_user_stories_field_v_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_v_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_work_items_field_values o_artefacts_execution_user_stories_field_value_artefact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_value_artefact_id_fkey FOREIGN KEY (artefact_id) REFERENCES public.o_artefacts_execution_work_items(id) ON DELETE CASCADE;


--
-- Name: o_artefacts_execution_work_items_field_values o_artefacts_execution_user_stories_field_values_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_values_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_work_items_field_values o_artefacts_execution_user_stories_field_values_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items_field_values
    ADD CONSTRAINT o_artefacts_execution_user_stories_field_values_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_work_items o_artefacts_execution_user_stories_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_user_stories_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_work_items o_artefacts_execution_user_stories_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_user_stories_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_work_items o_artefacts_execution_user_stories_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_user_stories_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_execution_work_items o_artefacts_execution_user_stories_visibility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_user_stories_visibility_fkey FOREIGN KEY (visibility) REFERENCES public.o_artefact_visibility_levels(level);


--
-- Name: o_artefacts_execution_work_items_field_values o_artefacts_execution_work_items_field_va_field_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items_field_values
    ADD CONSTRAINT o_artefacts_execution_work_items_field_va_field_library_id_fkey FOREIGN KEY (field_library_id) REFERENCES public.o_execution_custom_field_library(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_work_items_field_values o_artefacts_execution_work_items_field_values_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items_field_values
    ADD CONSTRAINT o_artefacts_execution_work_items_field_values_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.o_execution_work_item_templates(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_work_items o_artefacts_execution_work_items_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_work_items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.o_artefacts_execution_work_items(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_execution_work_items o_artefacts_execution_work_items_sprint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_execution_work_items
    ADD CONSTRAINT o_artefacts_execution_work_items_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.sprints(id) ON DELETE SET NULL;


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
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_field_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_field_library_id_fkey FOREIGN KEY (field_library_id) REFERENCES public.o_execution_custom_field_library(id) ON DELETE SET NULL;


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: o_artefacts_strategic_field_values o_artefacts_strategic_field_values_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_artefacts_strategic_field_values
    ADD CONSTRAINT o_artefacts_strategic_field_values_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.o_execution_work_item_templates(id) ON DELETE SET NULL;


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
-- Name: o_execution_custom_field_library o_execution_custom_field_library_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_custom_field_library
    ADD CONSTRAINT o_execution_custom_field_library_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_execution_custom_field_library o_execution_custom_field_library_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_custom_field_library
    ADD CONSTRAINT o_execution_custom_field_library_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: o_execution_work_item_template_fields o_execution_work_item_template_fields_field_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_work_item_template_fields
    ADD CONSTRAINT o_execution_work_item_template_fields_field_library_id_fkey FOREIGN KEY (field_library_id) REFERENCES public.o_execution_custom_field_library(id) ON DELETE RESTRICT;


--
-- Name: o_execution_work_item_template_fields o_execution_work_item_template_fields_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_work_item_template_fields
    ADD CONSTRAINT o_execution_work_item_template_fields_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.o_execution_work_item_templates(id) ON DELETE CASCADE;


--
-- Name: o_execution_work_item_templates o_execution_work_item_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_work_item_templates
    ADD CONSTRAINT o_execution_work_item_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: o_execution_work_item_templates o_execution_work_item_templates_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.o_execution_work_item_templates
    ADD CONSTRAINT o_execution_work_item_templates_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


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
-- Name: org_levels org_levels_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_levels
    ADD CONSTRAINT org_levels_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: org_node_roles org_node_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_roles
    ADD CONSTRAINT org_node_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: org_node_roles org_node_roles_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_roles
    ADD CONSTRAINT org_node_roles_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.org_nodes(id) ON DELETE RESTRICT;


--
-- Name: org_node_roles org_node_roles_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_roles
    ADD CONSTRAINT org_node_roles_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: org_node_roles org_node_roles_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_roles
    ADD CONSTRAINT org_node_roles_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: org_node_roles org_node_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_roles
    ADD CONSTRAINT org_node_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: org_node_view_state org_node_view_state_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_view_state
    ADD CONSTRAINT org_node_view_state_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.org_nodes(id) ON DELETE CASCADE;


--
-- Name: org_node_view_state org_node_view_state_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_view_state
    ADD CONSTRAINT org_node_view_state_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: org_node_view_state org_node_view_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_node_view_state
    ADD CONSTRAINT org_node_view_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: org_nodes org_nodes_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_nodes
    ADD CONSTRAINT org_nodes_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.org_levels(id) ON DELETE RESTRICT;


--
-- Name: org_nodes org_nodes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_nodes
    ADD CONSTRAINT org_nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.org_nodes(id) ON DELETE RESTRICT;


--
-- Name: org_nodes org_nodes_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_nodes
    ADD CONSTRAINT org_nodes_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: org_nodes org_nodes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_nodes
    ADD CONSTRAINT org_nodes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: page_addressables page_addressables_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_addressables
    ADD CONSTRAINT page_addressables_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.page_addressables(id) ON DELETE CASCADE;


--
-- Name: page_entity_refs page_entity_refs_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_entity_refs
    ADD CONSTRAINT page_entity_refs_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_help page_help_addressable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_help
    ADD CONSTRAINT page_help_addressable_id_fkey FOREIGN KEY (addressable_id) REFERENCES public.page_addressables(id) ON DELETE RESTRICT;


--
-- Name: page_help page_help_library_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_help
    ADD CONSTRAINT page_help_library_ref_fkey FOREIGN KEY (library_ref) REFERENCES public.library_help_defaults(id) ON DELETE SET NULL;


--
-- Name: page_help page_help_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_help
    ADD CONSTRAINT page_help_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: page_roles page_roles_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_roles
    ADD CONSTRAINT page_roles_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_roles page_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_roles
    ADD CONSTRAINT page_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


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
-- Name: portfolio_items portfolio_items_org_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_org_node_id_fkey FOREIGN KEY (org_node_id) REFERENCES public.org_nodes(id) ON DELETE RESTRICT;


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
-- Name: role_permissions role_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: roles roles_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sprints sprints_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprints
    ADD CONSTRAINT sprints_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: sprints sprints_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprints
    ADD CONSTRAINT sprints_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: subscription_artifacts subscription_artifacts_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_artifacts
    ADD CONSTRAINT subscription_artifacts_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: subscription_item_type_icons subscription_item_type_icons_icon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_item_type_icons
    ADD CONSTRAINT subscription_item_type_icons_icon_id_fkey FOREIGN KEY (icon_id) REFERENCES public.vector_icons(id) ON DELETE RESTRICT;


--
-- Name: subscription_item_type_icons subscription_item_type_icons_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_item_type_icons
    ADD CONSTRAINT subscription_item_type_icons_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: subscription_item_type_icons subscription_item_type_icons_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_item_type_icons
    ADD CONSTRAINT subscription_item_type_icons_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


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
-- Name: subscriptions subscriptions_topology_committed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_topology_committed_by_fkey FOREIGN KEY (topology_committed_by) REFERENCES public.users(id) ON DELETE SET NULL;


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
-- Name: user_stories user_stories_org_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stories
    ADD CONSTRAINT user_stories_org_node_id_fkey FOREIGN KEY (org_node_id) REFERENCES public.org_nodes(id) ON DELETE RESTRICT;


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
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT;


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
-- Name: workspace_roles workspace_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_roles
    ADD CONSTRAINT workspace_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workspace_roles workspace_roles_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_roles
    ADD CONSTRAINT workspace_roles_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workspace_roles workspace_roles_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_roles
    ADD CONSTRAINT workspace_roles_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: workspace_roles workspace_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_roles
    ADD CONSTRAINT workspace_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workspace_roles workspace_roles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_roles
    ADD CONSTRAINT workspace_roles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace workspace_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: workspaces workspaces_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workspaces workspaces_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workspaces workspaces_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict YnSpaf76Z5uTnAlB39KLRbGqJHUCQdi6vCjEVNOJLvmCn5GG5B9hsnLcp2MENav

