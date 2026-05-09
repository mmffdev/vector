--
-- PostgreSQL database dump
--

\restrict wgFFnhIqUvkynKKHgm3amhB5UTaNExiigbS3bMgukBit17dqk2EbUVabbt6K3OV

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
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;


--
-- Name: trg_library_release_log_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_library_release_log_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'library_release_log is append-only';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: error_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_codes (
    code text NOT NULL,
    severity text NOT NULL,
    category text NOT NULL,
    user_message text NOT NULL,
    dev_message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT error_codes_category_check CHECK ((category = ANY (ARRAY['adoption'::text, 'library'::text, 'auth'::text, 'validation'::text]))),
    CONSTRAINT error_codes_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'critical'::text])))
);


--
-- Name: TABLE error_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.error_codes IS 'MMFF-authored read-only catalogue of error codes. Callers reference rows by code (TEXT PK). No archived_at / updated_at: obsolete codes are removed or superseded via follow-up migration.';


--
-- Name: COLUMN error_codes.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.error_codes.code IS 'Human-meaningful stable identifier (e.g. ADOPT_STEP_FAIL_LAYERS). Treated as an API contract — never repurpose or rename.';


--
-- Name: COLUMN error_codes.severity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.error_codes.severity IS 'info | warning | error | critical. See migration header for definitions.';


--
-- Name: COLUMN error_codes.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.error_codes.category IS 'adoption | library | auth | validation. CHECK-constrained vocabulary.';


--
-- Name: COLUMN error_codes.user_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.error_codes.user_message IS 'Short, user-facing, no jargon. Surfaced verbatim in the UI.';


--
-- Name: COLUMN error_codes.dev_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.error_codes.dev_message IS 'Long, dev-facing. May include hints about what went wrong and what to check; logged but not shown to end users.';


--
-- Name: library_release_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_release_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    release_id uuid NOT NULL,
    action_key text NOT NULL,
    label text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT library_release_actions_action_key_check CHECK ((action_key = ANY (ARRAY['upgrade_model'::text, 'review_terminology'::text, 'enable_flag'::text, 'dismissed'::text])))
);


--
-- Name: TABLE library_release_actions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.library_release_actions IS 'Per-release suggested actions (upgrade model, review terminology, enable flag, dismissable). Plan §12.2.';


--
-- Name: library_release_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_release_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_version text NOT NULL,
    release_id uuid,
    file_name text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_by text DEFAULT CURRENT_USER NOT NULL
);


--
-- Name: TABLE library_release_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.library_release_log IS 'Append-only audit of release artifacts applied to mmff_library. Plan §12.4. UPDATE/DELETE blocked by trigger; grant matrix also denies UPDATE/DELETE.';


--
-- Name: library_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_releases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_version text NOT NULL,
    title text NOT NULL,
    summary_md text NOT NULL,
    body_md text,
    severity text NOT NULL,
    audience_tier text[],
    audience_subscription_ids uuid[],
    affects_model_family_id uuid,
    released_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT library_releases_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'action'::text, 'breaking'::text])))
);


--
-- Name: TABLE library_releases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.library_releases IS 'Per-release metadata for the notification channel. Published rows surface in gadmin notifications until acknowledged (acks live in mmff_vector). See plan §12.1.';


--
-- Name: COLUMN library_releases.severity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.library_releases.severity IS 'info = banner, action = persistent badge, breaking = blocks /portfolio-model. Plan §12.6.';


--
-- Name: COLUMN library_releases.audience_tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.library_releases.audience_tier IS 'NULL = visible to every subscription tier. Otherwise array of tier values from mmff_vector.subscriptions.tier.';


--
-- Name: portfolio_model_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_model_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    artifact_key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portfolio_model_layers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_model_layers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
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
    CONSTRAINT portfolio_model_layers_tag_check CHECK (((length(tag) >= 2) AND (length(tag) <= 4)))
);


--
-- Name: portfolio_model_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_model_shares (
    model_id uuid NOT NULL,
    grantee_subscription_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by_user_id uuid NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid
);


--
-- Name: TABLE portfolio_model_shares; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.portfolio_model_shares IS 'Per-subscription share grants for portfolio models. grantee_subscription_id and granted_by_user_id are app-enforced FKs into mmff_vector (no cross-DB RI in Postgres).';


--
-- Name: portfolio_model_terminology; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_model_terminology (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portfolio_model_workflow_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_model_workflow_transitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    from_state_id uuid NOT NULL,
    to_state_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_model_workflow_transitions_check CHECK ((from_state_id <> to_state_id))
);


--
-- Name: portfolio_model_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_model_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    layer_id uuid NOT NULL,
    state_key text NOT NULL,
    state_label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_initial boolean DEFAULT false NOT NULL,
    is_terminal boolean DEFAULT false NOT NULL,
    colour text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portfolio_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_family_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    instructions_md text,
    scope text NOT NULL,
    owner_subscription_id uuid,
    visibility text DEFAULT 'private'::text NOT NULL,
    feature_flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    default_view text,
    icon text,
    version integer DEFAULT 1 NOT NULL,
    library_version text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_models_scope_check CHECK ((scope = ANY (ARRAY['system'::text, 'tenant'::text, 'shared'::text]))),
    CONSTRAINT portfolio_models_version_check CHECK ((version > 0)),
    CONSTRAINT portfolio_models_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'public'::text, 'invite'::text]))),
    CONSTRAINT scope_owner_consistency CHECK ((((scope = 'system'::text) AND (owner_subscription_id IS NULL)) OR ((scope <> 'system'::text) AND (owner_subscription_id IS NOT NULL))))
);


