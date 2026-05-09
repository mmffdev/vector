--
-- PostgreSQL database dump
--

\restrict 2egpWwJ3vZoMvsfbr59bhARQr0tDzGZXSupDL1SWuvay6JloqqcbohWqTLxE31C

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
ADOPT_PRECONDITION_NO_BUNDLE	error	adoption	No portfolio model is adopted for this subscription yet. Adopt a model before continuing.	Adoption precondition failed: subscription_portfolio_model_state has no row for the active subscription. Caller invoked an adoption-dependent path before initial adoption. Check the route guard and the empty-state UI.	2026-05-05 01:04:15.447523+00
ADOPT_BUNDLE_NOT_FOUND	error	adoption	The selected portfolio model is no longer available. Pick a different model and try again.	mmff_library lookup by (model_family_id, version) returned no row, OR the row exists but archived_at IS NOT NULL. Confirm the bundle was published and not retracted. See plan §5 (adoption identity) and §10 (cross-DB cookbook).	2026-05-05 01:04:15.447523+00
ADOPT_STEP_FAIL_LAYERS	error	adoption	We could not finish setting up the model. Please try again, or contact support if this keeps happening.	Adoption step failed while creating subscription-side mirror rows for portfolio_model_layers. Tx was rolled back; partial state should not exist. Check backend logs for the underlying SQL error and re-run; if persistent, inspect the bundle for layer-shape drift.	2026-05-05 01:04:15.447523+00
ADOPT_TERMINOLOGY_CONFLICT	warning	adoption	Some terms in the new model conflict with terms you have already customised. Review and resolve before continuing.	Three-way merge detected a terminology conflict: subscription override differs from both the prior library default and the new library default. Surface the diff in the adoption review UI; do not auto-resolve. See plan §10 (three-way merge basis columns).	2026-05-05 01:04:15.447523+00
ADOPT_ROLLBACK_REQUIRED	critical	adoption	The model update could not complete and has been rolled back. Your previous setup is unchanged.	Adoption transaction reached the post-commit re-validation step (plan §10) and detected a stale snapshot — library row archived between snapshot and tenant commit. Compensating action ran; subscription remains on prior version. gadmin notification should fire via the release channel.	2026-05-05 01:04:15.447523+00
ADOPT_INTERNAL	critical	adoption	Something went wrong on our end. Please try again in a few minutes.	Generic internal error in the adoption pipeline — use only when a more specific code does not apply. Check the request id in the structured log to trace; promote to a specific code if this is observed in the wild.	2026-05-05 01:04:15.447523+00
\.


--
-- Data for Name: library_release_actions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_release_actions (id, release_id, action_key, label, payload, sort_order, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: library_release_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_release_log (id, library_version, release_id, file_name, sha256, applied_at, applied_by) FROM stdin;
\.


--
-- Data for Name: library_releases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library_releases (id, library_version, title, summary_md, body_md, severity, audience_tier, audience_subscription_ids, affects_model_family_id, released_at, expires_at, archived_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: portfolio_template_layer_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_template_layer_definitions (tag, name, description, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: portfolio_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.portfolio_templates (id, name, description, layers, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (filename, applied_at) FROM stdin;
001_init_library.sql	2026-05-05 01:04:03.740462+00
002_roles.sql	2026-05-05 01:04:14.862016+00
003_portfolio_model_bundles.sql	2026-05-05 01:04:15.019611+00
004_portfolio_model_shares.sql	2026-05-05 01:04:15.120713+00
005_grants.sql	2026-05-05 01:04:15.209981+00
006_release_channel.sql	2026-05-05 01:04:15.30518+00
007_grants_release_channel.sql	2026-05-05 01:04:15.383793+00
008_error_codes.sql	2026-05-05 01:04:15.479466+00
009_fix_layer_sort_order.sql	2026-05-05 01:04:15.545382+00
010_portfolio_templates.sql	2026-05-05 01:04:15.664425+00
011_layer_tag_definitions.sql	2026-05-05 01:04:15.727641+00
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
-- Name: portfolio_template_layer_definitions portfolio_template_layer_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_template_layer_definitions
    ADD CONSTRAINT portfolio_template_layer_definitions_pkey PRIMARY KEY (tag);


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

\unrestrict 2egpWwJ3vZoMvsfbr59bhARQr0tDzGZXSupDL1SWuvay6JloqqcbohWqTLxE31C

