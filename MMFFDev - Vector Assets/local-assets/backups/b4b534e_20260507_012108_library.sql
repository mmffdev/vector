--
-- PostgreSQL database dump
--

\restrict gxoWoiJN1hhBMQliQNY4KDhKWSdDf1XZ1sFDYvH97izwx122Z7UWHR6VWtKFFg3

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
-- Name: portfolio_template_layer_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_template_layer_definitions (
    tag text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portfolio_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    layers jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_templates_layers_check CHECK ((jsonb_typeof(layers) = 'array'::text))
);


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
-- Data for Name: portfolio_template_layer_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_template_layer_definitions (tag, name, description, created_at, updated_at) FROM stdin;
PRW	Portfolio Runway	The long-horizon strategic direction of the portfolio. Captures where investment is heading without committing to a delivery roadmap or a fixed timescale.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
PR	Product	A distinct product or platform receiving investment. Groups business objectives that advance the same product line and connects strategic intent to measurable outcomes.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
BO	Business Objective	A measurable improvement the product must deliver. Defines what is being improved and why before work reaches the delivery layers.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
TH	Theme	A cluster of related features shipping within a planning period. Organises delivery work under a shared intent so teams understand the outcome they are contributing to.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
SO	Strategic Objective	A multi-year business commitment set at executive level. Defines the long-horizon outcome the organisation must deliver and governs where portfolio investment is directed.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
PO	Portfolio Objective	A measurable target that advances a strategic objective across one or two planning periods. Translates executive direction into accountable portfolio commitments.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
BE	Business Epic	A major value initiative that delivers against a portfolio objective. Spans multiple teams and planning increments; requires a funding decision before work begins.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
BC	Business Outcome	A checkpoint confirming that a business epic has produced a real result. Sits between investment approval and feature delivery to prevent output being mistaken for outcome.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
ST	Strategy	The investment themes that govern where funding and effort are directed. Set at portfolio level and reviewed each planning increment.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
IN	Initiative	A strategic container grouping delivery work under a declared portfolio commitment. Spans one or more planning increments and is owned at programme level.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
STH	Strategic Theme	An enterprise-level priority that guides investment decisions, reviewed through the portfolio canvas or Business Agility Review.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
PBL	Portfolio Backlog	Epics that are ready or approaching a funding decision. Managed through portfolio Kanban before entering a programme for elaboration.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
PGB	Programme Backlog	Approved work broken into PI-sized deliverables and ready for Agile Release Train assignment during PI planning.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
FE	Feature	AAAA discrete increment of value delivered by a team. The lowest portfolio layer; everything below lives in the execution stack.	2026-04-30 23:50:47.428829+00	2026-04-30 23:50:47.428829+00
\.