--
-- Name: TABLE portfolio_models; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.portfolio_models IS 'Spine of a portfolio model bundle. (model_family_id, version) is the stable identity tenants adopt against. See plan §5 (identity model) and §6.1.';


--
-- Name: COLUMN portfolio_models.owner_subscription_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.portfolio_models.owner_subscription_id IS 'App-enforced FK to mmff_vector.subscriptions. NULL iff scope=''system''.';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Data for Name: error_codes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.error_codes (code, severity, category, user_message, dev_message, created_at) FROM stdin;
ADOPT_PRECONDITION_NO_BUNDLE	error	adoption	No portfolio model is adopted for this subscription yet. Adopt a model before continuing.	Adoption precondition failed: subscription_portfolio_model_state has no row for the active subscription. Caller invoked an adoption-dependent path before initial adoption. Check the route guard and the empty-state UI.	2026-04-27 11:00:10.996592+00
ADOPT_BUNDLE_NOT_FOUND	error	adoption	The selected portfolio model is no longer available. Pick a different model and try again.	mmff_library lookup by (model_family_id, version) returned no row, OR the row exists but archived_at IS NOT NULL. Confirm the bundle was published and not retracted. See plan §5 (adoption identity) and §10 (cross-DB cookbook).	2026-04-27 11:00:10.996592+00
ADOPT_STEP_FAIL_LAYERS	error	adoption	We could not finish setting up the model. Please try again, or contact support if this keeps happening.	Adoption step failed while creating subscription-side mirror rows for portfolio_model_layers. Tx was rolled back; partial state should not exist. Check backend logs for the underlying SQL error and re-run; if persistent, inspect the bundle for layer-shape drift.	2026-04-27 11:00:10.996592+00
ADOPT_TERMINOLOGY_CONFLICT	warning	adoption	Some terms in the new model conflict with terms you have already customised. Review and resolve before continuing.	Three-way merge detected a terminology conflict: subscription override differs from both the prior library default and the new library default. Surface the diff in the adoption review UI; do not auto-resolve. See plan §10 (three-way merge basis columns).	2026-04-27 11:00:10.996592+00
ADOPT_ROLLBACK_REQUIRED	critical	adoption	The model update could not complete and has been rolled back. Your previous setup is unchanged.	Adoption transaction reached the post-commit re-validation step (plan §10) and detected a stale snapshot — library row archived between snapshot and tenant commit. Compensating action ran; subscription remains on prior version. gadmin notification should fire via the release channel.	2026-04-27 11:00:10.996592+00
ADOPT_INTERNAL	critical	adoption	Something went wrong on our end. Please try again in a few minutes.	Generic internal error in the adoption pipeline — use only when a more specific code does not apply. Check the request id in the structured log to trace; promote to a specific code if this is observed in the wild.	2026-04-27 11:00:10.996592+00
\.


--
-- Data for Name: library_release_actions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_release_actions (id, release_id, action_key, label, payload, sort_order, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-00000000ae01	00000000-0000-0000-0000-00000000ad01	dismissed	Dismiss	{}	0	2026-04-27 11:00:10.785463+00	2026-04-27 11:00:10.785463+00
\.


--
-- Data for Name: library_release_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_release_log (id, library_version, release_id, file_name, sha256, applied_at, applied_by) FROM stdin;
662e9b39-b8c4-42c7-9dad-92211426cf87	2026.04.0	00000000-0000-0000-0000-00000000ad01	seed/002_test_release.sql	seed-only-no-checksum	2026-04-27 11:00:10.785463+00	mmff_library_admin
\.


--
-- Data for Name: library_releases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_releases (id, library_version, title, summary_md, body_md, severity, audience_tier, audience_subscription_ids, affects_model_family_id, released_at, expires_at, archived_at, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-00000000ad01	2026.04.0	Vector Standard v1 published	The Vector Standard portfolio model is live. Adopt it from Settings → Portfolio model.	\N	info	\N	\N	00000000-0000-0000-0000-00000000a000	2026-04-27 11:00:10.785463+00	\N	\N	2026-04-27 11:00:10.785463+00	2026-04-27 11:00:10.785463+00
\.


--
-- Data for Name: portfolio_model_artifacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_model_artifacts (id, model_id, artifact_key, enabled, config, archived_at, created_at, updated_at) FROM stdin;
0069458c-b656-459f-b02d-20d6eb97b767	00000000-0000-0000-0000-00000000aa01	board	t	{"default_columns": ["draft", "active", "done"]}	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
e2bf24c0-6717-4cae-a7a7-cf8006d57274	00000000-0000-0000-0000-00000000aa01	sprint	f	{}	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
05989598-c837-46fa-9713-b714416e3a45	00000000-0000-0000-0000-00000000aa01	pi	f	{}	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
47f08c4d-58ec-499a-b272-afe60d18c10e	00000000-0000-0000-0000-00000000bb01	board	t	{"default_columns": ["draft", "active", "done"]}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
6f7590e9-7351-4661-a734-c5ce41fa9e8a	00000000-0000-0000-0000-00000000bb01	sprint	f	{}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
a59a08ee-17aa-4932-8300-0dde37baf7d7	00000000-0000-0000-0000-00000000bb01	pi	f	{}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
a7decf24-1a49-49dc-8670-945e00018c02	00000000-0000-0000-0000-00000000cc01	board	t	{"default_columns": ["draft", "active", "done"]}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
e5d4bb8f-eb08-4810-bf33-77c713d8be3a	00000000-0000-0000-0000-00000000cc01	sprint	f	{}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
2a9780b9-20be-4338-bed3-e679ccf0c985	00000000-0000-0000-0000-00000000cc01	pi	f	{}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
982e934e-7d25-4a97-8460-9ce52005bfe6	00000000-0000-0000-0000-00000000dd01	board	t	{"default_columns": ["draft", "active", "done"]}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
9d2a6061-e1d1-43ec-8a05-e42a02e3ed47	00000000-0000-0000-0000-00000000dd01	sprint	f	{}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
a25e7e41-12c5-47b4-8e82-43c7eb7cc94b	00000000-0000-0000-0000-00000000dd01	pi	f	{}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
dc330071-2928-44dc-8999-7a3ca73a7313	00000000-0000-0000-0000-00000000ee01	board	t	{"default_columns": ["draft", "active", "done"]}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
62554bfb-8cf3-4e66-9963-2361a3f61041	00000000-0000-0000-0000-00000000ee01	sprint	f	{}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
670c9ce3-5d27-475e-9c5b-56ce2868dd65	00000000-0000-0000-0000-00000000ee01	pi	f	{}	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
\.


--
-- Data for Name: portfolio_model_layers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_model_layers (id, model_id, name, tag, sort_order, parent_layer_id, icon, colour, description_md, help_md, allows_children, is_leaf, archived_at, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-00000000ab03	00000000-0000-0000-0000-00000000aa01	Business Objective	BO	30	00000000-0000-0000-0000-00000000ab02	target	\N	Measurable outcome the product is pursuing this period.	\N	t	f	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000bb13	00000000-0000-0000-0000-00000000bb01	Business Epic	BE	30	00000000-0000-0000-0000-00000000bb12	package	\N	Major scope of work delivering portfolio value.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc12	00000000-0000-0000-0000-00000000cc01	Initiative	IN	20	00000000-0000-0000-0000-00000000cc11	package	\N	Initiative laddering up to strategy.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000dd11	00000000-0000-0000-0000-00000000dd01	Initiative	IN	10	\N	star	\N	Single portfolio layer; execution stack handles everything below.	\N	t	t	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ab01	00000000-0000-0000-0000-00000000aa01	Portfolio Runway	PRW	50	\N	route	\N	Strategic horizon — multi-year programme of intent.	\N	t	f	\N	2026-04-27 11:00:09.841143+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000ab02	00000000-0000-0000-0000-00000000aa01	Product	PR	40	00000000-0000-0000-0000-00000000ab01	package	\N	Long-lived value stream owned by a product team.	\N	t	f	\N	2026-04-27 11:00:09.841143+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000ab04	00000000-0000-0000-0000-00000000aa01	Theme	TH	20	00000000-0000-0000-0000-00000000ab03	layers	\N	Release-sized scope: a coherent slice of work that ships together.	\N	t	f	\N	2026-04-27 11:00:09.841143+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000ab05	00000000-0000-0000-0000-00000000aa01	Feature	FT	10	00000000-0000-0000-0000-00000000ab04	star	\N	Adoptable user-facing change. The leaf of the portfolio stack.	\N	t	t	\N	2026-04-27 11:00:09.841143+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000bb11	00000000-0000-0000-0000-00000000bb01	Strategic Objective	SO	50	\N	route	\N	Top-level strategic intent.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000bb12	00000000-0000-0000-0000-00000000bb01	Portfolio Objective	PO	40	00000000-0000-0000-0000-00000000bb11	target	\N	Portfolio-level objective laddering to strategy.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000bb14	00000000-0000-0000-0000-00000000bb01	Business Outcome	BC	20	00000000-0000-0000-0000-00000000bb13	layers	\N	Measurable outcome the epic produces.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000bb15	00000000-0000-0000-0000-00000000bb01	Feature	FE	10	00000000-0000-0000-0000-00000000bb14	star	\N	Adoptable user-facing change.	\N	t	t	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000cc11	00000000-0000-0000-0000-00000000cc01	Strategy	ST	30	\N	route	\N	Strategic intent.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000cc13	00000000-0000-0000-0000-00000000cc01	Feature	FE	10	00000000-0000-0000-0000-00000000cc12	star	\N	Adoptable user-facing change.	\N	t	t	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000ee11	00000000-0000-0000-0000-00000000ee01	Strategic Theme	STH	40	\N	route	\N	Strategic theme.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000ee12	00000000-0000-0000-0000-00000000ee01	Portfolio Backlog	PBL	30	00000000-0000-0000-0000-00000000ee11	layers	\N	Portfolio-level backlog.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000ee13	00000000-0000-0000-0000-00000000ee01	Programme Backlog	PGB	20	00000000-0000-0000-0000-00000000ee12	package	\N	Programme-level backlog.	\N	t	f	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
00000000-0000-0000-0000-00000000ee14	00000000-0000-0000-0000-00000000ee01	Feature	FE	10	00000000-0000-0000-0000-00000000ee13	star	\N	Adoptable user-facing change.	\N	t	t	\N	2026-04-27 11:00:11.383015+00	2026-04-28 06:54:57.215923+00
\.


--
-- Data for Name: portfolio_model_shares; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_model_shares (model_id, grantee_subscription_id, granted_at, granted_by_user_id, revoked_at, revoked_by_user_id) FROM stdin;
\.


--
-- Data for Name: portfolio_model_terminology; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_model_terminology (id, model_id, key, value, archived_at, created_at, updated_at) FROM stdin;
bb65e293-2d1e-4dbe-a5a8-a9ee62e407a4	00000000-0000-0000-0000-00000000aa01	portfolio.runway	Portfolio Runway	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
008ab428-10d0-4748-aff3-cdb4e26bfe44	00000000-0000-0000-0000-00000000aa01	portfolio.product	Product	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
f2161f12-1200-4cee-8736-e334cd15826c	00000000-0000-0000-0000-00000000aa01	portfolio.objective	Business Objective	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
8a5072f9-0559-433b-91a7-2d72ad0ae247	00000000-0000-0000-0000-00000000aa01	portfolio.theme	Theme	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
a26aaff5-6ff5-49f8-920b-027f13416d8f	00000000-0000-0000-0000-00000000aa01	portfolio.feature	Feature	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
fe32392b-5c78-4099-90aa-843449bff672	00000000-0000-0000-0000-00000000bb01	portfolio.strategic_objective	Strategic Objective	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
37c2f822-a173-4c2f-97b2-da7e221053cf	00000000-0000-0000-0000-00000000bb01	portfolio.portfolio_objective	Portfolio Objective	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
b6be3812-e02f-4dfc-b513-164df39c9bed	00000000-0000-0000-0000-00000000bb01	portfolio.business_epic	Business Epic	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
a1f6771e-f7cd-4e58-b385-4c7fc3233794	00000000-0000-0000-0000-00000000bb01	portfolio.business_outcome	Business Outcome	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
186b1870-8c37-4434-bfa8-388524085401	00000000-0000-0000-0000-00000000bb01	portfolio.feature	Feature	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
7fa6f0b5-d925-4a9c-bc6d-af2057711117	00000000-0000-0000-0000-00000000cc01	portfolio.strategy	Strategy	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
726b6363-7164-4cb6-a2ab-96f9118b794c	00000000-0000-0000-0000-00000000cc01	portfolio.initiative	Initiative	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
bdd96565-719b-4b50-816f-e2b2821b182a	00000000-0000-0000-0000-00000000cc01	portfolio.feature	Feature	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
f2901e03-f450-42fb-9900-5279c1d33cc8	00000000-0000-0000-0000-00000000dd01	portfolio.initiative	Initiative	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
35454cca-ada4-4df5-85e4-3dd02013717d	00000000-0000-0000-0000-00000000ee01	portfolio.strategic_theme	Strategic Theme	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
3a6f358d-4759-4324-9170-196960d803fe	00000000-0000-0000-0000-00000000ee01	portfolio.portfolio_backlog	Portfolio Backlog	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
6a5a9fc4-0481-4c65-9d78-7002218a4172	00000000-0000-0000-0000-00000000ee01	portfolio.programme_backlog	Programme Backlog	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
6dd5634d-e4d8-4ed0-9944-72f907740336	00000000-0000-0000-0000-00000000ee01	portfolio.feature	Feature	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
\.


--
-- Data for Name: portfolio_model_workflow_transitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_model_workflow_transitions (id, model_id, from_state_id, to_state_id, archived_at, created_at, updated_at) FROM stdin;
9ac74c39-4446-4580-92f9-5edee8b76ac0	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac11	00000000-0000-0000-0000-00000000ac12	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
c16dac6f-8c35-4904-8a2f-5c47036602fa	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac12	00000000-0000-0000-0000-00000000ac13	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
8d5a46e2-dd92-43de-bf6a-9ca5e2859d24	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac21	00000000-0000-0000-0000-00000000ac22	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
6516a65f-900c-4b7a-97b4-2a891d3ba500	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac22	00000000-0000-0000-0000-00000000ac23	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
5c5e7977-d98d-4d9b-9ad6-362d6662d538	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac31	00000000-0000-0000-0000-00000000ac32	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
e34aeb73-aa8b-4b58-9a0b-748903235fff	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac32	00000000-0000-0000-0000-00000000ac33	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
bd75648b-0ba1-4658-a049-60fa58a5fcd3	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac41	00000000-0000-0000-0000-00000000ac42	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
416a353d-f8e8-4b30-a395-399674836e77	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac42	00000000-0000-0000-0000-00000000ac43	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
498d9c97-9f9a-4717-b421-594b4619b445	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac51	00000000-0000-0000-0000-00000000ac52	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
8c3d03d2-fa08-4e98-a7a8-9af2bfb01ce9	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ac52	00000000-0000-0000-0000-00000000ac53	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
2b504fba-b29e-4d21-9cb7-dd507f9775c9	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc11	00000000-0000-0000-0000-00000000bc12	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
1ad578a8-2326-4aa9-b619-8fc35b209a2f	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc12	00000000-0000-0000-0000-00000000bc13	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
b5e92078-1196-4a7f-a281-a96043a5bcca	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc21	00000000-0000-0000-0000-00000000bc22	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
f3c73925-ee39-43a8-a9b6-322745aa5c18	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc22	00000000-0000-0000-0000-00000000bc23	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
ec69c52b-5d7a-42f1-8024-baffece6fc41	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc31	00000000-0000-0000-0000-00000000bc32	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
ac0ec47b-0342-457d-ad13-2b5d5701121f	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc32	00000000-0000-0000-0000-00000000bc33	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
55c47915-21e1-4366-af48-4923b12045d3	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc41	00000000-0000-0000-0000-00000000bc42	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
5eef17c6-505f-4404-83d4-275082a80aa8	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc42	00000000-0000-0000-0000-00000000bc43	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
e4a8e34f-4cc4-433d-b4b9-fe7cc913e9d3	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc51	00000000-0000-0000-0000-00000000bc52	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
34062481-5b05-4996-9554-4f3573d42e9a	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bc52	00000000-0000-0000-0000-00000000bc53	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
0f7aa650-2b23-41bf-904c-3e28cd5600ae	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc21	00000000-0000-0000-0000-00000000cc22	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
1c024642-666b-4d15-a37e-0efe073004bd	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc22	00000000-0000-0000-0000-00000000cc23	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
6e15c2a8-5167-4203-aa1b-b0ba2df7fabe	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc31	00000000-0000-0000-0000-00000000cc32	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
e6b6c0f8-04bd-4782-b2cf-c5c746db3c6f	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc32	00000000-0000-0000-0000-00000000cc33	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
192a4c9a-4b59-4cc2-94e5-768c4f14aa4c	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc41	00000000-0000-0000-0000-00000000cc42	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
0fc82697-f900-4489-a3d2-c0a726884077	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc42	00000000-0000-0000-0000-00000000cc43	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
d8a45f64-ac24-40c8-a812-eddc5a70069f	00000000-0000-0000-0000-00000000dd01	00000000-0000-0000-0000-00000000dc11	00000000-0000-0000-0000-00000000dc12	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
39821f11-38a8-421c-bbad-bb8da94c24f1	00000000-0000-0000-0000-00000000dd01	00000000-0000-0000-0000-00000000dc12	00000000-0000-0000-0000-00000000dc13	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
4ce009ae-5ffd-4389-b94a-5a5fe5182f2f	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ec11	00000000-0000-0000-0000-00000000ec12	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
373add22-eebc-4871-bbb2-af40d94cdf5b	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ec12	00000000-0000-0000-0000-00000000ec13	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
f6e6d242-f88b-411b-a4c5-f42c3a23bd3a	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ec21	00000000-0000-0000-0000-00000000ec22	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00591379-c2a8-4525-abca-7a203e115893	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ec22	00000000-0000-0000-0000-00000000ec23	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
64d1561d-4f5e-478c-baa8-c0a00f12e7c6	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ec31	00000000-0000-0000-0000-00000000ec32	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
2ca04101-51f9-4557-babb-5a32852d4db3	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ec32	00000000-0000-0000-0000-00000000ec33	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
fb4cd51e-9e3e-41f9-a756-4bfbdd05268d	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ec41	00000000-0000-0000-0000-00000000ec42	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
837b3361-7174-4140-8eb2-eaf03a2f7386	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ec42	00000000-0000-0000-0000-00000000ec43	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
\.


--
-- Data for Name: portfolio_model_workflows; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_model_workflows (id, model_id, layer_id, state_key, state_label, sort_order, is_initial, is_terminal, colour, archived_at, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-00000000ac11	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab01	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac12	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab01	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac13	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab01	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac21	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab02	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac22	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab02	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac23	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab02	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac31	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab03	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac32	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab03	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac33	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab03	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac41	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab04	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac42	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab04	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac43	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab04	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac51	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab05	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac52	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab05	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000ac53	00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000ab05	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000bc11	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb11	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc12	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb11	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc13	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb11	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc21	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb12	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc22	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb12	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc23	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb12	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc31	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb13	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc32	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb13	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc33	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb13	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc41	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb14	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc42	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb14	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc43	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb14	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc51	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb15	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc52	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb15	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000bc53	00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000bb15	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc21	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc11	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc22	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc11	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc23	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc11	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc31	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc12	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc32	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc12	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc33	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc12	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc41	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc13	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc42	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc13	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc43	00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000cc13	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000dc11	00000000-0000-0000-0000-00000000dd01	00000000-0000-0000-0000-00000000dd11	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000dc12	00000000-0000-0000-0000-00000000dd01	00000000-0000-0000-0000-00000000dd11	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000dc13	00000000-0000-0000-0000-00000000dd01	00000000-0000-0000-0000-00000000dd11	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec11	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee11	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec12	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee11	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec13	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee11	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec21	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee12	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec22	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee12	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec23	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee12	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec31	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee13	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec32	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee13	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec33	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee13	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec41	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee14	draft	Draft	10	t	f	#94a3b8	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec42	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee14	active	Active	20	f	f	#3b82f6	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ec43	00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000ee14	done	Done	30	f	t	#10b981	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
\.


--
-- Data for Name: portfolio_models; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_models (id, model_family_id, key, name, description, instructions_md, scope, owner_subscription_id, visibility, feature_flags, default_view, icon, version, library_version, archived_at, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-00000000aa01	00000000-0000-0000-0000-00000000a000	mmff	Vector Standard	**What**\n\nVector Standard is the MMFF native hierarchy. Five layers run from multi-year strategic planning down to individual features shipping each quarter. It keeps investment decisions separate from release planning so leadership and delivery teams each work at the level that is relevant to them.\n\n**How**\n\nPortfolio Runway captures where the portfolio is heading over the next one to three years. It is not a committed roadmap. Work flows down through Products and Business Objectives, which record what is being improved and why, before reaching Themes and Features, which define what is being built this quarter. Keeping those two questions at different layers stops aspirational roadmap items from being treated as sprint commitments before the underlying objectives have been confirmed.\n\n**Why**\n\nPick Vector Standard if you have no existing framework requirement, or if you want a model that stays current as MMFF develops. Platform updates and new capabilities are built and tested against this structure first.	# Vector Standard model\n\nThe MMFF default. Five portfolio layers from strategy down to deliverable feature, with the execution stack underneath.\n\n- **Portfolio Runway** (PRW): strategic horizon\n- **Product** (PR): long-lived value stream\n- **Business Objective** (BO): measurable outcome\n- **Theme** (TH): release-sized scope\n- **Feature** (FT): adoptable user-facing change\n\nEdit freely after adoption. Updates from MMFF arrive as release notifications you can review and merge per row.	system	\N	public	{}	tree	sitemap	1	2026.04.0	\N	2026-04-27 11:00:09.841143+00	2026-04-27 11:00:09.841143+00
00000000-0000-0000-0000-00000000bb01	00000000-0000-0000-0000-00000000b000	enterprise	Enterprise	**What**\n\nEnterprise is built for large organisations where portfolio strategy and delivery need to stay clearly separated. Five layers from Strategic Objective down to Feature create a distinct accountability at each level: executives set direction, portfolio managers allocate investment, and delivery teams ship outcomes.\n\n**How**\n\nStrategic Objectives capture the multi-year business commitments the organisation must deliver. Portfolio Objectives translate those into measurable targets across one or two planning periods. Business Epics define the major value initiatives that advance each objective. Business Outcomes act as checkpoints confirming the work is producing real results before the next phase. Features at the base are the discrete increments teams pick up sprint by sprint.\n\n**Why**\n\nUse Enterprise when you run formal portfolio governance across multiple delivery programmes under a shared strategic plan, or when you need clear traceability from board-level goals to released software. The extra layers are worth the effort only if you have the governance structure in place to maintain them.	# Enterprise model\n\nA five-layer chain for organisations that separate strategic intent from delivery outcomes.\n\n- **Strategic Objective** (SO): top-level strategic intent\n- **Portfolio Objective** (PO): measurable portfolio target\n- **Business Epic** (BE): major value delivery initiative\n- **Business Outcome** (BC): checkpoint confirming the epic is delivering\n- **Feature** (FE): adoptable user-facing change	system	\N	public	{}	tree	sitemap	1	2026.04.0	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000cc01	00000000-0000-0000-0000-00000000c000	rally	Rally	**What**\n\nRally is a three-layer portfolio hierarchy based on the Broadcom Rally portfolio management approach. The compact chain of Strategy, Initiative, and Feature suits organisations that want visible strategic alignment without the overhead of a deeper structure. Fewer layers means faster planning and less disruption when priorities shift.\n\n**How**\n\nStrategy at the top sets the investment themes that govern where funding goes. Initiatives are the work packages that act on that strategy, typically spanning one or more planning increments and owned at programme level. Features sit directly above the execution stack, connecting strategic intent to the sprint-level work delivery teams pick up day to day.\n\n**Why**\n\nUse Rally when your teams already work in a Rally environment and want familiar terminology in MMFF, or when you need something lighter than Enterprise but still want a distinct strategic layer above delivery work. The three-layer structure works well for programmes running fewer than ten delivery teams.	# Rally model\n\nA lean three-layer chain based on Rally portfolio management.\n\n- **Strategy** (ST): investment themes guiding funding\n- **Initiative** (IN): programme-level work package\n- **Feature** (FE): adoptable user-facing change	system	\N	public	{}	tree	sitemap	1	2026.04.0	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000dd01	00000000-0000-0000-0000-00000000d000	jira	Jira	**What**\n\nThe Jira model is the lightest option in the catalogue. A single portfolio layer, Initiative, sits above the execution stack. It is for teams that already manage delivery work in Jira or a similar tool and want to connect that work to portfolio-level planning without adding a parallel hierarchy on top.\n\n**How**\n\nInitiatives are large strategic containers, broadly equivalent to Jira Initiatives or top-level Epics depending on your configuration. They exist to group delivery work under a declared portfolio commitment. Everything below that level, including epics, stories, and tasks, continues to live in your existing tooling and connects to MMFF through the execution stack.\n\n**Why**\n\nUse Jira when you have an established Jira workflow your teams rely on and do not want to change. A single portfolio layer gives portfolio managers visibility into strategic commitments without asking delivery teams to adopt a new structure. This model requires the least change from an existing Jira setup.	# Jira model\n\nLight-touch: a single portfolio layer above the execution stack. For teams that already manage detailed work in Jira or a similar tool.\n\n- **Initiative** (IN): strategic container grouping delivery work	system	\N	public	{}	tree	sitemap	1	2026.04.0	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
00000000-0000-0000-0000-00000000ee01	00000000-0000-0000-0000-00000000e000	safe	SAFe	**What**\n\nThe SAFe model follows the Scaled Agile Framework portfolio management structure. Four layers connect enterprise strategy to releasable features using terminology that SAFe-trained teams will already know. It suits organisations that have invested in SAFe and want MMFF to reflect that structure rather than requiring teams to translate between two different systems.\n\n**How**\n\nStrategic Themes represent the enterprise-level priorities that guide investment decisions, typically reviewed through a portfolio canvas or Business Agility Review. Portfolio Backlog holds Epics ready or approaching a funding decision. Programme Backlog contains approved work broken into PI-sized deliverables ready for Agile Release Train assignment. Features at the base are what teams pick up in PI planning and deliver across sprints.\n\n**Why**\n\nUse SAFe when your organisation runs PI planning, ART synchronisation, and portfolio Kanban and you want a model that fits that structure. The four-layer chain works well for programmes running multiple Agile Release Trains.	# SAFe model\n\nFour-layer SAFe portfolio chain connecting enterprise strategy to releasable features.\n\n- **Strategic Theme** (STH): enterprise-level investment priority\n- **Portfolio Backlog** (PBL): Epics approaching or at funding decision\n- **Programme Backlog** (PGB): approved work ready for ART assignment\n- **Feature** (FE): adoptable user-facing change	system	\N	public	{}	tree	sitemap	1	2026.04.0	\N	2026-04-27 11:00:11.383015+00	2026-04-27 11:00:11.383015+00
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (filename, applied_at) FROM stdin;
001_init_library.sql	2026-04-28 06:54:54.143726+00
002_roles.sql	2026-04-28 06:54:54.143726+00
003_portfolio_model_bundles.sql	2026-04-28 06:54:54.143726+00
004_portfolio_model_shares.sql	2026-04-28 06:54:54.143726+00
005_grants.sql	2026-04-28 06:54:54.143726+00
006_release_channel.sql	2026-04-28 06:54:54.143726+00
007_grants_release_channel.sql	2026-04-28 06:54:54.143726+00
008_error_codes.sql	2026-04-28 06:54:54.143726+00
009_fix_layer_sort_order.sql	2026-04-28 06:54:57.240072+00
\.


--
-- Name: error_codes error_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_codes
    ADD CONSTRAINT error_codes_pkey PRIMARY KEY (code);


--
-- Name: library_release_actions library_release_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_release_actions
    ADD CONSTRAINT library_release_actions_pkey PRIMARY KEY (id);


--
-- Name: library_release_actions library_release_actions_release_id_action_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_release_actions
    ADD CONSTRAINT library_release_actions_release_id_action_key_key UNIQUE (release_id, action_key);


--
-- Name: library_release_log library_release_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_release_log
    ADD CONSTRAINT library_release_log_pkey PRIMARY KEY (id);


--
-- Name: library_releases library_releases_library_version_title_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_releases
    ADD CONSTRAINT library_releases_library_version_title_key UNIQUE (library_version, title);


--
-- Name: library_releases library_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_releases
    ADD CONSTRAINT library_releases_pkey PRIMARY KEY (id);


--
-- Name: portfolio_model_artifacts portfolio_model_artifacts_model_id_artifact_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_artifacts
    ADD CONSTRAINT portfolio_model_artifacts_model_id_artifact_key_key UNIQUE (model_id, artifact_key);


--
-- Name: portfolio_model_artifacts portfolio_model_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_artifacts
    ADD CONSTRAINT portfolio_model_artifacts_pkey PRIMARY KEY (id);


--
-- Name: portfolio_model_layers portfolio_model_layers_model_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_layers
    ADD CONSTRAINT portfolio_model_layers_model_id_name_key UNIQUE (model_id, name);


--
-- Name: portfolio_model_layers portfolio_model_layers_model_id_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_layers
    ADD CONSTRAINT portfolio_model_layers_model_id_tag_key UNIQUE (model_id, tag);


--
-- Name: portfolio_model_layers portfolio_model_layers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_layers
    ADD CONSTRAINT portfolio_model_layers_pkey PRIMARY KEY (id);


--
-- Name: portfolio_model_shares portfolio_model_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_shares
    ADD CONSTRAINT portfolio_model_shares_pkey PRIMARY KEY (model_id, grantee_subscription_id);


--
-- Name: portfolio_model_terminology portfolio_model_terminology_model_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_terminology
    ADD CONSTRAINT portfolio_model_terminology_model_id_key_key UNIQUE (model_id, key);


--
-- Name: portfolio_model_terminology portfolio_model_terminology_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_terminology
    ADD CONSTRAINT portfolio_model_terminology_pkey PRIMARY KEY (id);


--
-- Name: portfolio_model_workflow_transitions portfolio_model_workflow_transiti_from_state_id_to_state_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflow_transitions
    ADD CONSTRAINT portfolio_model_workflow_transiti_from_state_id_to_state_id_key UNIQUE (from_state_id, to_state_id);


--
-- Name: portfolio_model_workflow_transitions portfolio_model_workflow_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflow_transitions
    ADD CONSTRAINT portfolio_model_workflow_transitions_pkey PRIMARY KEY (id);


--
-- Name: portfolio_model_workflows portfolio_model_workflows_layer_id_state_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflows
    ADD CONSTRAINT portfolio_model_workflows_layer_id_state_key_key UNIQUE (layer_id, state_key);


--
-- Name: portfolio_model_workflows portfolio_model_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflows
    ADD CONSTRAINT portfolio_model_workflows_pkey PRIMARY KEY (id);


--
-- Name: portfolio_models portfolio_models_model_family_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_models
    ADD CONSTRAINT portfolio_models_model_family_id_version_key UNIQUE (model_family_id, version);


--
-- Name: portfolio_models portfolio_models_owner_subscription_id_key_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_models
    ADD CONSTRAINT portfolio_models_owner_subscription_id_key_version_key UNIQUE (owner_subscription_id, key, version);


--
-- Name: portfolio_models portfolio_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_models
    ADD CONSTRAINT portfolio_models_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: idx_error_codes_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_codes_category ON public.error_codes USING btree (category);


--
-- Name: idx_library_release_actions_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_release_actions_release ON public.library_release_actions USING btree (release_id, sort_order);


--
-- Name: idx_library_release_log_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_release_log_release ON public.library_release_log USING btree (release_id) WHERE (release_id IS NOT NULL);


--
-- Name: idx_library_release_log_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_release_log_version ON public.library_release_log USING btree (library_version, applied_at DESC);


--
-- Name: idx_library_releases_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_releases_active ON public.library_releases USING btree (released_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_library_releases_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_releases_family ON public.library_releases USING btree (affects_model_family_id) WHERE ((affects_model_family_id IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: idx_library_releases_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_releases_severity ON public.library_releases USING btree (severity, released_at DESC) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_model_artifacts_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_model_artifacts_model ON public.portfolio_model_artifacts USING btree (model_id);


--
-- Name: idx_portfolio_model_layers_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_model_layers_model ON public.portfolio_model_layers USING btree (model_id);


--
-- Name: idx_portfolio_model_layers_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_model_layers_parent ON public.portfolio_model_layers USING btree (parent_layer_id) WHERE (parent_layer_id IS NOT NULL);


--
-- Name: idx_portfolio_model_shares_grantee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_model_shares_grantee ON public.portfolio_model_shares USING btree (grantee_subscription_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_portfolio_model_terminology_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_model_terminology_model ON public.portfolio_model_terminology USING btree (model_id);


--
-- Name: idx_portfolio_model_transitions_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_model_transitions_model ON public.portfolio_model_workflow_transitions USING btree (model_id);


--
-- Name: idx_portfolio_model_workflows_layer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_model_workflows_layer ON public.portfolio_model_workflows USING btree (layer_id);


--
-- Name: idx_portfolio_model_workflows_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_model_workflows_model ON public.portfolio_model_workflows USING btree (model_id);


--
-- Name: idx_portfolio_models_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_models_active ON public.portfolio_models USING btree (scope, visibility) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_models_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_models_family ON public.portfolio_models USING btree (model_family_id);


--
-- Name: idx_portfolio_models_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portfolio_models_owner ON public.portfolio_models USING btree (owner_subscription_id) WHERE (owner_subscription_id IS NOT NULL);


--
-- Name: library_release_actions trg_library_release_actions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_library_release_actions_updated_at BEFORE UPDATE ON public.library_release_actions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: library_release_log trg_library_release_log_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_library_release_log_no_update BEFORE DELETE OR UPDATE ON public.library_release_log FOR EACH ROW EXECUTE FUNCTION public.trg_library_release_log_immutable();


--
-- Name: library_releases trg_library_releases_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_library_releases_updated_at BEFORE UPDATE ON public.library_releases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_model_artifacts trg_portfolio_model_artifacts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_model_artifacts_updated_at BEFORE UPDATE ON public.portfolio_model_artifacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_model_layers trg_portfolio_model_layers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_model_layers_updated_at BEFORE UPDATE ON public.portfolio_model_layers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_model_terminology trg_portfolio_model_terminology_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_model_terminology_updated_at BEFORE UPDATE ON public.portfolio_model_terminology FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_model_workflow_transitions trg_portfolio_model_transitions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_model_transitions_updated_at BEFORE UPDATE ON public.portfolio_model_workflow_transitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_model_workflows trg_portfolio_model_workflows_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_model_workflows_updated_at BEFORE UPDATE ON public.portfolio_model_workflows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_models trg_portfolio_models_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_models_updated_at BEFORE UPDATE ON public.portfolio_models FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: library_release_actions library_release_actions_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_release_actions
    ADD CONSTRAINT library_release_actions_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.library_releases(id) ON DELETE CASCADE;


--
-- Name: library_release_log library_release_log_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_release_log
    ADD CONSTRAINT library_release_log_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.library_releases(id) ON DELETE SET NULL;


--
-- Name: portfolio_model_artifacts portfolio_model_artifacts_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_artifacts
    ADD CONSTRAINT portfolio_model_artifacts_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.portfolio_models(id) ON DELETE CASCADE;


--
-- Name: portfolio_model_layers portfolio_model_layers_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_layers
    ADD CONSTRAINT portfolio_model_layers_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.portfolio_models(id) ON DELETE CASCADE;


--
-- Name: portfolio_model_layers portfolio_model_layers_parent_layer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_layers
    ADD CONSTRAINT portfolio_model_layers_parent_layer_id_fkey FOREIGN KEY (parent_layer_id) REFERENCES public.portfolio_model_layers(id) ON DELETE RESTRICT;


--
-- Name: portfolio_model_shares portfolio_model_shares_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_shares
    ADD CONSTRAINT portfolio_model_shares_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.portfolio_models(id) ON DELETE CASCADE;


--
-- Name: portfolio_model_terminology portfolio_model_terminology_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_terminology
    ADD CONSTRAINT portfolio_model_terminology_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.portfolio_models(id) ON DELETE CASCADE;


--
-- Name: portfolio_model_workflow_transitions portfolio_model_workflow_transitions_from_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflow_transitions
    ADD CONSTRAINT portfolio_model_workflow_transitions_from_state_id_fkey FOREIGN KEY (from_state_id) REFERENCES public.portfolio_model_workflows(id) ON DELETE CASCADE;


--
-- Name: portfolio_model_workflow_transitions portfolio_model_workflow_transitions_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflow_transitions
    ADD CONSTRAINT portfolio_model_workflow_transitions_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.portfolio_models(id) ON DELETE CASCADE;


--
-- Name: portfolio_model_workflow_transitions portfolio_model_workflow_transitions_to_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflow_transitions
    ADD CONSTRAINT portfolio_model_workflow_transitions_to_state_id_fkey FOREIGN KEY (to_state_id) REFERENCES public.portfolio_model_workflows(id) ON DELETE CASCADE;


--
-- Name: portfolio_model_workflows portfolio_model_workflows_layer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflows
    ADD CONSTRAINT portfolio_model_workflows_layer_id_fkey FOREIGN KEY (layer_id) REFERENCES public.portfolio_model_layers(id) ON DELETE CASCADE;


--
-- Name: portfolio_model_workflows portfolio_model_workflows_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_model_workflows
    ADD CONSTRAINT portfolio_model_workflows_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.portfolio_models(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict wgFFnhIqUvkynKKHgm3amhB5UTaNExiigbS3bMgukBit17dqk2EbUVabbt6K3OV