--
-- Data for Name: portfolio_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_templates (id, name, description, layers, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-00000000bb01	Enterprise	**What**\n\nEnterprise is built for large organisations where portfolio strategy and delivery need to stay clearly separated. Five layers from Strategic Objective down to Feature create a distinct accountability at each level: executives set direction, portfolio managers allocate investment, and delivery teams ship outcomes.\n\n**How**\n\nStrategic Objectives capture the multi-year business commitments the organisation must deliver. Portfolio Objectives translate those into measurable targets across one or two planning periods. Business Epics define the major value initiatives that advance each objective. Business Outcomes act as checkpoints confirming the work is producing real results before the next phase. Features at the base are the discrete increments teams pick up sprint by sprint.\n\n**Why**\n\nUse Enterprise when you run formal portfolio governance across multiple delivery programmes under a shared strategic plan, or when you need clear traceability from board-level goals to released software. The extra layers are worth the effort only if you have the governance structure in place to maintain them.	[{"tag": "SO", "name": "Strategic Objective", "description": "A multi-year business commitment set at executive level. Defines the long-horizon outcome the organisation must deliver and governs where portfolio investment is directed."}, {"tag": "PO", "name": "Portfolio Objective", "description": "A measurable target that advances a strategic objective across one or two planning periods. Translates executive direction into accountable portfolio commitments."}, {"tag": "BE", "name": "Business Epic", "description": "A major value initiative that delivers against a portfolio objective. Spans multiple teams and planning increments; requires a funding decision before work begins."}, {"tag": "BC", "name": "Business Outcome", "description": "A checkpoint confirming that a business epic has produced a real result. Sits between investment approval and feature delivery to prevent output being mistaken for outcome."}, {"tag": "FE", "name": "Feature", "description": "A discrete increment of value delivered by a team within a sprint cycle. The lowest portfolio layer; everything below lives in the execution stack."}]	2026-04-30 22:19:42.659275+00	2026-04-30 23:45:53.377902+00
00000000-0000-0000-0000-00000000cc01	Rally	**What**\n\nRally is a three-layer portfolio hierarchy based on the Broadcom Rally portfolio management approach. The compact chain of Strategy, Initiative, and Feature suits organisations that want visible strategic alignment without the overhead of a deeper structure. Fewer layers means faster planning and less disruption when priorities shift.\n\n**How**\n\nStrategy at the top sets the investment themes that govern where funding goes. Initiatives are the work packages that act on that strategy, typically spanning one or more planning increments and owned at programme level. Features sit directly above the execution stack, connecting strategic intent to the sprint-level work delivery teams pick up day to day.\n\n**Why**\n\nUse Rally when your teams already work in a Rally environment and want familiar terminology in MMFF, or when you need something lighter than Enterprise but still want a distinct strategic layer above delivery work. The three-layer structure works well for programmes running fewer than ten delivery teams.	[{"tag": "ST", "name": "Strategy", "description": "The investment themes that govern where funding and effort are directed. Set at portfolio level and reviewed each planning increment."}, {"tag": "IN", "name": "Initiative", "description": "A work package that acts on a strategic theme, typically spanning one or more planning increments and owned at programme level."}, {"tag": "FE", "name": "Feature", "description": "A discrete increment of value connecting strategic intent to the sprint-level work delivery teams pick up day to day."}]	2026-04-30 22:19:42.659275+00	2026-04-30 23:45:53.377902+00
00000000-0000-0000-0000-00000000aa01	Vector Standard	**What**\n\nVector Standard is the MMFF native hierarchy. Five layers run from multi-year strategic planning down to individual features shipping each quarter. It keeps investment decisions separate from release planning so leadership and delivery teams each work at the level that is relevant to them.\n\n**How**\n\nPortfolio Runway captures where the portfolio is heading over the next one to three years. It is not a committed roadmap. Work flows down through Products and Business Objectives, which record what is being improved and why, before reaching Themes and Features, which define what is being built this quarter. Keeping those two questions at different layers stops aspirational roadmap items from being treated as sprint commitments before the underlying objectives have been confirmed.\n\n**Why**\n\nPick Vector Standard if you have no existing framework requirement, or if you want a model that stays current as MMFF develops. Platform updates and new capabilities are built and tested against this structure first.	[{"tag": "PRW", "name": "Portfolio Runway", "description": "The long-horizon strategic direction of the portfolio. Captures where investment is heading without committing to a delivery roadmap or a fixed timescale."}, {"tag": "PR", "name": "Product", "description": "A distinct product or platform receiving investment. Groups business objectives that advance the same product line and connects strategic intent to measurable outcomes."}, {"tag": "BO", "name": "Business Objective", "description": "A measurable improvement the product must deliver. Defines what is being improved and why before work reaches the delivery layers."}, {"tag": "TH", "name": "Theme", "description": "A cluster of related features shipping within a planning period. Organises delivery work under a shared intent so teams understand the outcome they are contributing to."}, {"tag": "FT", "name": "Feature", "description": "A discrete increment of value delivered by a team within a quarter. The lowest portfolio layer; everything below lives in the execution stack."}]	2026-04-30 22:19:42.659275+00	2026-04-30 23:41:38.529398+00
00000000-0000-0000-0000-00000000ee01	SAFe	**What**\n\nThe SAFe model follows the Scaled Agile Framework portfolio management structure. Four layers connect enterprise strategy to releasable features using terminology that SAFe-trained teams will already know. It suits organisations that have invested in SAFe and want MMFF to reflect that structure rather than requiring teams to translate between two different systems.\n\n**How**\n\nStrategic Themes represent the enterprise-level priorities that guide investment decisions, typically reviewed through a portfolio canvas or Business Agility Review. Portfolio Backlog holds Epics ready or approaching a funding decision. Programme Backlog contains approved work broken into PI-sized deliverables ready for Agile Release Train assignment. Features at the base are what teams pick up in PI planning and deliver across sprints.\n\n**Why**\n\nUse SAFe when your organisation runs PI planning, ART synchronisation, and portfolio Kanban and you want a model that fits that structure. The four-layer chain works well for programmes running multiple Agile Release Trains.	[{"tag": "STH", "name": "Strategic Theme", "description": "An enterprise-level priority that guides investment decisions, reviewed through the portfolio canvas or Business Agility Review."}, {"tag": "PBL", "name": "Portfolio Backlog", "description": "Epics that are ready or approaching a funding decision. Managed through portfolio Kanban before entering a programme for elaboration."}, {"tag": "PGB", "name": "Programme Backlog", "description": "Approved work broken into PI-sized deliverables and ready for Agile Release Train assignment during PI planning."}, {"tag": "FE", "name": "Feature", "description": "A discrete increment of value that teams pick up in PI planning and deliver across sprints. The lowest portfolio layer."}]	2026-04-30 22:19:42.659275+00	2026-04-30 23:45:53.377902+00
00000000-0000-0000-0000-00000000dd01	Jira	**What**\n\nThe Jira model is the lightest option in the catalogue. A single portfolio layer, Initiative, sits above the execution stack. It is for teams that already manage delivery work in Jira or a similar tool and want to connect that work to portfolio-level planning without adding a parallel hierarchy on top.\n\n**How**\n\nInitiatives are large strategic containers, broadly equivalent to Jira Initiatives or top-level Epics depending on your configuration. They exist to group delivery work under a declared portfolio commitment. Everything below that level, including epics, stories, and tasks, continues to live in your existing tooling and connects to MMFF through the execution stack.\n\n**Why**\n\nUse Jira when you have an established Jira workflow your teams rely on and do not want to change. A single portfolio layer gives portfolio managers visibility into strategic commitments without asking delivery teams to adopt a new structure. This model requires the least change from an existing Jira setup.	[{"tag": "IN", "name": "Initiative", "description": "A strategic container grouping delivery work under a declared portfolio commitment. Equivalent to a Jira Initiative or top-level Epic depending on your configuration."}]	2026-04-30 22:19:42.659275+00	2026-04-30 23:45:53.377902+00
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
010_portfolio_templates.sql	2026-05-01 07:17:32.980569+00
011_layer_tag_definitions.sql	2026-05-01 07:17:33.490828+00
\.


--
-- Name: error_codes error_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_codes
    ADD CONSTRAINT error_codes_pkey PRIMARY KEY (code);


--
-- Name: portfolio_template_layer_definitions layer_tag_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_template_layer_definitions
    ADD CONSTRAINT layer_tag_definitions_pkey PRIMARY KEY (tag);


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
-- Name: portfolio_templates portfolio_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_templates
    ADD CONSTRAINT portfolio_templates_pkey PRIMARY KEY (id);


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
-- Name: portfolio_templates trg_portfolio_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_portfolio_templates_updated_at BEFORE UPDATE ON public.portfolio_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- PostgreSQL database dump complete
--

\unrestrict gxoWoiJN1hhBMQliQNY4KDhKWSdDf1XZ1sFDYvH97izwx122Z7UWHR6VWtKFFg3

