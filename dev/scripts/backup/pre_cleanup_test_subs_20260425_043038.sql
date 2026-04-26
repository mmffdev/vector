--
-- PostgreSQL database dump
--

\restrict TsGbcLww1AqL9dAzoHtId0CrN4mlZ9VCSUolPVpg4RzkEargxgDgmKIjU1yi9Ce

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: company_roadmap; Type: TABLE; Schema: public; Owner: mmff_dev
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


ALTER TABLE public.company_roadmap OWNER TO mmff_dev;

--
-- Name: entity_stakeholders; Type: TABLE; Schema: public; Owner: mmff_dev
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


ALTER TABLE public.entity_stakeholders OWNER TO mmff_dev;

--
-- Name: execution_item_types; Type: TABLE; Schema: public; Owner: mmff_dev
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


ALTER TABLE public.execution_item_types OWNER TO mmff_dev;

--
-- Name: item_type_states; Type: TABLE; Schema: public; Owner: mmff_dev
--

CREATE TABLE public.item_type_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    item_type_id uuid NOT NULL,
    item_type_kind text NOT NULL,
    name text NOT NULL,
    canonical_code text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_type_states_item_type_kind_check CHECK ((item_type_kind = ANY (ARRAY['portfolio'::text, 'execution'::text])))
);


ALTER TABLE public.item_type_states OWNER TO mmff_dev;

--
-- Name: item_type_transition_edges; Type: TABLE; Schema: public; Owner: mmff_dev
--

CREATE TABLE public.item_type_transition_edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    item_type_id uuid NOT NULL,
    item_type_kind text NOT NULL,
    from_state_id uuid NOT NULL,
    to_state_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT edge_no_self_loop CHECK ((from_state_id <> to_state_id)),
    CONSTRAINT item_type_transition_edges_item_type_kind_check CHECK ((item_type_kind = ANY (ARRAY['portfolio'::text, 'execution'::text])))
);


ALTER TABLE public.item_type_transition_edges OWNER TO mmff_dev;

--
-- Name: portfolio_item_types; Type: TABLE; Schema: public; Owner: mmff_dev
--

CREATE TABLE public.portfolio_item_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    name text NOT NULL,
    tag text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_item_types_tag_check CHECK (((length(tag) >= 2) AND (length(tag) <= 4)))
);


ALTER TABLE public.portfolio_item_types OWNER TO mmff_dev;

--
-- Name: product; Type: TABLE; Schema: public; Owner: mmff_dev
--

CREATE TABLE public.product (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    parent_portfolio_id uuid,
    type_id uuid,
    key_num bigint NOT NULL,
    name text NOT NULL,
    owner_user_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_key_num_check CHECK ((key_num > 0))
);


ALTER TABLE public.product OWNER TO mmff_dev;

--
-- Name: subscription_sequence; Type: TABLE; Schema: public; Owner: mmff_dev
--

CREATE TABLE public.subscription_sequence (
    subscription_id uuid NOT NULL,
    scope text NOT NULL,
    next_num bigint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_sequence_next_num_check CHECK ((next_num > 0))
);


ALTER TABLE public.subscription_sequence OWNER TO mmff_dev;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: mmff_dev
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


ALTER TABLE public.subscriptions OWNER TO mmff_dev;

--
-- Name: COLUMN subscriptions.tier; Type: COMMENT; Schema: public; Owner: mmff_dev
--

COMMENT ON COLUMN public.subscriptions.tier IS 'Entitlement tier for mmff_library access. Values: free, pro, enterprise. Default pro for backfilled rows; billing service will set this going forward.';


--
-- Name: users; Type: TABLE; Schema: public; Owner: mmff_dev
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


ALTER TABLE public.users OWNER TO mmff_dev;

--
-- Name: workspace; Type: TABLE; Schema: public; Owner: mmff_dev
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


ALTER TABLE public.workspace OWNER TO mmff_dev;

--
-- Data for Name: company_roadmap; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.company_roadmap (id, subscription_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
bb51d169-ef92-4205-9ae2-ada94cba46cb	00000000-0000-0000-0000-000000000001	1	Company Roadmap	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
ac1cda0a-ece6-4fad-8eb4-60cbb4b7e19a	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	1	Company Roadmap	45501c52-9ef3-4bbb-9ebb-a83084306802	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
15ba9e8d-b82b-4543-b63b-1bdd1a0fa6ce	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	1	Company Roadmap	95f6f04a-da7f-418d-b9d2-4e94767872ba	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
60be15f0-bc7c-4653-b91f-b3d0d1829d99	4fe02761-85c9-409a-9ea9-04c10f536394	1	Company Roadmap	d89e9e28-3702-4c76-8f11-0f1bd96b98d4	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
be53cf9d-7ddd-4c5d-b619-93c24a50a9c6	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1	Company Roadmap	51f70c45-02d5-40d6-a063-a4ddab4a6f7e	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
3361d1d7-4a9d-4822-b416-bcf2d7e8b15d	2372603a-5775-46f7-8335-43dcde0a2a07	1	Company Roadmap	22645a90-02a1-4cfb-9dc1-b8ad690e91f2	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
4718999b-b91f-40cf-9879-bac6ea5e4f09	10cc89f7-0092-4267-9b90-0bce22d1edab	1	Company Roadmap	76921247-366c-4eab-adbb-30934671ca1f	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
0641ed79-1ac3-45aa-b987-18d6ed1062a3	f936845a-e36a-459b-9b4b-dd5bddf1443e	1	Company Roadmap	fbb8537a-e556-47ea-a6dc-bcabbe92a8b5	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
18c15e1f-36e7-4178-9df9-6491c91a061b	876093ad-808b-47be-ae6c-e6705d7e57b1	1	Company Roadmap	c43007f6-30b9-49de-9d96-38585886341a	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
293cb1c8-452d-4dbd-95ae-e3d73580ebd2	231c3275-4a6f-4589-af4b-1ac863e41f5a	1	Company Roadmap	f4dd18ea-7a09-4ec4-bca0-71c8c1bee84b	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
03ef4711-1bce-4d2e-98a4-cc0365c21c86	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1	Company Roadmap	ae705ff6-26ed-4d59-8ffd-9a093ada3e5d	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
76f01b45-9145-4a7b-955b-09ca405c15e3	97492b25-c98a-48ee-9009-047c783b3f44	1	Company Roadmap	b9cb1f18-66f0-4315-badc-9b20af6da3cb	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
47aab634-e3bd-4a52-8300-71a07cee73ff	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	1	Company Roadmap	60e7b593-a97c-447b-b3da-7f4fcebb5a43	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
f7f345e4-6caf-49b9-bae7-9f2c892e9d13	3c60198d-1cf1-4443-af35-84f20511b17c	1	Company Roadmap	c853e4f1-553e-485f-a627-2dd8bb604e84	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
13d2d442-31ac-4c8f-a0e3-af6ada972a55	96c676b2-8388-49bd-8fc1-e4adba6e8831	1	Company Roadmap	916f7c76-da0a-4ff7-9a36-b3a2d013e2af	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
2f5a4d4f-31ca-4a54-97b7-e88ff2509066	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	1	Company Roadmap	e5f5fed0-3ed4-48a6-a64f-0d416d92dbb0	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
e6d5f93b-5049-4105-b31e-7824d7cac625	635ed3cf-3d86-4985-89eb-8975012d1420	1	Company Roadmap	d57588dc-c748-4240-8ecc-ce2f2d0826c6	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
\.


--
-- Data for Name: entity_stakeholders; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.entity_stakeholders (id, subscription_id, entity_kind, entity_id, user_id, role, created_at) FROM stdin;
3b0e05fc-66ea-4683-a0c7-5941b318a48f	00000000-0000-0000-0000-000000000001	company_roadmap	bb51d169-ef92-4205-9ae2-ada94cba46cb	dbf65721-7b73-4906-a5d0-18fcd7b1db58	owner	2026-04-21 05:46:22.307829+00
5e86000a-c611-4fd7-9669-042976d914be	00000000-0000-0000-0000-000000000001	workspace	0e794717-699e-4577-be0c-b419350d265b	dbf65721-7b73-4906-a5d0-18fcd7b1db58	owner	2026-04-21 05:46:22.307829+00
41277ca3-e790-4757-8b42-b60396ebc865	00000000-0000-0000-0000-000000000001	product	9320b036-816b-41a7-aa6f-4033ee07d2f6	dbf65721-7b73-4906-a5d0-18fcd7b1db58	owner	2026-04-21 05:46:22.307829+00
97ecccf1-563c-4817-af40-13ec016cc8e5	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	company_roadmap	ac1cda0a-ece6-4fad-8eb4-60cbb4b7e19a	45501c52-9ef3-4bbb-9ebb-a83084306802	owner	2026-04-23 06:05:43.305888+00
fd72ffde-024a-43a7-b842-64d434fa7ebb	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	workspace	07779114-f12e-4191-8856-1a761eff8e63	45501c52-9ef3-4bbb-9ebb-a83084306802	owner	2026-04-23 06:05:43.305888+00
4eae92ce-26ba-4934-a8ed-895f4e1dd1a6	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	product	e5694a22-0b71-4f60-8d0b-7e92d5d58464	45501c52-9ef3-4bbb-9ebb-a83084306802	owner	2026-04-23 06:05:43.305888+00
f8626d25-477a-4f04-a82c-ff1928f9e8b5	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	company_roadmap	15ba9e8d-b82b-4543-b63b-1bdd1a0fa6ce	95f6f04a-da7f-418d-b9d2-4e94767872ba	owner	2026-04-23 06:05:44.631317+00
ac6aabab-d632-4983-ae78-b43e901bbd15	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	workspace	c30894ad-825a-4567-9ce2-c2f0bf4f38c2	95f6f04a-da7f-418d-b9d2-4e94767872ba	owner	2026-04-23 06:05:44.631317+00
87a956d2-3fec-4e32-9e9a-412a9857b832	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	product	0f87b6b3-17de-4d40-b299-71a39d73244e	95f6f04a-da7f-418d-b9d2-4e94767872ba	owner	2026-04-23 06:05:44.631317+00
5113c648-b203-4cc5-82e0-efa9190bd994	4fe02761-85c9-409a-9ea9-04c10f536394	company_roadmap	60be15f0-bc7c-4653-b91f-b3d0d1829d99	d89e9e28-3702-4c76-8f11-0f1bd96b98d4	owner	2026-04-23 06:05:45.104266+00
7229632f-b573-454b-998c-3340868e1c5e	4fe02761-85c9-409a-9ea9-04c10f536394	workspace	8fb68ada-0673-42c9-8f49-02eaa56dc7d3	d89e9e28-3702-4c76-8f11-0f1bd96b98d4	owner	2026-04-23 06:05:45.104266+00
4f056966-946b-4672-b981-445c3a181f38	4fe02761-85c9-409a-9ea9-04c10f536394	product	753285df-c003-42de-bddf-88bae23c81a6	d89e9e28-3702-4c76-8f11-0f1bd96b98d4	owner	2026-04-23 06:05:45.104266+00
d9b67ac8-59fb-4e4d-b73a-9837ffbd4565	1e2e4435-7c7b-4f13-898b-872f38a55ffd	company_roadmap	be53cf9d-7ddd-4c5d-b619-93c24a50a9c6	51f70c45-02d5-40d6-a063-a4ddab4a6f7e	owner	2026-04-23 06:05:46.205643+00
64be357e-7583-4035-8563-1eed1e414932	1e2e4435-7c7b-4f13-898b-872f38a55ffd	workspace	0a9f3365-5c2a-41b7-96c6-538790cb8166	51f70c45-02d5-40d6-a063-a4ddab4a6f7e	owner	2026-04-23 06:05:46.205643+00
af0de089-a118-46a3-bfbe-50a45eda4855	1e2e4435-7c7b-4f13-898b-872f38a55ffd	product	d18d32ba-73ad-45db-b4c7-28ad1bd0bb4b	51f70c45-02d5-40d6-a063-a4ddab4a6f7e	owner	2026-04-23 06:05:46.205643+00
7a1cc553-943e-4655-a549-ada5d7f578d7	2372603a-5775-46f7-8335-43dcde0a2a07	company_roadmap	3361d1d7-4a9d-4822-b416-bcf2d7e8b15d	22645a90-02a1-4cfb-9dc1-b8ad690e91f2	owner	2026-04-23 06:06:00.889009+00
e48f9cd8-3969-467b-af60-a4fed491de1b	2372603a-5775-46f7-8335-43dcde0a2a07	workspace	03509a03-6c4d-4df1-85aa-c88d617ab3b5	22645a90-02a1-4cfb-9dc1-b8ad690e91f2	owner	2026-04-23 06:06:00.889009+00
65f6477d-25b5-4352-8219-7f140f395738	2372603a-5775-46f7-8335-43dcde0a2a07	product	6e4036e3-0ad5-46cc-8a59-9798e7de6385	22645a90-02a1-4cfb-9dc1-b8ad690e91f2	owner	2026-04-23 06:06:00.889009+00
71eeefce-b1bc-4dab-8aca-5133496c54dc	10cc89f7-0092-4267-9b90-0bce22d1edab	company_roadmap	4718999b-b91f-40cf-9879-bac6ea5e4f09	76921247-366c-4eab-adbb-30934671ca1f	owner	2026-04-23 06:06:02.598873+00
d21ac6ed-d576-4383-b379-0191b3c0050b	10cc89f7-0092-4267-9b90-0bce22d1edab	workspace	83549435-de1a-459a-a0cf-687d0c150dd4	76921247-366c-4eab-adbb-30934671ca1f	owner	2026-04-23 06:06:02.598873+00
d08e5d2a-dfd0-49fe-bf32-43d015d07952	10cc89f7-0092-4267-9b90-0bce22d1edab	product	bda43e12-c0b2-4e4d-b86b-e298dec8cf62	76921247-366c-4eab-adbb-30934671ca1f	owner	2026-04-23 06:06:02.598873+00
19d05397-880e-4ee8-99ea-5a2d03306b25	231c3275-4a6f-4589-af4b-1ac863e41f5a	company_roadmap	293cb1c8-452d-4dbd-95ae-e3d73580ebd2	f4dd18ea-7a09-4ec4-bca0-71c8c1bee84b	owner	2026-04-23 06:17:04.167639+00
51c07ec3-b96a-4845-a86d-a5b64573647d	f936845a-e36a-459b-9b4b-dd5bddf1443e	company_roadmap	0641ed79-1ac3-45aa-b987-18d6ed1062a3	fbb8537a-e556-47ea-a6dc-bcabbe92a8b5	owner	2026-04-23 06:06:03.316659+00
fee43b5a-ccc9-4ebf-b894-73a89c9b3c64	f936845a-e36a-459b-9b4b-dd5bddf1443e	workspace	a766edab-a312-4c77-b584-c4cb2fde7a97	fbb8537a-e556-47ea-a6dc-bcabbe92a8b5	owner	2026-04-23 06:06:03.316659+00
b4fc8d9f-245d-45fb-8e1a-7f5b2e7008a5	f936845a-e36a-459b-9b4b-dd5bddf1443e	product	a175f0bf-757e-47fc-beec-e0109e0152ae	fbb8537a-e556-47ea-a6dc-bcabbe92a8b5	owner	2026-04-23 06:06:03.316659+00
de01b192-782c-4912-8a76-b6246f5f6fe4	876093ad-808b-47be-ae6c-e6705d7e57b1	company_roadmap	18c15e1f-36e7-4178-9df9-6491c91a061b	c43007f6-30b9-49de-9d96-38585886341a	owner	2026-04-23 06:06:04.398317+00
0c2bb0b6-d6c6-4d0b-bd25-4b18d4e41a5c	876093ad-808b-47be-ae6c-e6705d7e57b1	workspace	5bb9f018-c87b-448c-94c2-c22e2e7482d1	c43007f6-30b9-49de-9d96-38585886341a	owner	2026-04-23 06:06:04.398317+00
335d4941-4ab2-43af-a926-351e87d4eb57	876093ad-808b-47be-ae6c-e6705d7e57b1	product	179925bd-24b1-423f-bfb1-86a45fb7d93f	c43007f6-30b9-49de-9d96-38585886341a	owner	2026-04-23 06:06:04.398317+00
7f063da8-9a4a-48ba-ad04-ed269397b7c9	231c3275-4a6f-4589-af4b-1ac863e41f5a	workspace	32beb657-7090-4adb-a479-7faeccd57d13	f4dd18ea-7a09-4ec4-bca0-71c8c1bee84b	owner	2026-04-23 06:17:04.167639+00
912f67b4-cc7c-4a30-afed-38761b3448cb	231c3275-4a6f-4589-af4b-1ac863e41f5a	product	3ba76062-b5bb-4d0b-afef-975d25d25143	f4dd18ea-7a09-4ec4-bca0-71c8c1bee84b	owner	2026-04-23 06:17:04.167639+00
f09ac1f2-b021-49c6-8d5d-2c4431011eaf	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	company_roadmap	03ef4711-1bce-4d2e-98a4-cc0365c21c86	ae705ff6-26ed-4d59-8ffd-9a093ada3e5d	owner	2026-04-23 06:17:05.488182+00
e7be1baf-d6d9-4578-8a49-c545dbf59f17	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	workspace	38cc341b-f5d4-4b9e-bd15-722981a77baa	ae705ff6-26ed-4d59-8ffd-9a093ada3e5d	owner	2026-04-23 06:17:05.488182+00
7dd4abe3-7efd-4455-98a8-9de91623de7c	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	product	5dd5fb6c-5939-48d4-b767-adc01142c1c9	ae705ff6-26ed-4d59-8ffd-9a093ada3e5d	owner	2026-04-23 06:17:05.488182+00
4a91084f-fc88-4e41-a0bb-6c8261d1957e	97492b25-c98a-48ee-9009-047c783b3f44	company_roadmap	76f01b45-9145-4a7b-955b-09ca405c15e3	b9cb1f18-66f0-4315-badc-9b20af6da3cb	owner	2026-04-23 06:17:05.967504+00
ffbf788b-17e8-40c3-bb47-b2caca2a9cbe	97492b25-c98a-48ee-9009-047c783b3f44	workspace	c4bbc795-56a7-4465-9f43-f8d3b1dfd0f4	b9cb1f18-66f0-4315-badc-9b20af6da3cb	owner	2026-04-23 06:17:05.967504+00
8a145cfb-21e5-4119-a476-7f6ecc3c45dc	97492b25-c98a-48ee-9009-047c783b3f44	product	cf472ce3-fb0d-4ff5-a720-4819eecb451e	b9cb1f18-66f0-4315-badc-9b20af6da3cb	owner	2026-04-23 06:17:05.967504+00
3fd9280e-7ff5-4434-bb2a-c6af2432d041	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	company_roadmap	47aab634-e3bd-4a52-8300-71a07cee73ff	60e7b593-a97c-447b-b3da-7f4fcebb5a43	owner	2026-04-23 06:17:06.742455+00
3ebbbd74-d1f1-4edb-8f76-2c838240dfd9	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	workspace	5726ee8a-c202-415a-bab3-cf87cdf6c8f7	60e7b593-a97c-447b-b3da-7f4fcebb5a43	owner	2026-04-23 06:17:06.742455+00
953d0a69-3af2-4e11-be6a-7151389d9174	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	product	09abee88-acf3-4b63-af18-655b509f78c9	60e7b593-a97c-447b-b3da-7f4fcebb5a43	owner	2026-04-23 06:17:06.742455+00
cd39b3eb-3ef0-4955-af0b-7811282ae2be	3c60198d-1cf1-4443-af35-84f20511b17c	company_roadmap	f7f345e4-6caf-49b9-bae7-9f2c892e9d13	c853e4f1-553e-485f-a627-2dd8bb604e84	owner	2026-04-24 22:12:46.548477+00
ed05b594-86eb-4ede-b285-2e3a525f5b12	3c60198d-1cf1-4443-af35-84f20511b17c	workspace	f83c2e8b-0f56-47d7-afa2-8b93143ef00b	c853e4f1-553e-485f-a627-2dd8bb604e84	owner	2026-04-24 22:12:46.548477+00
2f617d56-816a-4e5a-add7-095aa44c97ba	3c60198d-1cf1-4443-af35-84f20511b17c	product	1c1b5f04-8e6d-41ad-9f82-6e9ed2876b59	c853e4f1-553e-485f-a627-2dd8bb604e84	owner	2026-04-24 22:12:46.548477+00
dd7dcca8-972a-4a6d-97e0-b88e4e636496	96c676b2-8388-49bd-8fc1-e4adba6e8831	company_roadmap	13d2d442-31ac-4c8f-a0e3-af6ada972a55	916f7c76-da0a-4ff7-9a36-b3a2d013e2af	owner	2026-04-24 22:12:48.185961+00
ce7232fe-ad58-42c8-933e-150a2d338a37	96c676b2-8388-49bd-8fc1-e4adba6e8831	workspace	e3e0eb83-5f2c-4e02-8800-845682b45664	916f7c76-da0a-4ff7-9a36-b3a2d013e2af	owner	2026-04-24 22:12:48.185961+00
a03a65df-819b-4be2-b1c7-fe8dc7b9f2ac	96c676b2-8388-49bd-8fc1-e4adba6e8831	product	f69ae18c-ab47-4629-beb0-c152b58e3464	916f7c76-da0a-4ff7-9a36-b3a2d013e2af	owner	2026-04-24 22:12:48.185961+00
97094248-255b-45ba-ab9d-49e24e8e8dcf	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	company_roadmap	2f5a4d4f-31ca-4a54-97b7-e88ff2509066	e5f5fed0-3ed4-48a6-a64f-0d416d92dbb0	owner	2026-04-24 22:12:48.887502+00
fd83bcdd-11c1-4972-89fb-860d04ea9670	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	workspace	334ad168-a744-4422-9ac8-d1adc631c3f3	e5f5fed0-3ed4-48a6-a64f-0d416d92dbb0	owner	2026-04-24 22:12:48.887502+00
47e64cfe-8264-4532-b72a-06f5c7288fe9	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	product	8f884112-e08d-4b61-936c-fdf2db212143	e5f5fed0-3ed4-48a6-a64f-0d416d92dbb0	owner	2026-04-24 22:12:48.887502+00
85eba61c-5a65-453a-a4c4-dee368ea24ca	635ed3cf-3d86-4985-89eb-8975012d1420	company_roadmap	e6d5f93b-5049-4105-b31e-7824d7cac625	d57588dc-c748-4240-8ecc-ce2f2d0826c6	owner	2026-04-24 22:12:49.958356+00
dcab3b1f-b604-4c2b-bd4d-92de8caf80ae	635ed3cf-3d86-4985-89eb-8975012d1420	workspace	a6695cd0-01ef-4627-a863-9d47a4669e62	d57588dc-c748-4240-8ecc-ce2f2d0826c6	owner	2026-04-24 22:12:49.958356+00
5d61ac61-b55b-476f-bec5-642bca291e4c	635ed3cf-3d86-4985-89eb-8975012d1420	product	56e10597-627d-44be-8ff5-a6d2552d75ae	d57588dc-c748-4240-8ecc-ce2f2d0826c6	owner	2026-04-24 22:12:49.958356+00
\.


--
-- Data for Name: execution_item_types; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.execution_item_types (id, subscription_id, name, tag, sort_order, archived_at, created_at, updated_at) FROM stdin;
82701430-7f77-4833-98bc-4bc578bab616	00000000-0000-0000-0000-000000000001	Epic Story	ES	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
8ab11490-6f0d-461e-a8fe-ad43390152b6	00000000-0000-0000-0000-000000000001	User Story	US	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	00000000-0000-0000-0000-000000000001	Defect	DE	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
d681e126-6c40-4967-9fb9-8d9e7f0fd139	00000000-0000-0000-0000-000000000001	Task	TA	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
07046885-13df-47a2-aa9c-a246c9dbacd8	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	Epic Story	ES	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
9925ca3c-4b0e-4e8d-b4ce-610f709869f1	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	User Story	US	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
72332b94-8ef0-47d3-a0de-aad7b2b581db	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	Defect	DE	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
4f4dd6a3-e19e-48ab-bea6-1fc82a80d1c1	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	Task	TA	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
5e2ee236-3a6c-4803-b60f-5e27c237de76	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	Epic Story	ES	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
96408528-458d-4f6c-ac7e-b67c4d12521c	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	User Story	US	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
790f06d7-6f44-46eb-980f-39fc34e7b128	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	Defect	DE	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
ee951907-24db-487a-a174-b25a66ee6d1b	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	Task	TA	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
039f773d-2d12-4952-9fa1-6e393e81bfe7	4fe02761-85c9-409a-9ea9-04c10f536394	Epic Story	ES	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	4fe02761-85c9-409a-9ea9-04c10f536394	User Story	US	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
7950d5d9-3b40-45bd-ba96-38982dacdf7c	4fe02761-85c9-409a-9ea9-04c10f536394	Defect	DE	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
4a53944b-543f-4396-b6ab-623f25b3b760	4fe02761-85c9-409a-9ea9-04c10f536394	Task	TA	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
1e74dbb4-a262-461d-8e05-f9e36edf9c8c	1e2e4435-7c7b-4f13-898b-872f38a55ffd	Epic Story	ES	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	1e2e4435-7c7b-4f13-898b-872f38a55ffd	User Story	US	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
b72d35c6-0db1-45c4-bc67-89744427b645	1e2e4435-7c7b-4f13-898b-872f38a55ffd	Defect	DE	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
e0ac39a8-e7d4-4d2a-8e6e-bb20db49943a	1e2e4435-7c7b-4f13-898b-872f38a55ffd	Task	TA	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
55eda00a-de92-48c9-8a43-a517839fde02	2372603a-5775-46f7-8335-43dcde0a2a07	Epic Story	ES	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
868eb635-d6ff-4a0c-a9e4-684001e684cc	2372603a-5775-46f7-8335-43dcde0a2a07	User Story	US	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
a2f81349-c33a-4748-9ba6-ab8df41b4b63	2372603a-5775-46f7-8335-43dcde0a2a07	Defect	DE	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
be44b997-91f0-4253-b79f-94c4361abcd7	2372603a-5775-46f7-8335-43dcde0a2a07	Task	TA	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
eb6ae363-0250-49a5-b85d-aad4f533ca53	10cc89f7-0092-4267-9b90-0bce22d1edab	Epic Story	ES	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
2b52e241-277f-4e81-a3b0-124bf89a4772	10cc89f7-0092-4267-9b90-0bce22d1edab	User Story	US	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	10cc89f7-0092-4267-9b90-0bce22d1edab	Defect	DE	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
c5ce4402-e020-49a1-971a-a6a1c41e606d	10cc89f7-0092-4267-9b90-0bce22d1edab	Task	TA	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
7e807a8e-3225-4173-9d1e-943c02caa407	f936845a-e36a-459b-9b4b-dd5bddf1443e	Epic Story	ES	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
c5015cce-50b1-40d5-8813-457076334b5e	f936845a-e36a-459b-9b4b-dd5bddf1443e	User Story	US	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
a2342136-2a6a-4b9f-87f7-0475737a8271	f936845a-e36a-459b-9b4b-dd5bddf1443e	Defect	DE	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
fae18c8f-5591-4bcf-9870-b83bb30f9fcf	f936845a-e36a-459b-9b4b-dd5bddf1443e	Task	TA	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
f53838c3-4f0e-4b35-999c-160f946ad6c2	876093ad-808b-47be-ae6c-e6705d7e57b1	Epic Story	ES	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
d61b9965-346d-4361-9eec-18ad8b9ac338	876093ad-808b-47be-ae6c-e6705d7e57b1	User Story	US	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	876093ad-808b-47be-ae6c-e6705d7e57b1	Defect	DE	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
7ee9afa4-8321-4e4b-a541-678742524dfe	876093ad-808b-47be-ae6c-e6705d7e57b1	Task	TA	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
572b031c-e729-4a70-ad70-20742c4b5300	231c3275-4a6f-4589-af4b-1ac863e41f5a	Epic Story	ES	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
40621304-899c-407c-8f1e-51b0b5d6c6b9	231c3275-4a6f-4589-af4b-1ac863e41f5a	User Story	US	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
1060b101-aa02-46bb-819d-3fec272b903f	231c3275-4a6f-4589-af4b-1ac863e41f5a	Defect	DE	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
71337446-0b5e-4b20-88e2-326b991ba2a0	231c3275-4a6f-4589-af4b-1ac863e41f5a	Task	TA	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
1d880685-a90a-4de6-93f4-3a4e871191ce	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	Epic Story	ES	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
021e2478-2757-4be5-81ad-7ced6fbc5106	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	User Story	US	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
b14a284a-16ac-400c-b580-3d140011b3df	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	Defect	DE	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
8cc329aa-42a4-4d71-9dd9-4e5c5416331d	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	Task	TA	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
b828fcdf-631e-439b-acde-c24bd94d7b5a	97492b25-c98a-48ee-9009-047c783b3f44	Epic Story	ES	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	97492b25-c98a-48ee-9009-047c783b3f44	User Story	US	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
735ac886-d5e5-42d7-8f0d-42056f84024f	97492b25-c98a-48ee-9009-047c783b3f44	Defect	DE	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
753eee37-2fff-4d21-917b-13adebd0f41f	97492b25-c98a-48ee-9009-047c783b3f44	Task	TA	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
45df1ece-79f3-457e-99b1-50fdd670bffb	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	Epic Story	ES	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
b5793135-60ed-439d-8ee5-c4034b72604a	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	User Story	US	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
330b6397-3577-49f1-8f57-8b835e8a3a04	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	Defect	DE	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
44c68bda-7896-45de-bc7e-fbca657c52a8	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	Task	TA	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
f15cf382-d9bb-4f51-b0e7-98aeebe09f10	3c60198d-1cf1-4443-af35-84f20511b17c	Epic Story	ES	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
6cdf63bf-557b-4e95-b287-7f86579ba492	3c60198d-1cf1-4443-af35-84f20511b17c	User Story	US	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
4da1609b-48cc-4168-bc48-34551e8cc093	3c60198d-1cf1-4443-af35-84f20511b17c	Defect	DE	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
191df7a5-488a-445f-83e5-ae30d8ddd9c7	3c60198d-1cf1-4443-af35-84f20511b17c	Task	TA	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
bff9dee3-0473-4dd7-b728-b4891ad31366	96c676b2-8388-49bd-8fc1-e4adba6e8831	Epic Story	ES	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
c5daf7d8-4126-4d19-80ae-94c903b1bfcb	96c676b2-8388-49bd-8fc1-e4adba6e8831	User Story	US	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	96c676b2-8388-49bd-8fc1-e4adba6e8831	Defect	DE	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
1b4adcb8-72a6-473d-bd46-26ad1eaa9991	96c676b2-8388-49bd-8fc1-e4adba6e8831	Task	TA	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
0c55bb41-22c2-46b5-84a1-e88b8968be55	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	Epic Story	ES	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
8062683a-5d86-4f0c-81c5-025032daf4af	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	User Story	US	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	Defect	DE	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
0550d826-98bc-418a-b20f-04970468c94b	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	Task	TA	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
0a36a643-aa01-4992-b6f9-98124c8400f2	635ed3cf-3d86-4985-89eb-8975012d1420	Epic Story	ES	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
4b6e5be4-68bd-49db-9cc6-1a1da26b433d	635ed3cf-3d86-4985-89eb-8975012d1420	User Story	US	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
37a103ba-8ede-4b7a-82a1-1b8982d90053	635ed3cf-3d86-4985-89eb-8975012d1420	Defect	DE	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
343caf1b-9cc4-46a2-ae0a-fe2418606033	635ed3cf-3d86-4985-89eb-8975012d1420	Task	TA	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
\.


--
-- Data for Name: item_type_states; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.item_type_states (id, subscription_id, item_type_id, item_type_kind, name, canonical_code, sort_order, archived_at, created_at, updated_at) FROM stdin;
e8b8465d-0b92-4735-9650-2a04e43ac885	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
0551e6ec-cac5-4cbd-8903-5d0156ed4314	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
daf9fa1f-6888-4039-be0c-c9924878c90b	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
0ff7041f-7599-4d1e-bd02-ebe02f0e17ad	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
3e373a77-ca50-4d7c-bca1-b545e58e611e	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	Accepted	accepted	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
f940d727-11e8-4252-b3c0-72a3b234fdce	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
e4729f28-6d08-420c-95e6-02439189f930	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
817c86c0-79e2-435c-b48d-de70d9e1e2c8	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
12f91dfc-f5db-4883-aa69-7fb35ae66c68	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
da374349-d8a5-4336-8249-fbabc3bbc771	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	Accepted	accepted	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
34d8a847-deef-4971-8d8a-b6c67d1f245b	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
d62b2925-19e7-4880-9c95-c952a2ec6fb9	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
a293d338-15cc-47d2-9058-4d33ff8c7b83	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
f9af4ee3-4b90-4a35-af5b-8c598b9ad747	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
afd6bf43-dad0-4e08-8eb5-6d75556f12d7	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	Accepted	accepted	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
319f3a10-b805-4626-a0c7-e45e08d55781	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
c2a7610c-bb21-4e65-9d30-31b67770eb95	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
817ac1f2-3567-45cb-854c-a0e32a86c2f3	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
7cf96223-a6ea-4081-bef9-79f57c064169	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
0ea00386-61bc-43a4-b9a8-d0f2cba91925	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	Accepted	accepted	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
16777e6e-c171-4b20-af4a-635c18f4a9c5	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
7aa07929-eea9-4273-bcad-b34b4115d7c1	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
6c5bfc58-bfd1-4604-9be6-0a31a6373c0d	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
00085ea7-eab6-45af-90ae-b9d8eb629252	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
20a3e437-cc19-4918-b6fe-e06658448cd0	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	Accepted	accepted	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
99dcf0dd-e08b-461f-bfa3-aa13133e40a6	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
7ba929de-8bad-4c81-8bb9-9ef6e8c8b635	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
97d0b3fc-95e5-4499-998c-137b3e074e53	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
99cb2d14-e8cd-4169-b2d1-db849fe2c3d1	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
0ac6626a-52a0-46fa-9d5f-b5b380a8a172	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	Accepted	accepted	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
87fd8b0a-0756-47da-bd48-73daba3b25d4	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
d2f92d64-63e3-474b-a074-ac7787427c76	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
f0a42288-1d27-4a5f-93a2-68e2e4f69c0a	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
39bfb69d-796e-4d01-9f30-f6fe66366928	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
b0036b57-1074-448b-81cf-4d8a16e0c1b2	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	Accepted	accepted	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
772f0cb5-fd86-44b7-af59-2a67c92207aa	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
d577d27c-9f05-4bd1-93a8-d50aedd00f18	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
38812b8e-9898-424c-8067-94977d3f8ae9	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
0456010f-61c3-462d-a9df-c318a8b3c36f	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
059273fb-e6d0-42c6-a2f6-ce3e66c3bc48	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	Accepted	accepted	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
7a57993a-0095-4d97-9ccb-100a0b60d320	00000000-0000-0000-0000-000000000001	d681e126-6c40-4967-9fb9-8d9e7f0fd139	execution	Defined	defined	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
106451c0-09bc-433c-b54c-7d3dcdc106ef	00000000-0000-0000-0000-000000000001	d681e126-6c40-4967-9fb9-8d9e7f0fd139	execution	Ready	ready	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
64b3e20a-66e1-4095-8513-a8f5f2d38140	00000000-0000-0000-0000-000000000001	d681e126-6c40-4967-9fb9-8d9e7f0fd139	execution	In Progress	in_progress	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
8678d9e1-ed44-47bb-9bc2-580db242ff87	00000000-0000-0000-0000-000000000001	d681e126-6c40-4967-9fb9-8d9e7f0fd139	execution	Completed	completed	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
47aea403-5a0a-429c-9fa6-99706a8e66ce	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
c97c194e-d298-4720-af20-4ab2589fafa6	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
1e40ec5e-b987-4c8d-a5c6-1f4a2f477c20	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
1111bd04-7b3f-4100-a204-fda66e3b5aa7	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
3a8893f1-b17e-43a3-933b-7f3e27443542	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
d6c65247-4395-4801-b3b1-8ce046f44acf	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
da3c8e90-ac69-4ea5-a0e6-88b9f5ac5d0c	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
67486125-44fd-4a80-9147-9a59fca33378	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
7f3b99c2-ccf4-4ea6-83ea-3daadaf16dd6	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
95aa0090-0592-4fe9-a0ee-ccb3797ae82a	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
3c39e4d1-1417-4bc1-b68e-b5a75f021095	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
9995e476-7968-4cf7-a89d-d98cff609afa	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
f27cb2a6-baae-4811-9acc-98947b0a39e2	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
266dda6a-988a-461c-b8bd-ce9cb1bfb948	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
15b14e55-32d7-422c-9d71-fbc87dbe9ec3	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
313a0178-21c6-403c-907c-cace304cd216	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
28a4b2b1-673c-4559-be75-02310beefe41	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
994e6bde-9c5a-4e7a-816b-5960c6cda320	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
ea3ddbad-2159-4817-bbcc-c9a4340edd4c	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
3f52d7ea-60be-4fb4-9002-1ab2d19bb6bf	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
3063a29a-36b5-414b-938f-6a209cbcbc05	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
47d143f5-f796-4b2e-9390-76535dea7760	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
c3fa9610-60ab-46c9-b6a1-5e5a947dda67	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
173f84df-7108-44a2-aa4d-bad00befd911	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
53105822-e633-4537-b5a5-d2323816f416	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
8dceb46a-c7da-462c-b807-e1d6928bcaa2	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
e721a189-dca7-4cfc-838e-32ac72355fd1	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
3c23f274-d0ad-4f66-8dcf-d5d6044383de	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
93ca7128-45b8-42ec-8140-116a3b061cd1	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
ae64a562-9937-4e38-b093-7fcc71a7d5f4	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
6c13f81d-9b94-47c0-a676-4471d19dd3c2	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
ccf9867f-20d2-4f5d-8e9b-dbb98fd54889	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
83ed4722-ee6f-46b0-bfeb-d8d97dbda61c	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
e4d07e14-5164-417c-89a0-87c468b76752	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
a4e43fcd-374f-4138-8b72-7e6b2a3aaf48	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
df3b5d57-1a5e-40b5-98da-186871d82b35	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	Accepted	accepted	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
89359bde-1b04-4d9b-9e7c-acf76b7a9ef3	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
55b285d9-b77d-4756-936d-5d275fcc922a	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
f76ca66c-85f6-4e90-9021-5723c73cbc04	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
9be236d6-7d3f-490b-bac0-b234536da878	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
6d281f2c-361c-4ced-a60c-a5f9e5dd1562	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	Accepted	accepted	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
9417c210-7b56-49b2-ae55-d629136ec05e	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
1a95daf2-5a6b-44fb-bd78-d8a2975c9a14	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
324198a6-a622-497b-a17a-dd040b5387e0	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
7f59eb1d-a373-4429-9ae5-c56883577619	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
2d94425a-2e8d-4c05-a9f9-b6278ee4532b	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	Accepted	accepted	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
2198c946-e09f-443b-ae09-c43d61ca3412	231c3275-4a6f-4589-af4b-1ac863e41f5a	71337446-0b5e-4b20-88e2-326b991ba2a0	execution	Defined	defined	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
16e68f2a-e268-407f-a4b2-2eb5e0b71f2a	231c3275-4a6f-4589-af4b-1ac863e41f5a	71337446-0b5e-4b20-88e2-326b991ba2a0	execution	Ready	ready	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
f6c06b64-9325-4656-8d12-0402c028cc9b	231c3275-4a6f-4589-af4b-1ac863e41f5a	71337446-0b5e-4b20-88e2-326b991ba2a0	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
10328748-0d90-4820-a12e-278738a66533	231c3275-4a6f-4589-af4b-1ac863e41f5a	71337446-0b5e-4b20-88e2-326b991ba2a0	execution	Completed	completed	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
463699cf-5f28-459e-9a67-01ec9469cce7	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
8bdec2d4-cb34-4fbd-ad82-fcaf9b7a8b51	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
a10c0d37-e1a4-4f76-a1a7-5da2084f7b47	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
d4fd8cd9-5307-4848-b95f-096d8d235100	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
bcf074d4-4460-4f65-a970-2780c12e72ee	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
a8a7c6a2-995b-4819-b750-ca5285778188	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
d1beeacb-57e7-419b-99df-719f5d84e5d9	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
640caa39-649a-4b17-b764-f73904edcd2e	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
9c09c2ce-e85b-4bcf-b774-94a2db8f6db4	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
5404034f-5cfe-46f9-aa75-5708a30c61b5	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
f39c8f5c-b9bd-4338-a0e8-6b23601a84ba	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
815c5c1f-820a-4cab-b80d-36b0339d1e57	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
9a3d83b4-e22e-41da-92d0-ee6ded442af9	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
5c28166c-0d48-4b0c-afd9-a7f6a1fa8ec2	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
955809f3-efd9-4cf9-95f3-d111bdc0d89e	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
661dd5de-e767-441f-9883-e3f6765c7374	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
4c707927-59f5-4da7-8314-ed47249ba858	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
e62dc92d-9408-400e-b4d9-d0a44a132fc7	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
1ecc5b02-817a-4119-b1c0-8e60a306e71c	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
a9fede18-5ede-497d-94c2-180b4d79e1b4	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
0817c79d-9119-440d-b0a3-9366cd67b592	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
8bd8a059-7a66-4d88-aee7-e3e439981858	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
559f7d80-0526-4b8a-93d0-5e9590beb0a7	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
ffe76053-1841-462d-9abd-be8eb2dc44e9	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
5f5ea073-fe55-4ec8-a7e6-bf35dd31ff46	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
5905c091-9cc2-4a7a-a5bd-5d676ce2e938	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
535cd635-3798-4060-8ffb-64dfc8d2b317	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
a752093b-00e7-4fdc-b801-c2df7a0565fc	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
d181d54a-064d-47b0-bc91-d906692251b0	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
ad02512b-fd2a-4aa9-b9d9-8787c71b3d62	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	Accepted	accepted	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
b80fd4ce-be6f-4f6d-bf5e-a9c2625dac75	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
24605771-6c3b-4e76-a6af-fbbd137266d3	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
5c8e93da-070a-45ba-951f-33a6bfaf8264	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
3cde8a04-4e2e-4eb3-bbb6-bef18762da6d	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
585081b8-8c77-4a95-8788-9e2e3d7c66ab	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	Accepted	accepted	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
aff73955-7cd3-4724-9031-81d0eb756e97	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
a4467795-f94c-4532-b31f-f0430b319d98	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
4c60dd49-e7bc-40c3-8040-87cfcb40a771	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
2146ddcf-73bb-4b44-b1bf-0855c44e55ab	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
f7c374a0-95e7-4bb8-a1d4-b212d178fccc	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	Accepted	accepted	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
eeec3f50-f5f6-44f3-a651-70563d0f1b32	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	8cc329aa-42a4-4d71-9dd9-4e5c5416331d	execution	Defined	defined	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
42a4ead3-ffae-499b-b7f1-284e6fdd67e9	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	8cc329aa-42a4-4d71-9dd9-4e5c5416331d	execution	Ready	ready	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
d0d0acfb-d3b5-466f-ba43-5a48cc01ce3d	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	8cc329aa-42a4-4d71-9dd9-4e5c5416331d	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
8feab6a8-3db2-4524-8ffc-c059997137fc	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	8cc329aa-42a4-4d71-9dd9-4e5c5416331d	execution	Completed	completed	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
06735309-a327-44e6-b2b3-ea086e86355b	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
fd102a24-bc89-428e-8fcd-0a311bedbd5f	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
0f607c63-5412-43a3-94f8-30a48e176e06	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
23363df0-70b0-49ba-838e-88952cf04c7b	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
8b4075a4-27f0-4ec2-8ebc-2559a13ae1c3	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
be526f54-4988-41c3-ab72-6670b0dee528	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
fdec1fcf-6e62-41e1-b36d-efdfe09ffef0	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
b28f50e5-d36d-4aa2-a9b3-36caba249bed	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
05a83194-6e61-4f69-86e3-af506932ad2d	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
b5d2320b-cd93-47ce-95cb-eb66c30a7d50	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
382ab48e-f057-40e5-9192-0eda0bb1dbae	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
7e9b44a7-8f72-4b64-965a-3ddb8e35a1c1	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
03121edd-36ac-49d0-9dab-9450b3148141	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
ab70600f-d7c4-4c21-9791-a0954a9a8aad	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
a5464dec-e2e1-41b4-a19a-5f22cbc075cb	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
3faa1a63-264d-49c9-a429-f6211ad844a3	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
5b9a79c4-a9f8-4f73-b77a-babbecc51734	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
5c16aaf3-20b7-4a07-8fff-f79eccf5dee1	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
94536253-ee4e-4cac-8f14-c3c876d224dd	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
0a575012-4f2a-41cb-bdee-58ae1b54057d	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
18c74d09-331f-4edf-81ab-5f841cf7a4ba	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
822dce67-e556-43ed-b8c1-0eca70466ff6	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
7a32d0de-2b55-4b80-8e6f-b80345119d21	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
a3fbd898-a720-4698-afd7-2ac5163e0e52	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
cacedf26-d7d8-4bf1-bd6c-4c044ffdbbaf	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
e442fce4-ae28-4567-b6ce-7c203fbe60de	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
e4f087c3-41db-45a6-b9a4-23caed07b210	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
ae1565d2-51f0-44d7-a51e-a19efae3995e	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
617f78b9-2da3-456f-adf8-52e2ab343667	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
b58309ba-1905-4dee-8ff0-238f275690c5	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
ce5ac85b-fb61-4a79-8b0f-6bd26fd5cea2	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
3407b192-80b0-485a-b1c0-465a8880b42b	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
abaf9565-e571-4316-a43b-6944e30beac3	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
8d516c0d-0e4f-4310-9c99-8bdeab6a29fc	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
e94340c0-af52-474c-ab5e-14ebd1fe4b08	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
8d2659f0-4906-4608-8690-7dd010bb58e3	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
36b769d6-bd09-47de-9ddf-9097174ffad3	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
b7813c85-b4c4-4619-970d-65bcba1fcf1c	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
43b7aa9d-af6e-45d7-8f63-3ebbec8f4b0e	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
26f2a541-fda6-424b-9109-13ee791ebfe9	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
a4e0a8fb-b3f5-4f40-817e-d63ae7968e5c	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
08feedf3-b2a3-4b37-a762-be09ace37d66	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
11ae6970-a35a-4885-a805-52747fc7de6f	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
97a84d14-fd38-4b1f-ab55-27a7d3e35a95	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
23df626c-45ea-4ce0-b841-97009a434380	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
39ae55d9-6fa1-401c-8fc0-344055fd78c2	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	Accepted	accepted	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
bca2d374-2dea-4757-ac79-79bbf4ec7816	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
f5ccc07e-0b29-4584-aa85-8bdd2674958b	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
398f3b94-f1b2-449d-a2b1-a6c39dd58ad5	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
b2e07535-00fc-4e75-9fc7-816a4ad450f1	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
a3e2aaea-f846-4497-9ae3-3a92b853fc9d	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	Accepted	accepted	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
5a29b674-1236-46aa-bd39-d4132abe11bd	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
b2a5e6d3-e5b6-431c-9b6a-8f336313d1ea	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
3eff8e17-c3a4-453e-8b9b-56126aca3ebf	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
1186e06b-4ec5-4c52-bcc5-49340661deff	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
7c3cb5fd-680c-43ed-94c8-0789e28761b0	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	Accepted	accepted	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
58da8398-9474-4087-b6ae-1c4ee619d9dc	97492b25-c98a-48ee-9009-047c783b3f44	753eee37-2fff-4d21-917b-13adebd0f41f	execution	Defined	defined	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
fd2bc5ef-1688-4e84-9a90-617e97abf292	97492b25-c98a-48ee-9009-047c783b3f44	753eee37-2fff-4d21-917b-13adebd0f41f	execution	Ready	ready	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
ee16bff7-ec55-4ebb-8099-e673e127d0fd	97492b25-c98a-48ee-9009-047c783b3f44	753eee37-2fff-4d21-917b-13adebd0f41f	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
921ebe0b-3e64-4199-ab12-f5b1a9410ad8	97492b25-c98a-48ee-9009-047c783b3f44	753eee37-2fff-4d21-917b-13adebd0f41f	execution	Completed	completed	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
f11478e0-5bc2-4286-8bc5-43499b9f13f4	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
d842c4d9-03d0-484e-a97c-88b293ef0866	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
b16fbf66-9ba7-4f69-a231-c197dc5012ce	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
35df98ef-d02c-44bb-be1c-6fdb6272af4e	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
3849d0f6-b4f8-4f9d-a3e3-0547e2608311	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
27cdbea8-686f-4473-80b0-939ae27339e1	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
039f8bc1-0744-4f5b-8802-1de21c907416	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
7df9cb96-f96e-47ee-98b6-88df573f66e4	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
c5f0aa11-b7d6-48e4-ad9f-c8e40b01c3bf	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
f784942e-0a64-49d6-97a0-2e06d242c300	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
02138f23-f84a-466d-810d-8d02029d9c59	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
1ecfe9c9-a1e8-402a-8439-af8f716d0196	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
ca5adc1b-1914-4868-b679-d34577840fcf	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
df3b4b61-687e-4360-af73-f51b9a478224	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	Accepted	accepted	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
ad9503dc-1241-4fb0-99dc-5fb47efc17dc	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
2349a0fe-d170-43f3-b498-39c287db3009	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
5069ceef-1a18-413c-a19e-9b565406cd74	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
bbd5e3bb-71e8-49eb-a5fc-277c816939e1	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
3069cc23-ff6e-46a6-93ca-87e23931c863	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
5da325d9-06e4-44e5-a2c1-39b8b6927476	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
e17e082f-cb2d-4ed1-9964-bee49a7c4d58	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
6c1d9462-16ba-4b9c-b5d6-e9912936af2e	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
424ec28d-7e0e-4a7f-82c0-d2cde7fb5d7a	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
c28c0795-2a49-4dc3-a071-9b22d57d321f	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
efe2a410-ab6f-45db-b67c-b23bf6a84cb9	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
d1b389a8-559b-4af4-a727-37ae25ffc728	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
42040abd-e109-47f6-bbd1-8c981596e5fc	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
7ad6ad77-3a8a-4bfe-909b-2f69fe66d3a2	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
0e5b77ea-9820-4523-885d-b46104ca0575	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
af52687c-489b-4127-bc86-2ff3082a493f	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
f55df66d-7570-41ff-85ba-b17cb4af1d00	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
27eecec4-754f-40f3-8470-83ac38e142ff	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
5f1d0450-2cf8-4834-8241-25cbe787fcd4	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
f2634679-d5ef-446a-bf1b-c06c7ce164f5	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
6d44c88b-6613-45f6-a650-c494bade2302	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
f43d9d38-4ddc-4528-aba0-4add61d16cfc	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
d34ade64-0723-4eb0-b404-d9963955685b	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
23b22ae0-09ed-4c03-aafc-5670579a1f79	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
f54e94f4-0de5-4b1e-bf6a-ee4b5f387517	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
6ba3bed4-5c40-4150-a249-6b25402b2456	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
41c778d0-dd5a-4926-8afc-6d9023995b62	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	Accepted	accepted	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
0b0596a2-4acc-42a5-8f30-0f57d1b8cc80	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
f75fc619-2595-4ba3-89b4-fb664917b27f	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
3fc33e1c-7c46-499d-a444-15663941a437	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
d5790f01-1c8d-4a8d-9471-8625314becac	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
7c632470-ccc3-4ebf-a7f2-5ec918e45e3c	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	Accepted	accepted	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
443fa14e-ece0-4228-a500-f44a11cc20bd	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
38ebaf03-aa2a-40b6-a6fd-e231512a774c	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
c519cdd9-8bbd-4e2e-ac80-d3ddfacc1c24	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
4a332ed9-af4b-410a-b8b4-7fdc70a883ea	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
cb970e32-0643-487d-b42f-e11cc3e83baf	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	Accepted	accepted	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
e2a6254a-197c-4e2b-8d10-ce3175f9ffe5	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
231786d8-6dab-440f-90f5-ecf2ee6f63d7	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
cf1646d5-bbd7-45a0-a78e-8407ce3a9ec3	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
1a26828f-9767-47ae-81b9-0da5bfa3515c	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
c3a048a8-2ba6-4ccb-b85d-f97da7f2fad9	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	Accepted	accepted	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
9a99b036-3b8f-480e-94dc-c4be71b829a3	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	44c68bda-7896-45de-bc7e-fbca657c52a8	execution	Defined	defined	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
8df56cd8-06e2-467a-8b5d-70fe6d9a976e	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	44c68bda-7896-45de-bc7e-fbca657c52a8	execution	Ready	ready	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
754a3d41-49c6-4906-84d8-4522d5958106	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	44c68bda-7896-45de-bc7e-fbca657c52a8	execution	In Progress	in_progress	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
8afafcb5-e4b0-466f-b046-525cd55aae07	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	44c68bda-7896-45de-bc7e-fbca657c52a8	execution	Completed	completed	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
029a4a58-4d80-42d7-8251-63e668479ee3	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
916f0d1c-1448-4b6d-ba7c-779556a987a7	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
4f7dbfbe-a3aa-4d36-a81f-8c7fb4cea2bc	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	Accepted	accepted	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
246ce41d-eb65-43fa-8151-1adf81e92901	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
bb8f0918-b8de-4225-867f-35abed9e1a45	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
9c6fdbdd-1ffb-4f9d-95b8-9709042ca576	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
4c0ed1d1-d6dc-4c0d-b1c8-e0e4428070d2	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
b96133af-aff2-4bfc-b0d7-98858806b5d5	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	Accepted	accepted	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
c3116e66-01b7-4f38-ac14-bbb952018f4c	635ed3cf-3d86-4985-89eb-8975012d1420	343caf1b-9cc4-46a2-ae0a-fe2418606033	execution	Defined	defined	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
1e79630a-d358-4f3a-aea2-6cb4c60c40a4	635ed3cf-3d86-4985-89eb-8975012d1420	343caf1b-9cc4-46a2-ae0a-fe2418606033	execution	Ready	ready	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
c8e14609-c9ad-47a8-ac95-4a16fdcc2db3	635ed3cf-3d86-4985-89eb-8975012d1420	343caf1b-9cc4-46a2-ae0a-fe2418606033	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
9fe38804-c87c-4009-9a88-0cf0fb846651	635ed3cf-3d86-4985-89eb-8975012d1420	343caf1b-9cc4-46a2-ae0a-fe2418606033	execution	Completed	completed	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
3ece3890-337b-405d-8b97-e37b5ebe90a9	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
4306f4d9-8f5c-4474-ac15-02eba0ae7089	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
ae13f959-c85c-42c3-aba5-c5dcd1f59bfe	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
89c8241e-d9c0-4667-9ef5-fbeeae1cf78f	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
ae126513-2e6d-43d3-9069-8d5d73c8f44f	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
deb9798b-ac87-404e-8eab-132297636c4e	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
624c4ac2-4bae-4239-8333-948b0cd16db8	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
b1ea279f-3b35-41a8-b142-e0ea12cee366	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
fa6fdd32-89ed-4968-a16f-f72d81c932d9	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
04c59a36-8bd8-41d0-946b-7813b1dcaa26	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
6c1cb11a-ef3d-4d46-9f1f-2c1fd89d5912	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
86e66ed9-ec95-41de-8022-4a0214fb20a6	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
2ef14b41-2584-4570-93f3-c9242f932066	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
b300452a-332d-458b-a966-d0039e14a84e	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
989c8a4b-7991-428f-bfb9-d9d0c110cf34	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
03763975-6efa-4a57-bd11-5d81aa72a588	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
5da96113-6762-43b5-9307-1fb7a5546f21	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
df5f0755-86db-400d-8c6a-8f5b0c56acab	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
8e428cec-f911-47c5-9c90-a1e2005aab28	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
7e0550fa-c415-46cf-82c8-a9ad8de40f49	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
fcf059b1-0fa0-4358-99a6-3b5c07887e73	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
6802f7d4-47d0-43c1-8b9a-a7fb479c2fb0	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
7075a751-911a-4955-b49b-fec58b959c14	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
d96109e4-6ef6-4892-ad8e-07f10575f16b	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
4b861fc7-7167-4c40-8310-26ee51ab7b57	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
fc9edeaa-c822-4f83-8385-205de0e3f351	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
35942319-db2f-41d1-8221-5738677fe232	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
6ed94467-9cfb-4a9e-9b3f-e1dbf7732afd	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
f2d6b5de-7275-453b-9741-d7bccb276d08	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
d05751d7-2242-4013-8aaf-76a4f7df9abd	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	Accepted	accepted	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
09e1fc4b-8cd8-4467-b873-9bac8eb89256	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
d6bb3f4b-a46e-4722-8bce-5a00e0688e8d	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
865be7b8-f228-47e8-8457-95faf79be695	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
6a5a4cdf-a6ac-4009-a448-0a95d3a31259	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
ae6ce789-f3da-482e-9836-d37c7c0d63b3	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	Accepted	accepted	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
8b40d623-b4cb-4ce9-b5ea-366f6d5323e8	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
7a26b123-86c3-41fa-a823-30fcfbae75f2	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
874adbe6-59de-4e27-a2b2-f5a2b057e8cc	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
8bc2b5f5-fe76-4055-8026-d4a2ed8408ae	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
bc195284-dbd3-4d31-b595-3edac0042222	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	Accepted	accepted	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
b4d8efe2-1dc8-4b43-bc3f-53e18059b7bd	3c60198d-1cf1-4443-af35-84f20511b17c	191df7a5-488a-445f-83e5-ae30d8ddd9c7	execution	Defined	defined	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
9ac8a226-9d44-42b9-927a-ef7a6f170c2e	3c60198d-1cf1-4443-af35-84f20511b17c	191df7a5-488a-445f-83e5-ae30d8ddd9c7	execution	Ready	ready	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
ce51b168-4b22-4b85-8621-c33de4734ce4	3c60198d-1cf1-4443-af35-84f20511b17c	191df7a5-488a-445f-83e5-ae30d8ddd9c7	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
6778fdea-fec0-49e9-b160-de4e395f3b4a	3c60198d-1cf1-4443-af35-84f20511b17c	191df7a5-488a-445f-83e5-ae30d8ddd9c7	execution	Completed	completed	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
02f2c853-e287-4c8b-b162-c2cbae4306bd	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
afe674ad-759b-4b4e-87e5-acc097103896	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
5a517650-4ad5-43db-a6a4-80fae44225d2	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
87a193cf-374b-4d41-8745-f98522963334	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
49e09838-d038-4dbb-b503-8d442daf6e0e	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
1dda6cab-f973-41f1-af30-7dd45dddad03	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
b79db896-cbf4-4381-bba5-aa92aab23b07	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
3ada48af-d20a-4004-9b92-221b070bf784	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
dfcabbfe-6716-47d6-ac7f-27a8b4a34eb0	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
80e1349c-220b-41b4-ac35-b13810a2b493	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
a21a4022-b691-43a0-b30c-37acf3895c09	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
08090a7b-b99e-4bf6-9ef6-521383603ee9	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
a9ca3e0f-2f37-42a4-b563-f332bdfd6462	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
9b3f9846-824a-45f8-9d5a-8f56bfa29077	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
ed5dc39b-8d8b-442e-ac35-a83dcbfa606f	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
ae60d251-fda9-4ece-8afe-8929cde1a387	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
41504d62-0a6e-4b91-a93d-08cb2680276b	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
db452075-14e7-4ab9-a9cf-ee31b5eda51f	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
d1a81062-12ef-4b07-b5c8-e159a0a0ee63	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
8764d0b2-771a-4bf9-9d67-6c3649c64eb3	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
c62fbee4-0883-4dd1-90ef-25b8adb624ca	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
bcb91d81-f546-4407-a74d-f8c751a3a63a	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
99f14e2b-a52d-4c79-bb3d-627aaf0b69b4	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
592c3dce-451e-4768-8e4d-b22dbc96d8f6	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	Accepted	accepted	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
7b397224-a472-4392-9431-8152385fd51d	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
57d3b60f-8a7b-489b-bb6c-57ec0e337f80	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
ba858f37-756a-4325-aa26-548f3ce0382a	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
9278cfc9-4089-4ee7-a85c-8ccfc19073d2	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
4c92ac30-97c7-4532-8458-0be1dd22e5b9	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	Accepted	accepted	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
e939a73c-1cf5-4245-8113-be1058ba0116	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
7b758698-106d-48a0-91d5-f2a60490c26c	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
b7f97619-ee3c-444b-a0a8-48ab486660e0	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
7171948f-daa6-430f-acaa-8a55e7a30952	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
313b7923-1801-4be2-b071-3bd4cb77eabb	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	Accepted	accepted	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
e942b797-4df4-458b-acd5-f50db895dada	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	4f4dd6a3-e19e-48ab-bea6-1fc82a80d1c1	execution	Defined	defined	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
dc838440-4dc5-4acd-b82d-95deefd02f4d	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	4f4dd6a3-e19e-48ab-bea6-1fc82a80d1c1	execution	Ready	ready	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
bde6bf5c-b2c0-4101-95b1-88790e105ab4	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	4f4dd6a3-e19e-48ab-bea6-1fc82a80d1c1	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
b8ef79e3-c2d4-40aa-8bd0-5a8413ea4634	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	4f4dd6a3-e19e-48ab-bea6-1fc82a80d1c1	execution	Completed	completed	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
649d2c84-d551-4b31-b491-1351a969a9ee	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
2d095429-fdc5-49d6-bf38-1d4cdbe2d9ec	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
be966f98-8122-48f1-96fa-736f5a5c8380	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
cdf40717-99cd-4a04-8adc-ac74715b3c4c	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
cae4a171-17fe-417e-a5ac-d28248e5b637	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
61d8aa96-131d-4616-bfa8-cb4cc2708585	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
26961c7b-1738-413a-8813-a0cc6a849fd5	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
ae77a398-40a5-45c7-884d-6179ebce466c	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
52fbb603-f9b2-4018-bf28-187f63de6691	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
83b5ce35-f211-4949-9cb3-7d02720e5b46	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
28859822-1ed9-448d-8401-83dc9568a833	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
da9ab1d3-30c8-4196-a4ac-95d523239556	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
29430569-eeb0-4a18-8e21-d1af58cbca93	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
79e8618d-fdee-4be5-a11f-99fa792a4a24	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
18391de6-0c21-415c-bc5d-2a93c787eefd	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
a5f8a714-f10e-4379-b9d6-47b62f8aafe6	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
e7b4233c-bdb7-41f2-9c06-9702a3326851	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
b8546f32-fea2-446e-aeec-1dd29a4f6abd	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
764591e7-73fe-4a48-b98e-c4186c3ed9fa	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
f23678d1-dabf-453b-92d6-24b32cbce417	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
bf638fdd-dc9a-49eb-a2ec-918b0c4ead50	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
836dece3-b910-468a-9572-fa6cfd824572	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
76bea9fb-8a38-4297-b9d1-52613039f185	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
b5f81f8b-9e0b-4d0c-9a06-f262745f9ee2	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
17773700-b549-42f4-867c-0c695aa51305	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
d3d93783-aad8-420c-8a7a-3d440c010d2e	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
37e27b00-6dee-4f73-ba8b-2d73a1b47970	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
4bfbb414-aa41-4aa0-92f8-f5b166cd94e7	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
65b99e7e-ad22-47f9-92d3-7a8413b9a5da	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
27ce34ef-8847-4c15-b6ce-6b75ee269b87	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	Accepted	accepted	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
a648ac8b-3f61-4a9d-8799-6490284cec2b	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
e5c11c24-1fdf-42bc-9557-bd1db6733f74	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
9f8e6993-e616-46d6-99bb-814e9facee61	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
e8914366-2e71-4da8-855e-df813afa2935	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
e28c7378-332a-481f-8972-60839bde34e5	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	Accepted	accepted	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
d65366b6-9eaa-4904-8479-2df31f0e8c9e	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
cefb7913-09ea-43b7-afbd-61fae3a0bf2c	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
51bbffc7-b6b0-49d4-b220-0959809ebeaf	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
c022efe7-5967-48ea-a54e-6ce008e6426d	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
fbb1a3e6-aba3-4024-86f9-9b8440be93fb	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	Accepted	accepted	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
a0b1a149-0009-47ae-8381-b38463c551c5	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	ee951907-24db-487a-a174-b25a66ee6d1b	execution	Defined	defined	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
cf7a3546-d37e-4708-b1f5-f583c741d245	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	ee951907-24db-487a-a174-b25a66ee6d1b	execution	Ready	ready	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
9b09efd9-a4b9-407b-a4ff-5f89c470ba36	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	ee951907-24db-487a-a174-b25a66ee6d1b	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
2848c07c-6361-462a-b938-d15878d67118	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	ee951907-24db-487a-a174-b25a66ee6d1b	execution	Completed	completed	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
dd018700-cb32-452c-a36b-f092138e8446	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
ed5a8563-0929-4c82-bc44-d33814fce6ec	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
7f92425f-d69d-486e-a0f5-c842191cf641	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
3a6a016f-2622-4968-ad26-ca2c98e38b0e	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
9c43d4be-a0c3-4623-bb25-7023b0bbec86	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
0aa428d1-abd2-44e6-b825-6fee3f6c2b30	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
fff670e4-835b-42b2-9f73-73288ca86a20	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
d63027f7-9e3e-4678-b6b3-9f06605640c5	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
47c0606b-376d-4844-a0b6-1547536d76d1	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
62439c6e-1eb9-40d2-90fa-05bba5b734a4	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
fb557bc1-e8db-4752-b94f-a80c92c79680	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
1eedc891-2ee2-4fd1-af63-81ce46c9dfcd	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
0ed5f360-e8e5-454c-a4f5-76e2e04368ea	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
0173dd51-68eb-433f-8125-8e2a646ca923	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
e9c51a36-c28e-4e06-ae43-0d8fd3eca870	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
2e990c08-4a03-4dbb-82ee-4b696559ca12	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
2af4dc65-ec8b-4da1-8bed-ef6670abe16c	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
52219da5-2aa8-4c22-a2eb-527a8c814fae	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
56277303-d3c5-41bd-b222-5e72b7f1a50d	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
db4d1cef-778b-4f37-9512-82af82f48070	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
4291aa59-d3df-4fff-a770-068374231cec	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
e3e8fda2-965f-411f-a242-f65cb3499acf	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
007993fb-6ce8-4e35-b57e-b3fb25c7960b	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
d938e638-4e35-426e-bb2d-b4394c53940e	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
57e2b0f5-eb57-456d-beb9-f2ec1c66bae7	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
11180e3e-0a62-4211-bb6d-e30623a4e622	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
397bd04b-3d77-49c9-81af-d6e694d6ab54	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
d7a86cc0-1a4f-4edd-bf15-10ed25bd2028	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
62af399a-3b75-476e-8e81-05ea15d91716	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
46751583-558a-48aa-ab9f-93d870fa359b	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	Accepted	accepted	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
efc790ef-1fd0-4d95-8c02-90a177b33d33	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
43b2ae2f-4168-43ef-9874-308b52c39c28	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
baa1309e-60e2-4b73-9efd-5393602d107a	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
06473d39-2735-415a-b84d-2fdb6fe56519	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
805374e2-2cef-4dbc-8094-5135b0364251	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	Accepted	accepted	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
cc53402b-bad8-42a3-a7ac-43ccf5c4a964	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
8c417fd1-ac40-4d51-a3a9-c1fd93e37cb1	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
4fb80428-9f65-4dbf-93dc-c8eb1fd5c1f3	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
ce4485c4-c11a-4145-a546-1f5e5af73f3e	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
c5641ebb-5a71-4a8d-8c90-ad41eaa681d9	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	Accepted	accepted	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
47c147e7-a6b5-494f-b99c-369be4b59bba	4fe02761-85c9-409a-9ea9-04c10f536394	4a53944b-543f-4396-b6ab-623f25b3b760	execution	Defined	defined	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
92ce5be3-7a31-4596-820a-a7f11e58b434	4fe02761-85c9-409a-9ea9-04c10f536394	4a53944b-543f-4396-b6ab-623f25b3b760	execution	Ready	ready	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
74433420-7fed-4449-ab91-5b904f014d38	4fe02761-85c9-409a-9ea9-04c10f536394	4a53944b-543f-4396-b6ab-623f25b3b760	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
dbe92876-bd78-43ca-8b38-b5cf135bf293	4fe02761-85c9-409a-9ea9-04c10f536394	4a53944b-543f-4396-b6ab-623f25b3b760	execution	Completed	completed	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
26cdc9f6-b052-4d0a-aa99-48d000ef7678	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
2ac5bfe9-bece-466d-a583-467d55d3abbc	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
88d2b800-7cbc-4aca-af9e-8f86d3788ea3	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
c14879cd-dc34-4779-9d3e-15414d5768c0	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
a6f37c71-15dd-40ac-a7db-3f0ac68fdc22	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
bb1ec0a5-09c4-4ffc-9075-401144908649	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
afccb340-92b7-4afc-9a5a-98f84ac3654b	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
d78dc0a1-e7f6-4638-a2f3-30922765a35d	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
27c55ba8-e8d5-4f5d-a884-477a884e8bdc	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
51ef3e87-b05d-4afd-b8fb-f741c6f3397a	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
a0366e7c-d809-4248-849d-21d594d27f89	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
eca79efc-b1db-4487-9eb3-f5d680d601f6	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
89421a90-5d48-49f4-89ea-54729fba2735	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
ac586d8a-ba98-4ace-8fa6-95118df33107	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
5aab72b4-e6a6-4046-a8e6-2d7c06609012	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
7585fac9-9064-4b4a-a4ff-3d1c72c65ee7	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
88bd0375-9263-443d-9e96-597bd7de90df	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
1843b824-4380-4616-9b57-05b8dec71f46	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
6ff3e2dc-5691-4b70-ab87-3ff83a89568f	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
c7d51a0a-c0f7-4070-835b-399185d9065e	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
c0a5ebe4-fb28-44f0-aa4b-b4755c96f693	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
23d6c326-24ed-498c-a336-00334119b0b5	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
c2abe9e1-2d9d-4ffa-a6ad-c404f87b051a	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
07ef86d1-874d-4feb-a96b-fd10c893cbf3	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
19870124-0346-4ae8-b575-8d93022e8647	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	Accepted	accepted	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
44276948-4aef-4cf1-8cb6-56e2e754d59a	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
0bcd2cb7-a3fa-4003-9bd5-e3657df04f01	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
4943af2b-0c84-4132-99ff-97782ae1494d	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
b729274c-1cf0-4b4b-aafd-cf3d595a536b	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
3d348a12-f261-40aa-b6e0-cca880a7b642	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	Accepted	accepted	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
f895d840-1fe9-4d45-96f3-3f1f76bbbe7d	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
accad4ec-229c-46f6-8504-951a6722bb61	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
9dce4f3c-9679-403a-917e-6c553fc082fe	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
7797a002-ada2-4193-8330-86d918f1edf0	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
f86b6c58-a954-4bfb-8ee6-5e99fae75c13	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	Accepted	accepted	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
d3b5e769-aae7-4301-b8ee-4cbf1bf1a083	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
eadcf2a3-a4ce-4033-bb95-ca5c6963112d	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
5f79b34c-bd71-4e35-9416-bfffd787337f	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
ba9082b5-a234-46b5-9ad1-3dab1c9fe6c4	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
09d809e6-8910-4116-acaf-82ca9dcb3045	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	Accepted	accepted	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
8ef7f025-30d4-4a15-90ac-a9332f47e019	1e2e4435-7c7b-4f13-898b-872f38a55ffd	e0ac39a8-e7d4-4d2a-8e6e-bb20db49943a	execution	Defined	defined	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
bac4ffb8-1164-4559-a34f-73adea517e8c	1e2e4435-7c7b-4f13-898b-872f38a55ffd	e0ac39a8-e7d4-4d2a-8e6e-bb20db49943a	execution	Ready	ready	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
b03971a4-80a4-4639-aabe-7f6641c5a852	1e2e4435-7c7b-4f13-898b-872f38a55ffd	e0ac39a8-e7d4-4d2a-8e6e-bb20db49943a	execution	In Progress	in_progress	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
b2919fc3-3979-4a40-967c-d32b11ce1cdd	1e2e4435-7c7b-4f13-898b-872f38a55ffd	e0ac39a8-e7d4-4d2a-8e6e-bb20db49943a	execution	Completed	completed	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
26f52f81-976a-4f80-89d1-9951fe220767	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
1f387a62-41de-4919-934d-53d404dfc8d5	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
9f27cd91-fb1e-4181-984b-ea11382ffe30	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
c7bad4f0-7461-46fc-9ad7-ed16eb84eed1	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
a619b4a8-ccfb-4d95-90eb-6becad5e95fa	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
c31d1e31-c5c3-4397-8678-1c82582acbe7	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
7a249901-b379-48d2-b8c4-652c6882594a	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
08cbd4e6-4271-470b-9f78-5e3ea5cdca64	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
360375a0-0cfb-4a3a-8c4c-b789441d5c9b	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
49f35c86-2563-4166-868b-81bf883bb4f6	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
73037da7-6c63-4922-94f2-eb19e28c58f8	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
a216625e-a93d-4d3e-b067-76768dd87a50	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
67e19e64-4d0e-4928-8ef6-775c0afb3c8c	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
a98a44fa-f75f-4bcf-a70f-0c3300a9f6ad	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
d6ec1b57-2412-4183-847e-97aec20a47a9	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
9a1a4560-8a83-4741-8936-cff382d469d0	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
f45077c1-5601-4124-955c-df9997f788bc	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
a696e5d4-d73d-46ff-9143-dc950bc349cf	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
5137dd26-836c-4c2a-8a58-5f0b43a68157	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
0d80c19e-e809-4432-b759-b086ecf6328f	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
fe8b2119-2c3f-4cc3-895a-5eea8d83aa1b	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
6367ba61-681e-4eec-8528-d12c61352bdd	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
40d80edc-a288-4af5-9008-8e7e4054db22	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
73868181-0dfb-4a3d-8b3b-aabf27be6bc4	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
7f7f51de-0120-4f43-941a-25d2500581fa	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
5b4924ad-faa1-4237-9e26-c64c5869d87e	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
b8b4e841-b123-409b-8963-30251235709f	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
b96189c1-33f3-4f00-aa9e-bd3b0c98fb9a	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
45295f59-7307-46e4-9106-e85053001516	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
b3ea16eb-1c99-4d06-b414-b35748a52ef6	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	Accepted	accepted	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
2d07fdcb-e30f-4ae9-9a37-396887cb4823	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
3cb9a4cb-d74c-4b40-bdc4-0e3494691e26	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
79bd165d-f076-4c80-a8d4-8b68203f57f0	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
613c8131-96e9-40d2-a673-f090a1f682fc	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
ac0b58e1-2d4f-48e5-81f8-ff3297487672	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	Accepted	accepted	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
b8b3fbab-af7b-44f9-bb18-c649ce692a6e	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
9c072d7e-3fbd-4794-a3f1-bff73c448ea2	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
4b6ebbad-1942-4df3-ab45-2c3253f342a6	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
deaf0e39-2e1f-4adf-9cb5-250a734834da	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
34c424fe-bd6c-496f-9891-783bce1a85f9	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	Accepted	accepted	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
2bbbfa24-2d02-4583-ac5f-85e1a58a9324	2372603a-5775-46f7-8335-43dcde0a2a07	be44b997-91f0-4253-b79f-94c4361abcd7	execution	Defined	defined	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
d779317d-4037-45f8-9288-cdaeea115769	2372603a-5775-46f7-8335-43dcde0a2a07	be44b997-91f0-4253-b79f-94c4361abcd7	execution	Ready	ready	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
b9f59dd1-e2e5-416e-8ed1-1fc4ead03239	2372603a-5775-46f7-8335-43dcde0a2a07	be44b997-91f0-4253-b79f-94c4361abcd7	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
a236a35c-ccdb-4823-87d8-00b9c3901a91	2372603a-5775-46f7-8335-43dcde0a2a07	be44b997-91f0-4253-b79f-94c4361abcd7	execution	Completed	completed	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
a6cf303f-5f40-4a23-a5fa-108b71219508	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
c6a56ce2-7574-40a8-be5b-55d867b0acb3	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
bae41b69-d42c-4cd7-9c0b-81be6ed70d87	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
49053485-b0f3-4948-9b6f-f16c5f232393	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
96c1144b-3b70-41e6-acae-644803d58da1	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
99b34858-b3d6-49f6-9e50-e9e3f66b7d71	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
529c112d-84fa-4827-aab7-f393f9eada63	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
cb6cd589-2ce9-4ec4-8543-5fcb1d435379	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
a52ffd61-4711-4171-aef0-eb5fb284be80	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
75a53914-87ae-494b-815e-0c86f70e6397	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
d873f114-6801-479b-b558-5859b82b63e8	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
c6091ea9-bd2c-4b14-85d6-e09f2b2447d5	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
c4441cd9-6411-48a7-b5bb-56815a1a2640	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
5dbcbc88-4ff7-422d-9cc3-f675b55e8097	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
fecca3e5-fbcb-4147-92cc-d6468b23b135	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
511f600f-dca1-4356-9a1a-239f3363eff0	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
fb524beb-444d-4754-bce2-fb53c326ae88	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
39e0a89f-a693-48cc-ae5a-528ca271db13	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
5f9cfbef-f9d0-41de-8eed-cfd2e62cbea0	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
fc0ca3e6-7413-419a-b3f1-6b68f7df14a9	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
1c6bee71-572b-405c-b4b2-ac7a0025d9a9	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
4e3de2fd-a80f-4c2d-967a-2d0232298e29	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
1cfc8249-da7d-4fad-b937-a776445512e8	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
e0b42571-53c2-449c-9079-8c7d94f6a29c	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
54bb81c7-38e7-413b-9587-742b6e9dc18a	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
01779125-bac1-4809-8575-6ed47e0358c9	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
12eafef9-949f-4b53-8266-839d99e4b498	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
3c1fe9b4-7cc4-4c24-90a6-01e73302ab05	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
a7252490-ce0a-403b-9b23-15c791ea44a0	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
8e95f6a0-111f-4ee8-ba58-8db753b53241	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	Accepted	accepted	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
3942b380-7b45-40f5-adbc-8a4f07b64d88	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
317e32cc-385d-4836-a156-03b6653da0b0	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
7dc20b22-8539-4e53-adbe-2c5ee0abbc42	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
dcd0de90-6b41-4617-8f40-f0a5fe1e8f64	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
f316b5a3-4c6d-42b2-a7dd-66160649b956	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	Accepted	accepted	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
29962df7-8f69-4b89-a901-e1c890a75aad	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
f9c8fa41-ed99-496a-b0e1-391e63a3e54c	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
efa854a1-73b2-425e-92d3-255784c83be1	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
739b22f1-122b-49ad-a53d-8e72b3c4fddd	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
983c527a-9ace-4c07-a634-3bf4e8f56d3d	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	Accepted	accepted	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
0e32c726-e36f-4c95-85ff-28342e8fcc02	96c676b2-8388-49bd-8fc1-e4adba6e8831	1b4adcb8-72a6-473d-bd46-26ad1eaa9991	execution	Defined	defined	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
6bd892b9-15a2-48b5-9b93-3450a49dd0bb	96c676b2-8388-49bd-8fc1-e4adba6e8831	1b4adcb8-72a6-473d-bd46-26ad1eaa9991	execution	Ready	ready	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
3d5f64fd-ad85-4d7e-a98c-2aedbc2c23b9	96c676b2-8388-49bd-8fc1-e4adba6e8831	1b4adcb8-72a6-473d-bd46-26ad1eaa9991	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
1828a399-b0ce-4ce1-8b4d-38a3432429d8	96c676b2-8388-49bd-8fc1-e4adba6e8831	1b4adcb8-72a6-473d-bd46-26ad1eaa9991	execution	Completed	completed	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
254c16ce-9f7c-453f-b0a1-14724d587c49	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
f48a18a2-d2c9-47f7-8538-f54e88bbbad4	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
693a9fcf-5bde-44fb-af44-badf6136e99c	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
b4d86c71-e716-429e-91ec-0e9ba1e2e370	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
345529be-93ae-430e-b770-d2adfb7a3932	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
061d2643-0738-4942-b488-75e8aa41100c	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
fce236cf-1bb2-4663-a658-5fbcbb14f302	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
112b84a1-d18b-4494-98cf-66f49a1867d4	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
3bf93654-c2ab-4d60-8815-b3c7415f0f68	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
e39832fd-eac0-4335-a81f-b85ce6d79c61	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
a010372b-5b70-4b27-907e-fdd652f5bb1c	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
268b689d-3d35-4424-9ba2-4e7b66c05e80	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
8940b26e-a7de-4e47-a274-1e3d30fda6a5	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
31e3f0cc-33ba-43c7-8d16-db557a927cc2	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
4da66aea-1662-40f8-bcba-e55ce796f624	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
d83bf882-69fe-44b6-bd70-e0b1781263f2	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
b148b322-63f3-4721-ab3b-85c76199f2d0	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
600f1a7f-29cd-4898-89b7-f1ad9caa534c	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
e1bbbeaa-9462-4645-95bb-880a38cfdd4b	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
fe924a31-622c-4835-a4ea-2a590e9b743e	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
f4936f46-5606-4cf7-bae4-33273f525443	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
f1d38220-6e5e-4f33-8c82-34edb57e6786	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
077e31ec-a36d-45c2-bb41-f7389efb4aa9	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
e0a2ed6c-4dea-449c-b8ae-1fd1ff0d8866	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
8277eb57-98b8-427e-8e8b-5720a69e87ad	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	Accepted	accepted	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
2df8005f-75aa-4b1d-a651-df705027dece	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
bd6b18a9-70d2-48a1-a6b8-7f9d38007b12	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
0f05f826-25c6-4408-bf58-b96e357b27a9	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
bb5e1807-d7db-4104-84a7-3ad1981bd4a1	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
70eb0e99-7c3e-4451-afbc-2ccb83a9b9a7	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	Accepted	accepted	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
a24055f0-a51d-4e31-b546-4fc9bdc43242	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
4f59af44-95cf-4651-9c27-7ec7f2b2cf27	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
ed0d87c6-1059-4735-b901-d5893799f698	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
88d65631-d711-4bc0-addc-bc213df9e3b5	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
f32e6c83-8792-429f-9226-f77811a5ca6c	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	Accepted	accepted	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
8614198a-045f-4457-9c46-6731eeb802de	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
0c424889-699a-470e-b17c-56ef831c943a	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
b1b4a9db-a32b-4452-8672-1cde3c67d275	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
bb47f48c-d803-4288-aae9-7bd365b7fcfa	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
a78d2e45-ae53-45a8-b920-e8a2320bd6cb	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	Accepted	accepted	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
e77e898b-cde4-4fdc-a749-d76908ecb51a	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
2c156a06-6253-47d4-819a-2317f8f24354	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
8d864134-e829-4ef1-8d89-1dca7f989586	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
0d7226c0-3f94-4848-b4b0-88d8318b3d91	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
1d5c5727-16d8-4f83-97bb-d5a5cdf04270	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
b262aa61-900d-4722-a25f-fe35ceb2fb22	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
82c3e3d0-dd05-4ef5-a991-e512d7c165a5	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
4c6b8cca-d99a-4445-80e3-817cf8f23e5d	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
c6920e75-e7a2-4f0d-a926-7407f59ac993	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
259f0cc8-a578-46c2-8eb2-bfcbbf083eef	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
4c14bd77-a66a-49f4-8714-27b261e87290	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
47baeea1-781b-47a5-ba1f-b88dc13ddeee	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
1c5f85c0-3e7a-47ea-91a8-f7ea7e1eef5b	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
b7e84795-578f-40eb-a997-1127ac999dbe	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
69537d2b-cfca-4ace-ba1d-e36773224a88	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
296f7c68-c500-4ad8-b8b4-3133508f97a6	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
95f2ecb4-349a-4962-938e-37866d1e0510	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
1b342be9-39df-498a-8730-f914143a8a0b	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
09dbc207-b5ad-483a-bc93-2f9d327a8273	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
50634c87-406c-442b-bc0c-e03a7bad80a6	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
20aaa234-a2e7-42c1-a2be-fb54b20adeff	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
241163f8-dd34-4a2f-9861-70419d4625e4	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
512f26be-2722-4203-ac12-f55213785e5d	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
0212e464-7f3b-4eeb-ae4b-8353a7b4dfb4	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
7a807c44-f3a4-4016-ac2a-ab4a1bab05ea	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
58ff79e8-f6b8-4073-ad92-535b904d9898	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
63858b25-54ed-4ad7-9cca-cd864ecc0644	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
53082fd4-cc69-4a81-b921-d7496680d146	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
029298ed-0b29-4bc5-b2ee-38af5335170f	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
a2632047-8a1b-4976-8782-f831e4e80450	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	Accepted	accepted	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
50944fb9-d96d-4ecd-b6dc-37e47d586076	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
8997a5c8-5bc9-410d-91e7-b02a097d7a96	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
a0191457-7714-4481-a181-30edd3ea17ee	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
c84a3ea3-7305-428c-9c64-78a8d185f6ca	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
8c77c412-10e4-4582-ba6e-250799435c9e	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	Accepted	accepted	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
d4569602-554d-4e6c-b09f-bbfd2fe254ac	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
f59483ac-e7c7-4b66-8f8b-30f069e892f0	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
e3edec4b-4b60-41fe-8ab2-7506236dac3d	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
f4c405db-39db-481c-8787-345d6f473e76	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
8352ccbb-b18f-4f63-a81b-6f1f779f2b15	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	Accepted	accepted	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
44db02bb-aba4-4996-b2f0-b8353368c068	10cc89f7-0092-4267-9b90-0bce22d1edab	c5ce4402-e020-49a1-971a-a6a1c41e606d	execution	Defined	defined	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
0196769d-911b-4242-8cfe-3ca5e9bc6010	10cc89f7-0092-4267-9b90-0bce22d1edab	c5ce4402-e020-49a1-971a-a6a1c41e606d	execution	Ready	ready	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
2aba91e2-5e50-4e71-80f9-119d28978c0e	10cc89f7-0092-4267-9b90-0bce22d1edab	c5ce4402-e020-49a1-971a-a6a1c41e606d	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
973a3d8f-4a48-49fa-adb7-b4c69aea461f	10cc89f7-0092-4267-9b90-0bce22d1edab	c5ce4402-e020-49a1-971a-a6a1c41e606d	execution	Completed	completed	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
fad01d20-c726-424b-abe0-417b7c416808	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
d1a9217f-af95-47fe-b5c2-ffbd3bfe21fd	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
8e8b1b59-7da9-45d1-9655-fe201d291ce6	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
c01c14e1-321f-4d8b-a277-bd8ce9af8041	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
e033914c-a034-447c-a5fb-21fac645737f	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
f806ccec-32b1-455c-9c70-bd6c9a206484	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
ff77b8eb-4ef7-486b-8eaf-b9f2ed15be17	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
2bccf1c0-2fe3-46bd-b1fc-5210dd202b78	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
417611cd-63af-47e4-9aae-b698c745a446	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
8dace650-3564-426a-ba69-ec60c3cd0560	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
43486973-0930-4bbb-ad16-b210b4166495	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
7f892bf3-58df-46a7-a5f0-668652b702a1	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
535bf44f-cd63-44dd-9a32-c55c97382995	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
f0ad5a9d-2a8b-4e6b-8c9f-5faef40b7f3c	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
cbad8aee-f829-4c57-bcfc-ebf1c6b08ff0	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
64d4e218-0cc3-4ca4-b7de-344950563e23	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
5e6a5da6-3e31-4a91-823e-dc8ec72fc0a1	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
45ce9b40-5349-42b8-911d-3d6195b4c4ec	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
bc76c6b6-526c-4bc3-aa48-e821e26a6918	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
fd6ffee9-eccf-41d8-af5e-ac8f7264588c	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
5b5fdfd2-5100-46ec-a1c3-c7752a83d6a2	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
e2750c56-5076-4339-8e2e-618bd51c76fc	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
02df3f8b-8119-4ceb-b0ac-d388abfb006c	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
8d5a18ea-2048-4893-b774-6e47ffafd205	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
b253bdb2-edbb-4d7f-9493-bac9c2b99139	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
05487a8a-9ee5-4a53-9cba-538a48a419c5	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
cb724dc3-fb0f-4fd1-b037-0eb6fbe1e3e7	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
c4142bb5-8b81-49a3-b3fd-c32b2c116867	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
a1420fcd-8253-4444-af58-45bc1f22057c	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
b62b68bd-5a3a-45d1-a080-1499aab9fc21	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	Accepted	accepted	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
47fb0387-b56f-4bd4-9ff1-d7bf79d01a19	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
fd24b950-3ee0-423a-85f4-270ed50d5c61	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
906f837e-af48-4cb9-84a3-7911973d0f9b	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
63a1aef8-4d3b-41e4-8df6-0410066206d9	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
bbeca720-3169-40e9-84f3-c4c9f87c7099	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	Accepted	accepted	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
7811e9d3-187a-4cfd-8289-e5403c7565ea	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
03a4c4f1-22f7-4db1-809a-66c411175b94	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
e2bbfcbd-8be7-4860-9e4b-dfed0e2e6813	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
69c589fe-03ea-4107-8e9f-3dfe0cc9a872	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
87887ed8-dae6-40b0-be84-0d1f52c1d841	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	Accepted	accepted	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
627902b1-b4be-49a2-ba43-daba1cbc05e7	f936845a-e36a-459b-9b4b-dd5bddf1443e	fae18c8f-5591-4bcf-9870-b83bb30f9fcf	execution	Defined	defined	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
b359a71c-5b2b-439c-ac8c-524cd7e8379d	f936845a-e36a-459b-9b4b-dd5bddf1443e	fae18c8f-5591-4bcf-9870-b83bb30f9fcf	execution	Ready	ready	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
40be9a04-335c-456e-8f82-94d291922c54	f936845a-e36a-459b-9b4b-dd5bddf1443e	fae18c8f-5591-4bcf-9870-b83bb30f9fcf	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
f96a673f-16a7-43ea-b8e9-8102e892fd00	f936845a-e36a-459b-9b4b-dd5bddf1443e	fae18c8f-5591-4bcf-9870-b83bb30f9fcf	execution	Completed	completed	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
14267eef-1023-41c8-b942-6095d09eded9	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0550d826-98bc-418a-b20f-04970468c94b	execution	Defined	defined	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
73ace40a-2414-44aa-b5bd-403f41257121	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0550d826-98bc-418a-b20f-04970468c94b	execution	Ready	ready	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
075c12ee-ac82-4e97-92da-304f86f8a683	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0550d826-98bc-418a-b20f-04970468c94b	execution	In Progress	in_progress	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
96360f57-660c-4cb6-9cdd-8328b0977cfa	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0550d826-98bc-418a-b20f-04970468c94b	execution	Completed	completed	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
d5461ed3-bceb-4180-8c8e-5177007789eb	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
8bb272c0-beea-4e35-9f52-fb5c369a943e	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
dc06e71e-0ac5-4d6e-851b-31d7eb757536	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
1171abb9-d241-4c72-a2d3-3fca6167dbd4	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
054289ef-1397-43c9-ae5d-26072b5607c7	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
f1ca64ff-36f4-429d-87ed-53e59ce7e901	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
a2376e3b-198a-4eb4-8bae-53c301d51b79	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
0a73aa35-a41c-4ad0-b32f-4a7a91c4cb39	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
49027125-0b3a-481f-903b-efcb7f2987b5	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
b9138d13-976f-44a9-aa81-5a0b12c89e4d	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
7f3b2b63-77a6-42f7-847f-4044c1b76124	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
62bb7ba6-2dc3-4a40-bd78-f47fe20c03e4	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
7d355502-ce6b-4987-98f0-8a9cc6f17ffc	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
9a515123-b4df-4184-917f-654c0282ee9c	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
40782239-cbac-42e6-b0ad-c90d51f5daf2	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
1e6880a4-3cb3-4452-bd44-286e3a540ad0	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
c484d716-c642-4ce1-96b8-b2d4ce96a465	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
54013294-dd0c-4e10-b9f1-0d56ee034eb6	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
15cf8ab8-bc7c-4af6-bd60-ba4bfaa94765	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
f665a8ba-207a-4f6c-9481-70a88160df75	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
280fdafc-c848-4296-8a67-20d3cb8fb060	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
3a0b8dc6-7c00-42ea-8585-ab2574320bda	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
542de25a-ba66-4bc1-aadf-8de7099ac746	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
912d62bf-0897-4f7c-87e9-d1491e7d5992	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
eff6b727-ed71-4a3f-8792-57dac7757650	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	Accepted	accepted	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
f115e3cd-8894-4035-bd74-a9e85ac1bf26	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
2428aeef-0519-405a-bc9d-46b91b91c19e	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
38ec77fc-061c-49ce-898a-8467e7850283	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
072e124c-b555-4e29-a3d8-59ea4a1d4668	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
46ee089f-ef14-472a-8644-014ac8d5b334	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	Accepted	accepted	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
332b2b3e-8c51-4ef0-92b7-bcab6c159e6e	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
7aea7667-b8c9-4aca-8d2b-1d8c34391fa4	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
0f99e724-b167-4980-89ac-1efd5d174ede	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
62a9f51c-f7bb-48d7-b18a-1172f7a78392	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
b49339aa-f3df-4194-ba23-ae6af81111ee	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	Accepted	accepted	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
7d5fd112-e056-4959-9d76-174eddaa15df	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
f8081ceb-f176-4bff-b1c7-b610e06db65c	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
672bcef2-f6ed-4b2f-b3ef-e70e73dac4d8	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
6873e2e8-b39d-4db5-92d3-5ee493103e5c	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
c88da2f8-5c16-4e8c-87f4-376cbe5e30d6	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	Accepted	accepted	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
9d315137-cdcd-4c3b-9c38-bd9efe6a8442	876093ad-808b-47be-ae6c-e6705d7e57b1	7ee9afa4-8321-4e4b-a541-678742524dfe	execution	Defined	defined	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
da04813b-dbff-4e7d-a30b-aac3e46acf9c	876093ad-808b-47be-ae6c-e6705d7e57b1	7ee9afa4-8321-4e4b-a541-678742524dfe	execution	Ready	ready	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
13641cc5-ed5f-4365-883f-1a9282e02b3f	876093ad-808b-47be-ae6c-e6705d7e57b1	7ee9afa4-8321-4e4b-a541-678742524dfe	execution	In Progress	in_progress	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
0a2a9bb6-da21-4283-bb56-82163b5ded41	876093ad-808b-47be-ae6c-e6705d7e57b1	7ee9afa4-8321-4e4b-a541-678742524dfe	execution	Completed	completed	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
\.


--
-- Data for Name: item_type_transition_edges; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.item_type_transition_edges (id, subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id, created_at) FROM stdin;
eb7d7687-5659-48d4-9264-ba0ee43f5e9a	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	e8b8465d-0b92-4735-9650-2a04e43ac885	0551e6ec-cac5-4cbd-8903-5d0156ed4314	2026-04-21 05:46:22.307829+00
9cd4ec74-f056-4c91-8f92-fd6fcb96ec28	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	0551e6ec-cac5-4cbd-8903-5d0156ed4314	daf9fa1f-6888-4039-be0c-c9924878c90b	2026-04-21 05:46:22.307829+00
61407a4a-faa9-4773-9403-65ffc5cf818b	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	daf9fa1f-6888-4039-be0c-c9924878c90b	0ff7041f-7599-4d1e-bd02-ebe02f0e17ad	2026-04-21 05:46:22.307829+00
adae55c5-e2f3-479a-9b5b-ac316de0170e	00000000-0000-0000-0000-000000000001	a9f9df9b-bc5b-414b-a87c-b96169c41ee2	portfolio	0ff7041f-7599-4d1e-bd02-ebe02f0e17ad	3e373a77-ca50-4d7c-bca1-b545e58e611e	2026-04-21 05:46:22.307829+00
8644d758-6c63-437f-8597-5191a38917d7	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	f940d727-11e8-4252-b3c0-72a3b234fdce	e4729f28-6d08-420c-95e6-02439189f930	2026-04-21 05:46:22.307829+00
f428f02b-2584-4da0-8de5-4aa2ac370d69	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	e4729f28-6d08-420c-95e6-02439189f930	817c86c0-79e2-435c-b48d-de70d9e1e2c8	2026-04-21 05:46:22.307829+00
876e1ad4-0816-4252-ad30-c5c96ededb86	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	817c86c0-79e2-435c-b48d-de70d9e1e2c8	12f91dfc-f5db-4883-aa69-7fb35ae66c68	2026-04-21 05:46:22.307829+00
3c127892-08fe-4dd1-afa3-bfefec2e4740	00000000-0000-0000-0000-000000000001	00eedd40-baf4-4e4c-8085-9ef139f4cf35	portfolio	12f91dfc-f5db-4883-aa69-7fb35ae66c68	da374349-d8a5-4336-8249-fbabc3bbc771	2026-04-21 05:46:22.307829+00
e6ef12c7-49c9-4af4-8361-b200f4c7ba52	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	34d8a847-deef-4971-8d8a-b6c67d1f245b	d62b2925-19e7-4880-9c95-c952a2ec6fb9	2026-04-21 05:46:22.307829+00
bf06e17f-1e9d-4161-90af-f9d73dd36620	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	d62b2925-19e7-4880-9c95-c952a2ec6fb9	a293d338-15cc-47d2-9058-4d33ff8c7b83	2026-04-21 05:46:22.307829+00
29a4683e-628c-49b8-b1b6-fd7176f7ea2c	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	a293d338-15cc-47d2-9058-4d33ff8c7b83	f9af4ee3-4b90-4a35-af5b-8c598b9ad747	2026-04-21 05:46:22.307829+00
a0dd509b-4af8-4e80-ad82-e18bd46b338d	00000000-0000-0000-0000-000000000001	68280f5c-d607-4443-9add-2d3ffead80e3	portfolio	f9af4ee3-4b90-4a35-af5b-8c598b9ad747	afd6bf43-dad0-4e08-8eb5-6d75556f12d7	2026-04-21 05:46:22.307829+00
6c62bf82-2356-45be-8b69-f7484d81c34f	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	319f3a10-b805-4626-a0c7-e45e08d55781	c2a7610c-bb21-4e65-9d30-31b67770eb95	2026-04-21 05:46:22.307829+00
d98c3462-c491-458e-ba28-bb905785900a	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	c2a7610c-bb21-4e65-9d30-31b67770eb95	817ac1f2-3567-45cb-854c-a0e32a86c2f3	2026-04-21 05:46:22.307829+00
c479ba3e-fe7f-402c-ac20-37b01ed66892	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	817ac1f2-3567-45cb-854c-a0e32a86c2f3	7cf96223-a6ea-4081-bef9-79f57c064169	2026-04-21 05:46:22.307829+00
bf4792f9-413f-4a04-9638-ef5d3e4c75de	00000000-0000-0000-0000-000000000001	9bdfc74f-517e-4704-84a0-083c230b22ec	portfolio	7cf96223-a6ea-4081-bef9-79f57c064169	0ea00386-61bc-43a4-b9a8-d0f2cba91925	2026-04-21 05:46:22.307829+00
cc0a8f8f-f067-45d3-9caf-5a551f0e1b0e	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	16777e6e-c171-4b20-af4a-635c18f4a9c5	7aa07929-eea9-4273-bcad-b34b4115d7c1	2026-04-21 05:46:22.307829+00
33f84fbd-2579-4ee9-981c-55b7be2d9f3f	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	7aa07929-eea9-4273-bcad-b34b4115d7c1	6c5bfc58-bfd1-4604-9be6-0a31a6373c0d	2026-04-21 05:46:22.307829+00
2e0c90ac-9822-4e88-82e2-b166caa94e34	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	6c5bfc58-bfd1-4604-9be6-0a31a6373c0d	00085ea7-eab6-45af-90ae-b9d8eb629252	2026-04-21 05:46:22.307829+00
dcc766ba-e78b-4913-b1e7-70a6e3b9e849	00000000-0000-0000-0000-000000000001	feb72662-32e9-495c-b18b-7a2827fdb854	portfolio	00085ea7-eab6-45af-90ae-b9d8eb629252	20a3e437-cc19-4918-b6fe-e06658448cd0	2026-04-21 05:46:22.307829+00
73b85783-a92f-4258-94ea-87e45953400c	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	99dcf0dd-e08b-461f-bfa3-aa13133e40a6	7ba929de-8bad-4c81-8bb9-9ef6e8c8b635	2026-04-21 05:46:22.307829+00
e49dfc57-bc4c-4ba9-b64d-9f2613d840ef	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	7ba929de-8bad-4c81-8bb9-9ef6e8c8b635	97d0b3fc-95e5-4499-998c-137b3e074e53	2026-04-21 05:46:22.307829+00
7ad1f507-8074-4a13-9ca0-3c802fac80d2	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	97d0b3fc-95e5-4499-998c-137b3e074e53	99cb2d14-e8cd-4169-b2d1-db849fe2c3d1	2026-04-21 05:46:22.307829+00
c0519c2d-f7fd-43bb-8204-087c4e42419b	00000000-0000-0000-0000-000000000001	82701430-7f77-4833-98bc-4bc578bab616	execution	99cb2d14-e8cd-4169-b2d1-db849fe2c3d1	0ac6626a-52a0-46fa-9d5f-b5b380a8a172	2026-04-21 05:46:22.307829+00
f731227f-42a5-40c5-8802-d217b8fd3477	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	87fd8b0a-0756-47da-bd48-73daba3b25d4	d2f92d64-63e3-474b-a074-ac7787427c76	2026-04-21 05:46:22.307829+00
1181c0ee-0cfa-42fc-9159-55d9ca59ea22	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	d2f92d64-63e3-474b-a074-ac7787427c76	f0a42288-1d27-4a5f-93a2-68e2e4f69c0a	2026-04-21 05:46:22.307829+00
4b8b41c1-3bfa-435f-b226-2547843c185b	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	f0a42288-1d27-4a5f-93a2-68e2e4f69c0a	39bfb69d-796e-4d01-9f30-f6fe66366928	2026-04-21 05:46:22.307829+00
80cec14e-846e-4abd-9b27-4fb18f593510	00000000-0000-0000-0000-000000000001	8ab11490-6f0d-461e-a8fe-ad43390152b6	execution	39bfb69d-796e-4d01-9f30-f6fe66366928	b0036b57-1074-448b-81cf-4d8a16e0c1b2	2026-04-21 05:46:22.307829+00
cf4b5ca6-d47c-4b02-ab8a-63ec607d4c7b	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	772f0cb5-fd86-44b7-af59-2a67c92207aa	d577d27c-9f05-4bd1-93a8-d50aedd00f18	2026-04-21 05:46:22.307829+00
3713de5b-6282-4601-9e42-55f565473593	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	d577d27c-9f05-4bd1-93a8-d50aedd00f18	38812b8e-9898-424c-8067-94977d3f8ae9	2026-04-21 05:46:22.307829+00
b56cb77f-010b-402a-98f1-45d6c840ece2	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	38812b8e-9898-424c-8067-94977d3f8ae9	0456010f-61c3-462d-a9df-c318a8b3c36f	2026-04-21 05:46:22.307829+00
d66f3765-0a23-473a-8e45-e6a15e7c01f5	00000000-0000-0000-0000-000000000001	0de25c15-ca6f-4dd3-9a8c-ce646e2f5216	execution	0456010f-61c3-462d-a9df-c318a8b3c36f	059273fb-e6d0-42c6-a2f6-ce3e66c3bc48	2026-04-21 05:46:22.307829+00
336867c2-0fcf-4fb1-85d9-c5cb474135b3	00000000-0000-0000-0000-000000000001	d681e126-6c40-4967-9fb9-8d9e7f0fd139	execution	7a57993a-0095-4d97-9ccb-100a0b60d320	106451c0-09bc-433c-b54c-7d3dcdc106ef	2026-04-21 05:46:22.307829+00
d99670e3-1ceb-4584-b337-f3f192818630	00000000-0000-0000-0000-000000000001	d681e126-6c40-4967-9fb9-8d9e7f0fd139	execution	106451c0-09bc-433c-b54c-7d3dcdc106ef	64b3e20a-66e1-4095-8513-a8f5f2d38140	2026-04-21 05:46:22.307829+00
35114d5b-c64b-473a-8467-4464110b2b5d	00000000-0000-0000-0000-000000000001	d681e126-6c40-4967-9fb9-8d9e7f0fd139	execution	64b3e20a-66e1-4095-8513-a8f5f2d38140	8678d9e1-ed44-47bb-9bc2-580db242ff87	2026-04-21 05:46:22.307829+00
bd7382f2-fb7d-4334-b1f3-c838ad64b043	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	d6c65247-4395-4801-b3b1-8ce046f44acf	da3c8e90-ac69-4ea5-a0e6-88b9f5ac5d0c	2026-04-23 06:17:04.167639+00
5bdea479-1e32-4ac6-bb56-ac1c960c34d4	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	da3c8e90-ac69-4ea5-a0e6-88b9f5ac5d0c	67486125-44fd-4a80-9147-9a59fca33378	2026-04-23 06:17:04.167639+00
4283a7f4-6a7c-4892-bef0-6de6813404cc	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	67486125-44fd-4a80-9147-9a59fca33378	7f3b99c2-ccf4-4ea6-83ea-3daadaf16dd6	2026-04-23 06:17:04.167639+00
45c51f1f-c81d-4a16-a037-5360d783a4ed	231c3275-4a6f-4589-af4b-1ac863e41f5a	7373de20-cb84-48c9-8f72-52d2597571fc	portfolio	7f3b99c2-ccf4-4ea6-83ea-3daadaf16dd6	95aa0090-0592-4fe9-a0ee-ccb3797ae82a	2026-04-23 06:17:04.167639+00
f72a0824-55a8-4306-bb16-83ff5d94f8bb	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	3c39e4d1-1417-4bc1-b68e-b5a75f021095	9995e476-7968-4cf7-a89d-d98cff609afa	2026-04-23 06:17:04.167639+00
0e89ec2b-c82b-4923-acca-df0645c28c3e	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	9995e476-7968-4cf7-a89d-d98cff609afa	f27cb2a6-baae-4811-9acc-98947b0a39e2	2026-04-23 06:17:04.167639+00
9881c94f-1e0f-4a88-81da-4e450e6aabe6	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	f27cb2a6-baae-4811-9acc-98947b0a39e2	266dda6a-988a-461c-b8bd-ce9cb1bfb948	2026-04-23 06:17:04.167639+00
cf9d0c60-445e-4840-aeef-fd620f542c64	231c3275-4a6f-4589-af4b-1ac863e41f5a	819aa802-956d-4bba-90ef-1aa097aa2c48	portfolio	266dda6a-988a-461c-b8bd-ce9cb1bfb948	15b14e55-32d7-422c-9d71-fbc87dbe9ec3	2026-04-23 06:17:04.167639+00
566fb195-cbf1-4f32-9043-fb5a81479f61	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	28a4b2b1-673c-4559-be75-02310beefe41	994e6bde-9c5a-4e7a-816b-5960c6cda320	2026-04-23 06:17:04.167639+00
aad24aeb-542a-40b5-ac11-a0f1196d3a97	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	994e6bde-9c5a-4e7a-816b-5960c6cda320	ea3ddbad-2159-4817-bbcc-c9a4340edd4c	2026-04-23 06:17:04.167639+00
95743271-1e2c-4b76-8922-6d8dd7aa8c8b	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	ea3ddbad-2159-4817-bbcc-c9a4340edd4c	3f52d7ea-60be-4fb4-9002-1ab2d19bb6bf	2026-04-23 06:17:04.167639+00
76be1a07-548d-46d4-85b4-df4f3190084d	231c3275-4a6f-4589-af4b-1ac863e41f5a	e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	portfolio	3f52d7ea-60be-4fb4-9002-1ab2d19bb6bf	3063a29a-36b5-414b-938f-6a209cbcbc05	2026-04-23 06:17:04.167639+00
42ca6646-6364-476c-a6cf-62cacdc000a2	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	47d143f5-f796-4b2e-9390-76535dea7760	c3fa9610-60ab-46c9-b6a1-5e5a947dda67	2026-04-23 06:17:04.167639+00
bf19d671-952f-423d-8f28-2b2232e396b5	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	c3fa9610-60ab-46c9-b6a1-5e5a947dda67	173f84df-7108-44a2-aa4d-bad00befd911	2026-04-23 06:17:04.167639+00
0a1d86f2-339e-4c59-b8d6-f267e825d699	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	173f84df-7108-44a2-aa4d-bad00befd911	53105822-e633-4537-b5a5-d2323816f416	2026-04-23 06:17:04.167639+00
8aa8e8b4-90e2-4211-8097-75a7973c0a67	231c3275-4a6f-4589-af4b-1ac863e41f5a	7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	portfolio	53105822-e633-4537-b5a5-d2323816f416	8dceb46a-c7da-462c-b807-e1d6928bcaa2	2026-04-23 06:17:04.167639+00
66e5898f-b502-44e1-9a20-e75e7b95892b	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	e721a189-dca7-4cfc-838e-32ac72355fd1	3c23f274-d0ad-4f66-8dcf-d5d6044383de	2026-04-23 06:17:04.167639+00
531c9e99-2ace-45ba-b279-a76b51c949c5	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	3c23f274-d0ad-4f66-8dcf-d5d6044383de	93ca7128-45b8-42ec-8140-116a3b061cd1	2026-04-23 06:17:04.167639+00
e70fd304-414e-41a4-bd9d-b4083f163cdd	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	93ca7128-45b8-42ec-8140-116a3b061cd1	ae64a562-9937-4e38-b093-7fcc71a7d5f4	2026-04-23 06:17:04.167639+00
6145dee4-8a08-4b46-8caf-702a7b935312	231c3275-4a6f-4589-af4b-1ac863e41f5a	906dec47-da6c-4b3f-b1c5-c6673f25099d	portfolio	ae64a562-9937-4e38-b093-7fcc71a7d5f4	6c13f81d-9b94-47c0-a676-4471d19dd3c2	2026-04-23 06:17:04.167639+00
d572842b-7650-4d6a-9429-f43c8142d4fb	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	ccf9867f-20d2-4f5d-8e9b-dbb98fd54889	83ed4722-ee6f-46b0-bfeb-d8d97dbda61c	2026-04-23 06:17:04.167639+00
777336c1-296b-4e2b-b33f-774a4ae7e1f5	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	83ed4722-ee6f-46b0-bfeb-d8d97dbda61c	e4d07e14-5164-417c-89a0-87c468b76752	2026-04-23 06:17:04.167639+00
935150de-cda2-4ca9-9e2d-c0febe9294e0	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	e4d07e14-5164-417c-89a0-87c468b76752	a4e43fcd-374f-4138-8b72-7e6b2a3aaf48	2026-04-23 06:17:04.167639+00
1081296c-4a10-4a43-83dc-7cefaa334ea7	231c3275-4a6f-4589-af4b-1ac863e41f5a	572b031c-e729-4a70-ad70-20742c4b5300	execution	a4e43fcd-374f-4138-8b72-7e6b2a3aaf48	df3b5d57-1a5e-40b5-98da-186871d82b35	2026-04-23 06:17:04.167639+00
af3a34f4-dd6f-4a1c-a999-7dddd2b63da2	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	89359bde-1b04-4d9b-9e7c-acf76b7a9ef3	55b285d9-b77d-4756-936d-5d275fcc922a	2026-04-23 06:17:04.167639+00
3c27972a-6072-4d27-bbba-89fd1c5d5215	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	55b285d9-b77d-4756-936d-5d275fcc922a	f76ca66c-85f6-4e90-9021-5723c73cbc04	2026-04-23 06:17:04.167639+00
764cd26f-3405-4991-81a5-ae7f96fad457	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	f76ca66c-85f6-4e90-9021-5723c73cbc04	9be236d6-7d3f-490b-bac0-b234536da878	2026-04-23 06:17:04.167639+00
de4b6677-f748-457c-bdb5-6612a9d87c0f	231c3275-4a6f-4589-af4b-1ac863e41f5a	40621304-899c-407c-8f1e-51b0b5d6c6b9	execution	9be236d6-7d3f-490b-bac0-b234536da878	6d281f2c-361c-4ced-a60c-a5f9e5dd1562	2026-04-23 06:17:04.167639+00
b87e7960-f168-487f-9d49-1dd7a489559f	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	9417c210-7b56-49b2-ae55-d629136ec05e	1a95daf2-5a6b-44fb-bd78-d8a2975c9a14	2026-04-23 06:17:04.167639+00
764979d8-d835-4d04-bdb2-b409e51f3a20	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	1a95daf2-5a6b-44fb-bd78-d8a2975c9a14	324198a6-a622-497b-a17a-dd040b5387e0	2026-04-23 06:17:04.167639+00
9d81afac-fe82-4ed5-b0f2-2ce0adb7212c	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	324198a6-a622-497b-a17a-dd040b5387e0	7f59eb1d-a373-4429-9ae5-c56883577619	2026-04-23 06:17:04.167639+00
8dbcbde0-97a9-47f5-a564-c0ed924409fd	231c3275-4a6f-4589-af4b-1ac863e41f5a	1060b101-aa02-46bb-819d-3fec272b903f	execution	7f59eb1d-a373-4429-9ae5-c56883577619	2d94425a-2e8d-4c05-a9f9-b6278ee4532b	2026-04-23 06:17:04.167639+00
2a128889-f0f9-4a5f-9733-09abb7ce893f	231c3275-4a6f-4589-af4b-1ac863e41f5a	71337446-0b5e-4b20-88e2-326b991ba2a0	execution	2198c946-e09f-443b-ae09-c43d61ca3412	16e68f2a-e268-407f-a4b2-2eb5e0b71f2a	2026-04-23 06:17:04.167639+00
f7c5653b-edc7-41d2-b505-6c9cdc4aabd3	231c3275-4a6f-4589-af4b-1ac863e41f5a	71337446-0b5e-4b20-88e2-326b991ba2a0	execution	16e68f2a-e268-407f-a4b2-2eb5e0b71f2a	f6c06b64-9325-4656-8d12-0402c028cc9b	2026-04-23 06:17:04.167639+00
2cfa344d-4437-4cbc-8afc-65ec3aec0d0d	231c3275-4a6f-4589-af4b-1ac863e41f5a	71337446-0b5e-4b20-88e2-326b991ba2a0	execution	f6c06b64-9325-4656-8d12-0402c028cc9b	10328748-0d90-4820-a12e-278738a66533	2026-04-23 06:17:04.167639+00
65da69d8-10b4-4366-94df-604d3ac2b342	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	ed0d87c6-1059-4735-b901-d5893799f698	88d65631-d711-4bc0-addc-bc213df9e3b5	2026-04-24 22:12:48.887502+00
a9a6f716-5c73-4308-b908-f19421ff47ca	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	88d65631-d711-4bc0-addc-bc213df9e3b5	f32e6c83-8792-429f-9226-f77811a5ca6c	2026-04-24 22:12:48.887502+00
60edd1b4-dfd5-4d65-be05-28cff0445bff	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	8614198a-045f-4457-9c46-6731eeb802de	0c424889-699a-470e-b17c-56ef831c943a	2026-04-24 22:12:48.887502+00
b692fd05-d2b5-49cd-84d5-ec8970b7dc55	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	0c424889-699a-470e-b17c-56ef831c943a	b1b4a9db-a32b-4452-8672-1cde3c67d275	2026-04-24 22:12:48.887502+00
f9f77a53-5157-4c59-9865-b023250cc709	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	b1b4a9db-a32b-4452-8672-1cde3c67d275	bb47f48c-d803-4288-aae9-7bd365b7fcfa	2026-04-24 22:12:48.887502+00
ccc917f3-62da-4f31-b947-02b6420a7eb8	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	14aa8ce8-ab79-483f-b2fe-ec6b5b9777b0	execution	bb47f48c-d803-4288-aae9-7bd365b7fcfa	a78d2e45-ae53-45a8-b920-e8a2320bd6cb	2026-04-24 22:12:48.887502+00
7a112a0c-0e42-4fdf-aa44-2dbe95becd15	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0550d826-98bc-418a-b20f-04970468c94b	execution	14267eef-1023-41c8-b942-6095d09eded9	73ace40a-2414-44aa-b5bd-403f41257121	2026-04-24 22:12:48.887502+00
58b9b5ca-2215-488a-9fb4-817582d887c9	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0550d826-98bc-418a-b20f-04970468c94b	execution	73ace40a-2414-44aa-b5bd-403f41257121	075c12ee-ac82-4e97-92da-304f86f8a683	2026-04-24 22:12:48.887502+00
27a49f10-7da1-4b91-92f1-bfc255369c81	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0550d826-98bc-418a-b20f-04970468c94b	execution	075c12ee-ac82-4e97-92da-304f86f8a683	96360f57-660c-4cb6-9cdd-8328b0977cfa	2026-04-24 22:12:48.887502+00
0e38e583-4015-427e-a1a7-a9d02ef212b4	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	463699cf-5f28-459e-9a67-01ec9469cce7	8bdec2d4-cb34-4fbd-ad82-fcaf9b7a8b51	2026-04-23 06:17:05.488182+00
e9e73661-0729-4b56-bd9e-d7fa130ff732	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	8bdec2d4-cb34-4fbd-ad82-fcaf9b7a8b51	a10c0d37-e1a4-4f76-a1a7-5da2084f7b47	2026-04-23 06:17:05.488182+00
8db74bee-8ec2-431d-94aa-f8e054d76915	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	a10c0d37-e1a4-4f76-a1a7-5da2084f7b47	d4fd8cd9-5307-4848-b95f-096d8d235100	2026-04-23 06:17:05.488182+00
fe19af22-c1cd-43e7-9e05-f43183c28747	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	64d05085-4571-499c-a3d5-2b6b236518d8	portfolio	d4fd8cd9-5307-4848-b95f-096d8d235100	bcf074d4-4460-4f65-a970-2780c12e72ee	2026-04-23 06:17:05.488182+00
7f4f3993-cce4-4d7f-9165-d9fc73a98c00	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	a8a7c6a2-995b-4819-b750-ca5285778188	d1beeacb-57e7-419b-99df-719f5d84e5d9	2026-04-23 06:17:05.488182+00
e411a0b3-5679-4493-83b9-2cd46213ea73	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	d1beeacb-57e7-419b-99df-719f5d84e5d9	640caa39-649a-4b17-b764-f73904edcd2e	2026-04-23 06:17:05.488182+00
211a7433-d8ae-40b8-bd9b-6690003c1b27	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	640caa39-649a-4b17-b764-f73904edcd2e	9c09c2ce-e85b-4bcf-b774-94a2db8f6db4	2026-04-23 06:17:05.488182+00
d696ee4c-0a72-40d8-860c-fe399e7fe689	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	3540e89a-9715-40f0-96ee-699ef645dca6	portfolio	9c09c2ce-e85b-4bcf-b774-94a2db8f6db4	5404034f-5cfe-46f9-aa75-5708a30c61b5	2026-04-23 06:17:05.488182+00
004bb24b-7dd6-4f47-8674-fbe49584780a	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	f39c8f5c-b9bd-4338-a0e8-6b23601a84ba	815c5c1f-820a-4cab-b80d-36b0339d1e57	2026-04-23 06:17:05.488182+00
9bef55d6-cb1e-416d-8502-2faf309cf95a	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	815c5c1f-820a-4cab-b80d-36b0339d1e57	9a3d83b4-e22e-41da-92d0-ee6ded442af9	2026-04-23 06:17:05.488182+00
839515c0-7f08-4cfd-99cf-1cc68b14abcd	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	9a3d83b4-e22e-41da-92d0-ee6ded442af9	5c28166c-0d48-4b0c-afd9-a7f6a1fa8ec2	2026-04-23 06:17:05.488182+00
3d862d88-b9b7-4a39-8a06-88ebd77f7c0f	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	9d09c452-2191-43b7-a273-11795120c82a	portfolio	5c28166c-0d48-4b0c-afd9-a7f6a1fa8ec2	955809f3-efd9-4cf9-95f3-d111bdc0d89e	2026-04-23 06:17:05.488182+00
a8160877-7690-40f0-87b7-8570776c3cef	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	661dd5de-e767-441f-9883-e3f6765c7374	4c707927-59f5-4da7-8314-ed47249ba858	2026-04-23 06:17:05.488182+00
6e27f073-504b-4059-b04d-aa9c50c38e25	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	4c707927-59f5-4da7-8314-ed47249ba858	e62dc92d-9408-400e-b4d9-d0a44a132fc7	2026-04-23 06:17:05.488182+00
dc1daba6-3761-4337-88c9-777ae440beda	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	e62dc92d-9408-400e-b4d9-d0a44a132fc7	1ecc5b02-817a-4119-b1c0-8e60a306e71c	2026-04-23 06:17:05.488182+00
42e63f68-f91a-40b5-a642-dfdf8fd306b5	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	def9b1f4-4095-4b53-abbf-a3f6d5ad5382	portfolio	1ecc5b02-817a-4119-b1c0-8e60a306e71c	a9fede18-5ede-497d-94c2-180b4d79e1b4	2026-04-23 06:17:05.488182+00
192199cb-6866-42ab-a7f2-32090168b7e8	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	0817c79d-9119-440d-b0a3-9366cd67b592	8bd8a059-7a66-4d88-aee7-e3e439981858	2026-04-23 06:17:05.488182+00
aea3d263-88f8-4fae-96ed-7c388fa9e437	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	8bd8a059-7a66-4d88-aee7-e3e439981858	559f7d80-0526-4b8a-93d0-5e9590beb0a7	2026-04-23 06:17:05.488182+00
2f96497d-8247-4356-9519-9cfc81881d44	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	559f7d80-0526-4b8a-93d0-5e9590beb0a7	ffe76053-1841-462d-9abd-be8eb2dc44e9	2026-04-23 06:17:05.488182+00
8a159945-4117-4fa7-99e0-e9a918e22163	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	portfolio	ffe76053-1841-462d-9abd-be8eb2dc44e9	5f5ea073-fe55-4ec8-a7e6-bf35dd31ff46	2026-04-23 06:17:05.488182+00
9aaf404d-bbfe-4bb8-a512-b89fa8a526a1	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	5905c091-9cc2-4a7a-a5bd-5d676ce2e938	535cd635-3798-4060-8ffb-64dfc8d2b317	2026-04-23 06:17:05.488182+00
ca2a2a11-e15c-4b41-ab4a-0de399d66fc9	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	535cd635-3798-4060-8ffb-64dfc8d2b317	a752093b-00e7-4fdc-b801-c2df7a0565fc	2026-04-23 06:17:05.488182+00
e5c32f1a-0f07-458f-845c-e0e1f3bcfe48	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	a752093b-00e7-4fdc-b801-c2df7a0565fc	d181d54a-064d-47b0-bc91-d906692251b0	2026-04-23 06:17:05.488182+00
0a1c26b3-522a-49d5-9220-7a47c4f1d43f	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	1d880685-a90a-4de6-93f4-3a4e871191ce	execution	d181d54a-064d-47b0-bc91-d906692251b0	ad02512b-fd2a-4aa9-b9d9-8787c71b3d62	2026-04-23 06:17:05.488182+00
8b1934b1-e7d1-4556-96d2-b81b6ae7b138	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	b80fd4ce-be6f-4f6d-bf5e-a9c2625dac75	24605771-6c3b-4e76-a6af-fbbd137266d3	2026-04-23 06:17:05.488182+00
d179a448-ff4f-4364-9509-8413a29af472	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	24605771-6c3b-4e76-a6af-fbbd137266d3	5c8e93da-070a-45ba-951f-33a6bfaf8264	2026-04-23 06:17:05.488182+00
c8e9c4a0-7555-403a-98a7-b6cee30f263a	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	5c8e93da-070a-45ba-951f-33a6bfaf8264	3cde8a04-4e2e-4eb3-bbb6-bef18762da6d	2026-04-23 06:17:05.488182+00
b9fee183-98e2-4151-9f34-7a1f7228b0e3	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	021e2478-2757-4be5-81ad-7ced6fbc5106	execution	3cde8a04-4e2e-4eb3-bbb6-bef18762da6d	585081b8-8c77-4a95-8788-9e2e3d7c66ab	2026-04-23 06:17:05.488182+00
123b5476-cbb3-4bfa-a498-e857eecc281d	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	aff73955-7cd3-4724-9031-81d0eb756e97	a4467795-f94c-4532-b31f-f0430b319d98	2026-04-23 06:17:05.488182+00
67aa0a6d-ae4b-4c88-bd3a-dc3b3065cc30	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	a4467795-f94c-4532-b31f-f0430b319d98	4c60dd49-e7bc-40c3-8040-87cfcb40a771	2026-04-23 06:17:05.488182+00
985d9dee-0642-4514-9794-91fc9e39cb91	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	4c60dd49-e7bc-40c3-8040-87cfcb40a771	2146ddcf-73bb-4b44-b1bf-0855c44e55ab	2026-04-23 06:17:05.488182+00
97107fb1-14ef-4326-8453-976c3edf50d3	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	b14a284a-16ac-400c-b580-3d140011b3df	execution	2146ddcf-73bb-4b44-b1bf-0855c44e55ab	f7c374a0-95e7-4bb8-a1d4-b212d178fccc	2026-04-23 06:17:05.488182+00
c400080c-4595-475a-91b7-47b4465bc26e	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	8cc329aa-42a4-4d71-9dd9-4e5c5416331d	execution	eeec3f50-f5f6-44f3-a651-70563d0f1b32	42a4ead3-ffae-499b-b7f1-284e6fdd67e9	2026-04-23 06:17:05.488182+00
4c74ffe0-9f1c-439a-9c92-7af88a3a4d89	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	8cc329aa-42a4-4d71-9dd9-4e5c5416331d	execution	42a4ead3-ffae-499b-b7f1-284e6fdd67e9	d0d0acfb-d3b5-466f-ba43-5a48cc01ce3d	2026-04-23 06:17:05.488182+00
bdb2fa6f-2891-4f62-b992-d1c1c3846a7f	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	8cc329aa-42a4-4d71-9dd9-4e5c5416331d	execution	d0d0acfb-d3b5-466f-ba43-5a48cc01ce3d	8feab6a8-3db2-4524-8ffc-c059997137fc	2026-04-23 06:17:05.488182+00
6cc6e707-fd0f-47d0-8cd2-7ddc0bb7aee2	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	5b9a79c4-a9f8-4f73-b77a-babbecc51734	5c16aaf3-20b7-4a07-8fff-f79eccf5dee1	2026-04-23 06:17:05.967504+00
db05a8b7-096c-4b27-87b9-746966c58bac	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	5c16aaf3-20b7-4a07-8fff-f79eccf5dee1	94536253-ee4e-4cac-8f14-c3c876d224dd	2026-04-23 06:17:05.967504+00
8581b5a4-342f-4913-b84a-9c700fc64ca1	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	94536253-ee4e-4cac-8f14-c3c876d224dd	0a575012-4f2a-41cb-bdee-58ae1b54057d	2026-04-23 06:17:05.967504+00
febf7161-9a9c-4523-9002-8c10272e9db7	97492b25-c98a-48ee-9009-047c783b3f44	996eb1c5-dc10-445a-b648-91f52782b539	portfolio	0a575012-4f2a-41cb-bdee-58ae1b54057d	18c74d09-331f-4edf-81ab-5f841cf7a4ba	2026-04-23 06:17:05.967504+00
8c4020e1-0976-4fbc-9d71-81d54e68ad1a	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	822dce67-e556-43ed-b8c1-0eca70466ff6	7a32d0de-2b55-4b80-8e6f-b80345119d21	2026-04-23 06:17:05.967504+00
8ee35b7e-8275-439f-95eb-99c745a44ad7	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	7a32d0de-2b55-4b80-8e6f-b80345119d21	a3fbd898-a720-4698-afd7-2ac5163e0e52	2026-04-23 06:17:05.967504+00
ec0ed07f-5583-4463-9c42-9461aff576bd	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	a3fbd898-a720-4698-afd7-2ac5163e0e52	cacedf26-d7d8-4bf1-bd6c-4c044ffdbbaf	2026-04-23 06:17:05.967504+00
57faa638-8673-4335-92c7-c1e2864ab649	97492b25-c98a-48ee-9009-047c783b3f44	d3afb047-93e7-4b34-ba04-f9f8430f7880	portfolio	cacedf26-d7d8-4bf1-bd6c-4c044ffdbbaf	e442fce4-ae28-4567-b6ce-7c203fbe60de	2026-04-23 06:17:05.967504+00
5cafb5f6-10e9-4ce0-a0e2-ed31ca5563f7	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	e4f087c3-41db-45a6-b9a4-23caed07b210	ae1565d2-51f0-44d7-a51e-a19efae3995e	2026-04-23 06:17:05.967504+00
981c19d7-3dcd-4c52-8565-f6aa89e2a073	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	ae1565d2-51f0-44d7-a51e-a19efae3995e	617f78b9-2da3-456f-adf8-52e2ab343667	2026-04-23 06:17:05.967504+00
115d54aa-7170-49c0-a0be-d50fb7612c9c	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	617f78b9-2da3-456f-adf8-52e2ab343667	b58309ba-1905-4dee-8ff0-238f275690c5	2026-04-23 06:17:05.967504+00
2588f777-c04b-438e-ad31-b3da8b43c3c2	97492b25-c98a-48ee-9009-047c783b3f44	222abd0b-53c7-44c2-94b3-cc58f54668e4	portfolio	b58309ba-1905-4dee-8ff0-238f275690c5	ce5ac85b-fb61-4a79-8b0f-6bd26fd5cea2	2026-04-23 06:17:05.967504+00
89da33b7-7f0a-4cce-93ad-5529df15361e	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	3407b192-80b0-485a-b1c0-465a8880b42b	abaf9565-e571-4316-a43b-6944e30beac3	2026-04-23 06:17:05.967504+00
52a3b191-16df-45f0-bec3-da8f838fe098	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	abaf9565-e571-4316-a43b-6944e30beac3	8d516c0d-0e4f-4310-9c99-8bdeab6a29fc	2026-04-23 06:17:05.967504+00
77b56ee9-0e06-4991-bf7c-c740c3908ad3	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	8d516c0d-0e4f-4310-9c99-8bdeab6a29fc	e94340c0-af52-474c-ab5e-14ebd1fe4b08	2026-04-23 06:17:05.967504+00
82d22f64-d75e-492e-869a-8d23cfc9c0f7	97492b25-c98a-48ee-9009-047c783b3f44	582ee73b-f460-45ef-b8de-664bf509f9cb	portfolio	e94340c0-af52-474c-ab5e-14ebd1fe4b08	8d2659f0-4906-4608-8690-7dd010bb58e3	2026-04-23 06:17:05.967504+00
54b0411e-9955-479e-91ff-930df027344e	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	36b769d6-bd09-47de-9ddf-9097174ffad3	b7813c85-b4c4-4619-970d-65bcba1fcf1c	2026-04-23 06:17:05.967504+00
08e91d80-cc69-4924-a346-2a12407a7586	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	b7813c85-b4c4-4619-970d-65bcba1fcf1c	43b7aa9d-af6e-45d7-8f63-3ebbec8f4b0e	2026-04-23 06:17:05.967504+00
076a2d73-0d3f-40cf-be45-317f778dff19	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	43b7aa9d-af6e-45d7-8f63-3ebbec8f4b0e	26f2a541-fda6-424b-9109-13ee791ebfe9	2026-04-23 06:17:05.967504+00
dbe87517-0428-4952-8099-e8e6a445f117	97492b25-c98a-48ee-9009-047c783b3f44	b33627c7-be8c-49dd-908e-f31b8d106a38	portfolio	26f2a541-fda6-424b-9109-13ee791ebfe9	a4e0a8fb-b3f5-4f40-817e-d63ae7968e5c	2026-04-23 06:17:05.967504+00
5a475e4d-a3c2-402c-a568-a6d45b8e8c51	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	08feedf3-b2a3-4b37-a762-be09ace37d66	11ae6970-a35a-4885-a805-52747fc7de6f	2026-04-23 06:17:05.967504+00
3fab1cc3-62e9-4d4f-a5a2-0cb605d3ec9b	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	11ae6970-a35a-4885-a805-52747fc7de6f	97a84d14-fd38-4b1f-ab55-27a7d3e35a95	2026-04-23 06:17:05.967504+00
423ce68a-79be-4502-8b26-d9c66db618f9	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	97a84d14-fd38-4b1f-ab55-27a7d3e35a95	23df626c-45ea-4ce0-b841-97009a434380	2026-04-23 06:17:05.967504+00
daaad3b1-d2e1-4775-be35-e2328e6b9fa1	97492b25-c98a-48ee-9009-047c783b3f44	b828fcdf-631e-439b-acde-c24bd94d7b5a	execution	23df626c-45ea-4ce0-b841-97009a434380	39ae55d9-6fa1-401c-8fc0-344055fd78c2	2026-04-23 06:17:05.967504+00
ad8a371b-8fee-497c-b628-fa3615489df7	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	bca2d374-2dea-4757-ac79-79bbf4ec7816	f5ccc07e-0b29-4584-aa85-8bdd2674958b	2026-04-23 06:17:05.967504+00
eb73b85f-5da8-4217-9543-a84ded47ace5	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	f5ccc07e-0b29-4584-aa85-8bdd2674958b	398f3b94-f1b2-449d-a2b1-a6c39dd58ad5	2026-04-23 06:17:05.967504+00
dd9737ea-4905-4383-b093-c865e4007f7d	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	398f3b94-f1b2-449d-a2b1-a6c39dd58ad5	b2e07535-00fc-4e75-9fc7-816a4ad450f1	2026-04-23 06:17:05.967504+00
e398b187-5cce-41e7-a000-813869fa642c	97492b25-c98a-48ee-9009-047c783b3f44	1f096464-b9ea-4e7f-a804-7d3c3a7d6aa1	execution	b2e07535-00fc-4e75-9fc7-816a4ad450f1	a3e2aaea-f846-4497-9ae3-3a92b853fc9d	2026-04-23 06:17:05.967504+00
f74463fe-8353-48aa-a084-dd562095a186	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	5a29b674-1236-46aa-bd39-d4132abe11bd	b2a5e6d3-e5b6-431c-9b6a-8f336313d1ea	2026-04-23 06:17:05.967504+00
19185157-c9f6-4ccc-ba9d-ba9caefb7cec	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	b2a5e6d3-e5b6-431c-9b6a-8f336313d1ea	3eff8e17-c3a4-453e-8b9b-56126aca3ebf	2026-04-23 06:17:05.967504+00
744ff37c-b992-4dc7-8430-ebc2729f1b1d	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	3eff8e17-c3a4-453e-8b9b-56126aca3ebf	1186e06b-4ec5-4c52-bcc5-49340661deff	2026-04-23 06:17:05.967504+00
79c8dcdf-4c71-436f-bf60-81b17a0e21ff	97492b25-c98a-48ee-9009-047c783b3f44	735ac886-d5e5-42d7-8f0d-42056f84024f	execution	1186e06b-4ec5-4c52-bcc5-49340661deff	7c3cb5fd-680c-43ed-94c8-0789e28761b0	2026-04-23 06:17:05.967504+00
18790a8f-4ed2-4751-9c44-045d8e91dc3b	97492b25-c98a-48ee-9009-047c783b3f44	753eee37-2fff-4d21-917b-13adebd0f41f	execution	58da8398-9474-4087-b6ae-1c4ee619d9dc	fd2bc5ef-1688-4e84-9a90-617e97abf292	2026-04-23 06:17:05.967504+00
48ac6ac2-0b4e-4491-b1e6-477c3ebaf615	97492b25-c98a-48ee-9009-047c783b3f44	753eee37-2fff-4d21-917b-13adebd0f41f	execution	fd2bc5ef-1688-4e84-9a90-617e97abf292	ee16bff7-ec55-4ebb-8099-e673e127d0fd	2026-04-23 06:17:05.967504+00
a3c5609d-38a9-4714-94ce-4048a2375c6b	97492b25-c98a-48ee-9009-047c783b3f44	753eee37-2fff-4d21-917b-13adebd0f41f	execution	ee16bff7-ec55-4ebb-8099-e673e127d0fd	921ebe0b-3e64-4199-ab12-f5b1a9410ad8	2026-04-23 06:17:05.967504+00
32586a36-9e36-41a1-aa86-0a21f54e8a3f	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	5069ceef-1a18-413c-a19e-9b565406cd74	bbd5e3bb-71e8-49eb-a5fc-277c816939e1	2026-04-23 06:17:06.742455+00
cad78033-d110-4b83-9c28-ae2545dda912	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	bbd5e3bb-71e8-49eb-a5fc-277c816939e1	3069cc23-ff6e-46a6-93ca-87e23931c863	2026-04-23 06:17:06.742455+00
fa56b852-a6c2-4baa-984a-df212daa45cc	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	3069cc23-ff6e-46a6-93ca-87e23931c863	5da325d9-06e4-44e5-a2c1-39b8b6927476	2026-04-23 06:17:06.742455+00
64b3f467-0dc6-4ec8-ba5a-f6fc4debcc2b	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	69c28110-e2bc-4b97-b067-9787bad66dc6	portfolio	5da325d9-06e4-44e5-a2c1-39b8b6927476	e17e082f-cb2d-4ed1-9964-bee49a7c4d58	2026-04-23 06:17:06.742455+00
6853ffe2-3960-4487-b9f5-8810eea87b5d	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	6c1d9462-16ba-4b9c-b5d6-e9912936af2e	424ec28d-7e0e-4a7f-82c0-d2cde7fb5d7a	2026-04-23 06:17:06.742455+00
dd769f36-5713-43ba-a117-e430c95b1499	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	424ec28d-7e0e-4a7f-82c0-d2cde7fb5d7a	c28c0795-2a49-4dc3-a071-9b22d57d321f	2026-04-23 06:17:06.742455+00
2b8c4bd7-3b6b-4b17-bd08-339195c13994	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	c28c0795-2a49-4dc3-a071-9b22d57d321f	efe2a410-ab6f-45db-b67c-b23bf6a84cb9	2026-04-23 06:17:06.742455+00
53a25448-362f-46d9-a2df-3913850b1fa5	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	portfolio	efe2a410-ab6f-45db-b67c-b23bf6a84cb9	d1b389a8-559b-4af4-a727-37ae25ffc728	2026-04-23 06:17:06.742455+00
dfef93b5-be39-425b-a9c2-465264b95ba9	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	42040abd-e109-47f6-bbd1-8c981596e5fc	7ad6ad77-3a8a-4bfe-909b-2f69fe66d3a2	2026-04-23 06:17:06.742455+00
e7506949-e462-4f68-ba26-97e685d99745	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	7ad6ad77-3a8a-4bfe-909b-2f69fe66d3a2	0e5b77ea-9820-4523-885d-b46104ca0575	2026-04-23 06:17:06.742455+00
f67b50b3-2ec3-471a-9981-211271b2ea77	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	0e5b77ea-9820-4523-885d-b46104ca0575	af52687c-489b-4127-bc86-2ff3082a493f	2026-04-23 06:17:06.742455+00
c479a6ca-8a81-418b-be9e-510889933f36	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	92e1f73d-da41-4ed3-b7e0-b1ea00e90981	portfolio	af52687c-489b-4127-bc86-2ff3082a493f	f55df66d-7570-41ff-85ba-b17cb4af1d00	2026-04-23 06:17:06.742455+00
b864c6b0-7b64-40f1-b6b3-ea53e14068e0	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	27eecec4-754f-40f3-8470-83ac38e142ff	5f1d0450-2cf8-4834-8241-25cbe787fcd4	2026-04-23 06:17:06.742455+00
09bcb3fe-c65c-4391-a35b-ea011c96b70a	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	5f1d0450-2cf8-4834-8241-25cbe787fcd4	f2634679-d5ef-446a-bf1b-c06c7ce164f5	2026-04-23 06:17:06.742455+00
68fe8f43-1787-4a95-ae2b-6e779d140a31	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	f2634679-d5ef-446a-bf1b-c06c7ce164f5	6d44c88b-6613-45f6-a650-c494bade2302	2026-04-23 06:17:06.742455+00
b6958fd5-9cfe-473f-b370-dfa1a8b5c151	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	14af1dd7-7ade-4a6a-8205-7e074f1a8f55	portfolio	6d44c88b-6613-45f6-a650-c494bade2302	f43d9d38-4ddc-4528-aba0-4add61d16cfc	2026-04-23 06:17:06.742455+00
79890bb6-0f1d-4fb4-bbea-284a9f908331	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	d34ade64-0723-4eb0-b404-d9963955685b	23b22ae0-09ed-4c03-aafc-5670579a1f79	2026-04-23 06:17:06.742455+00
58b2c4ff-1584-4e8e-a202-f8093f044d8f	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	23b22ae0-09ed-4c03-aafc-5670579a1f79	f54e94f4-0de5-4b1e-bf6a-ee4b5f387517	2026-04-23 06:17:06.742455+00
06ea0943-d8ca-43f4-aefe-608750cc04f6	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	f54e94f4-0de5-4b1e-bf6a-ee4b5f387517	6ba3bed4-5c40-4150-a249-6b25402b2456	2026-04-23 06:17:06.742455+00
031c8a2c-cf93-4dd8-81c5-243a1db35e1a	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	972cc219-c406-4c91-985b-13b6478a59e3	portfolio	6ba3bed4-5c40-4150-a249-6b25402b2456	41c778d0-dd5a-4926-8afc-6d9023995b62	2026-04-23 06:17:06.742455+00
718acc9a-87c9-4659-a6e4-2a7e1e9c200d	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	0b0596a2-4acc-42a5-8f30-0f57d1b8cc80	f75fc619-2595-4ba3-89b4-fb664917b27f	2026-04-23 06:17:06.742455+00
6951d831-30fb-4e8e-96eb-69b543d2282f	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	f75fc619-2595-4ba3-89b4-fb664917b27f	3fc33e1c-7c46-499d-a444-15663941a437	2026-04-23 06:17:06.742455+00
bfd305e0-4432-41f1-9ea8-cf9105c91dc2	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	3fc33e1c-7c46-499d-a444-15663941a437	d5790f01-1c8d-4a8d-9471-8625314becac	2026-04-23 06:17:06.742455+00
e13fe942-b911-4ca3-9666-5d8ddc6f35fd	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	45df1ece-79f3-457e-99b1-50fdd670bffb	execution	d5790f01-1c8d-4a8d-9471-8625314becac	7c632470-ccc3-4ebf-a7f2-5ec918e45e3c	2026-04-23 06:17:06.742455+00
eed44639-922b-4900-8f4a-ea11c664903a	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	443fa14e-ece0-4228-a500-f44a11cc20bd	38ebaf03-aa2a-40b6-a6fd-e231512a774c	2026-04-23 06:17:06.742455+00
bbfd1c80-8b23-4b03-b5ea-c0ebc907a003	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	38ebaf03-aa2a-40b6-a6fd-e231512a774c	c519cdd9-8bbd-4e2e-ac80-d3ddfacc1c24	2026-04-23 06:17:06.742455+00
52ebe505-f03d-4586-9695-14541de4f328	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	c519cdd9-8bbd-4e2e-ac80-d3ddfacc1c24	4a332ed9-af4b-410a-b8b4-7fdc70a883ea	2026-04-23 06:17:06.742455+00
71acde14-e562-478c-a2bd-c542765c32ea	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	b5793135-60ed-439d-8ee5-c4034b72604a	execution	4a332ed9-af4b-410a-b8b4-7fdc70a883ea	cb970e32-0643-487d-b42f-e11cc3e83baf	2026-04-23 06:17:06.742455+00
2cfbb51e-f690-4237-8f6c-271fddffcd8d	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	e2a6254a-197c-4e2b-8d10-ce3175f9ffe5	231786d8-6dab-440f-90f5-ecf2ee6f63d7	2026-04-23 06:17:06.742455+00
5b7657f0-b362-4323-8d24-b081729194bf	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	231786d8-6dab-440f-90f5-ecf2ee6f63d7	cf1646d5-bbd7-45a0-a78e-8407ce3a9ec3	2026-04-23 06:17:06.742455+00
4d4b343b-758b-4020-bdf1-f282b31eae17	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	cf1646d5-bbd7-45a0-a78e-8407ce3a9ec3	1a26828f-9767-47ae-81b9-0da5bfa3515c	2026-04-23 06:17:06.742455+00
bd6bcbac-0f70-486b-b01f-b31f01a55acd	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	330b6397-3577-49f1-8f57-8b835e8a3a04	execution	1a26828f-9767-47ae-81b9-0da5bfa3515c	c3a048a8-2ba6-4ccb-b85d-f97da7f2fad9	2026-04-23 06:17:06.742455+00
f1aac277-3c8c-45d2-8745-2e17b0c77955	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	44c68bda-7896-45de-bc7e-fbca657c52a8	execution	9a99b036-3b8f-480e-94dc-c4be71b829a3	8df56cd8-06e2-467a-8b5d-70fe6d9a976e	2026-04-23 06:17:06.742455+00
e5b6b881-0e21-49e9-9558-b877065c5123	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	44c68bda-7896-45de-bc7e-fbca657c52a8	execution	8df56cd8-06e2-467a-8b5d-70fe6d9a976e	754a3d41-49c6-4906-84d8-4522d5958106	2026-04-23 06:17:06.742455+00
d7b8d31f-d0b0-4176-a898-d9d8fed7a8c0	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	44c68bda-7896-45de-bc7e-fbca657c52a8	execution	754a3d41-49c6-4906-84d8-4522d5958106	8afafcb5-e4b0-466f-b046-525cd55aae07	2026-04-23 06:17:06.742455+00
ec055319-7392-4bca-ac46-6785cb5d3d7e	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	06735309-a327-44e6-b2b3-ea086e86355b	fd102a24-bc89-428e-8fcd-0a311bedbd5f	2026-04-24 22:12:49.958356+00
390bc4c1-27e5-4bab-9225-4ed5783e2ec2	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	fd102a24-bc89-428e-8fcd-0a311bedbd5f	0f607c63-5412-43a3-94f8-30a48e176e06	2026-04-24 22:12:49.958356+00
a3c3ce68-ac31-4896-adb9-255822814e41	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	0f607c63-5412-43a3-94f8-30a48e176e06	23363df0-70b0-49ba-838e-88952cf04c7b	2026-04-24 22:12:49.958356+00
25a5e2df-10be-43c7-9f48-4c9b791af2a3	635ed3cf-3d86-4985-89eb-8975012d1420	18398d24-f96e-4cdf-893f-25c03631fd25	portfolio	23363df0-70b0-49ba-838e-88952cf04c7b	8b4075a4-27f0-4ec2-8ebc-2559a13ae1c3	2026-04-24 22:12:49.958356+00
2608739b-cf31-4118-9011-27a0d27312ca	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	be526f54-4988-41c3-ab72-6670b0dee528	fdec1fcf-6e62-41e1-b36d-efdfe09ffef0	2026-04-24 22:12:49.958356+00
6bc4b9f5-2bf6-454c-a11f-fdd04bb5863c	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	fdec1fcf-6e62-41e1-b36d-efdfe09ffef0	b28f50e5-d36d-4aa2-a9b3-36caba249bed	2026-04-24 22:12:49.958356+00
9d6f795a-9267-44f0-b4bf-79ec5ec0316b	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	b28f50e5-d36d-4aa2-a9b3-36caba249bed	05a83194-6e61-4f69-86e3-af506932ad2d	2026-04-24 22:12:49.958356+00
29a23390-5937-4b8c-a92e-a2f75d993475	635ed3cf-3d86-4985-89eb-8975012d1420	49013a59-4c36-417e-865f-3a80529b7684	portfolio	05a83194-6e61-4f69-86e3-af506932ad2d	b5d2320b-cd93-47ce-95cb-eb66c30a7d50	2026-04-24 22:12:49.958356+00
be3b857a-f94c-442f-a5b5-76fcb96555b6	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	382ab48e-f057-40e5-9192-0eda0bb1dbae	7e9b44a7-8f72-4b64-965a-3ddb8e35a1c1	2026-04-24 22:12:49.958356+00
6e2cc227-9878-4081-a148-fe261f41baed	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	7e9b44a7-8f72-4b64-965a-3ddb8e35a1c1	03121edd-36ac-49d0-9dab-9450b3148141	2026-04-24 22:12:49.958356+00
1f2f2629-296b-4c85-a8c4-8da3761d4223	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	03121edd-36ac-49d0-9dab-9450b3148141	ab70600f-d7c4-4c21-9791-a0954a9a8aad	2026-04-24 22:12:49.958356+00
9868557b-2e4d-4b1d-a065-13857eb3aa24	635ed3cf-3d86-4985-89eb-8975012d1420	fe103d44-4c19-4554-bff9-13497c6921c9	portfolio	ab70600f-d7c4-4c21-9791-a0954a9a8aad	a5464dec-e2e1-41b4-a19a-5f22cbc075cb	2026-04-24 22:12:49.958356+00
b43bb7a7-2d70-4a07-904e-71b5e9bfebf9	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	3faa1a63-264d-49c9-a429-f6211ad844a3	f11478e0-5bc2-4286-8bc5-43499b9f13f4	2026-04-24 22:12:49.958356+00
82cccea2-c6d9-45f4-a352-44e34efb1405	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	f11478e0-5bc2-4286-8bc5-43499b9f13f4	d842c4d9-03d0-484e-a97c-88b293ef0866	2026-04-24 22:12:49.958356+00
e02afc7a-e459-48c5-9e7d-d8ce597e858a	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	d842c4d9-03d0-484e-a97c-88b293ef0866	b16fbf66-9ba7-4f69-a231-c197dc5012ce	2026-04-24 22:12:49.958356+00
6a44431e-e6e4-4d73-ad08-38a66424e133	635ed3cf-3d86-4985-89eb-8975012d1420	300efd1f-dc81-471c-bab2-7d6ccf3ea81a	portfolio	b16fbf66-9ba7-4f69-a231-c197dc5012ce	35df98ef-d02c-44bb-be1c-6fdb6272af4e	2026-04-24 22:12:49.958356+00
2fc5afba-18c1-4419-b6ea-8f78e7f306ad	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	3849d0f6-b4f8-4f9d-a3e3-0547e2608311	27cdbea8-686f-4473-80b0-939ae27339e1	2026-04-24 22:12:49.958356+00
755d8429-b542-445d-9411-b85b0b167bf7	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	27cdbea8-686f-4473-80b0-939ae27339e1	039f8bc1-0744-4f5b-8802-1de21c907416	2026-04-24 22:12:49.958356+00
67a1d143-4f2e-43d8-9cdb-2214757f1af1	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	039f8bc1-0744-4f5b-8802-1de21c907416	7df9cb96-f96e-47ee-98b6-88df573f66e4	2026-04-24 22:12:49.958356+00
eb829aec-6958-42b0-96ba-aec17a3bd6e4	635ed3cf-3d86-4985-89eb-8975012d1420	6022fd50-95f7-4a8a-b80e-ed68e841e1e4	portfolio	7df9cb96-f96e-47ee-98b6-88df573f66e4	c5f0aa11-b7d6-48e4-ad9f-c8e40b01c3bf	2026-04-24 22:12:49.958356+00
58425e16-fcef-472e-a305-747816e47d0a	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	f784942e-0a64-49d6-97a0-2e06d242c300	02138f23-f84a-466d-810d-8d02029d9c59	2026-04-24 22:12:49.958356+00
b6a373f6-7702-4fd4-b80f-b55667c8bc4d	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	02138f23-f84a-466d-810d-8d02029d9c59	1ecfe9c9-a1e8-402a-8439-af8f716d0196	2026-04-24 22:12:49.958356+00
40acf2bc-2f05-4b89-8022-3e8370f2ba3a	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	1ecfe9c9-a1e8-402a-8439-af8f716d0196	ca5adc1b-1914-4868-b679-d34577840fcf	2026-04-24 22:12:49.958356+00
66981b19-071e-4f78-af37-0165c19feb58	635ed3cf-3d86-4985-89eb-8975012d1420	0a36a643-aa01-4992-b6f9-98124c8400f2	execution	ca5adc1b-1914-4868-b679-d34577840fcf	df3b4b61-687e-4360-af73-f51b9a478224	2026-04-24 22:12:49.958356+00
89c2cc6b-f316-48b0-bff2-0ad3b0629ac2	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	ad9503dc-1241-4fb0-99dc-5fb47efc17dc	2349a0fe-d170-43f3-b498-39c287db3009	2026-04-24 22:12:49.958356+00
3bbac6cd-c95c-46c6-bdf4-59ac73ee18fe	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	2349a0fe-d170-43f3-b498-39c287db3009	029a4a58-4d80-42d7-8251-63e668479ee3	2026-04-24 22:12:49.958356+00
2a1896d0-063a-4036-8108-7e88d4d3bfb8	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	3ece3890-337b-405d-8b97-e37b5ebe90a9	4306f4d9-8f5c-4474-ac15-02eba0ae7089	2026-04-24 22:12:46.548477+00
9b6d3696-2985-4b78-8266-2661f9bd0a15	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	4306f4d9-8f5c-4474-ac15-02eba0ae7089	ae13f959-c85c-42c3-aba5-c5dcd1f59bfe	2026-04-24 22:12:46.548477+00
dce0ba1c-4a20-473f-bfc3-e0bac33ccfb0	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	ae13f959-c85c-42c3-aba5-c5dcd1f59bfe	89c8241e-d9c0-4667-9ef5-fbeeae1cf78f	2026-04-24 22:12:46.548477+00
3faef778-c0cd-4937-8a1c-682f649cc148	3c60198d-1cf1-4443-af35-84f20511b17c	b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	portfolio	89c8241e-d9c0-4667-9ef5-fbeeae1cf78f	ae126513-2e6d-43d3-9069-8d5d73c8f44f	2026-04-24 22:12:46.548477+00
6761995f-38fa-4f6e-be54-29da08a4e0d9	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	deb9798b-ac87-404e-8eab-132297636c4e	624c4ac2-4bae-4239-8333-948b0cd16db8	2026-04-24 22:12:46.548477+00
cd751b41-af2d-4c40-ab46-753b87de3998	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	624c4ac2-4bae-4239-8333-948b0cd16db8	b1ea279f-3b35-41a8-b142-e0ea12cee366	2026-04-24 22:12:46.548477+00
4ad0eb7b-f2a3-409a-828c-045f31c41b3b	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	b1ea279f-3b35-41a8-b142-e0ea12cee366	fa6fdd32-89ed-4968-a16f-f72d81c932d9	2026-04-24 22:12:46.548477+00
3753d142-3342-4a6b-aea4-cd82e3543353	3c60198d-1cf1-4443-af35-84f20511b17c	875527c3-23e2-4450-bb14-1db7765db06d	portfolio	fa6fdd32-89ed-4968-a16f-f72d81c932d9	04c59a36-8bd8-41d0-946b-7813b1dcaa26	2026-04-24 22:12:46.548477+00
2eec856e-63c3-42fc-9daa-0c4ee98f40b4	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	6c1cb11a-ef3d-4d46-9f1f-2c1fd89d5912	86e66ed9-ec95-41de-8022-4a0214fb20a6	2026-04-24 22:12:46.548477+00
648bfa0c-b77d-46a9-9f2e-4ab79a3c7cae	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	86e66ed9-ec95-41de-8022-4a0214fb20a6	2ef14b41-2584-4570-93f3-c9242f932066	2026-04-24 22:12:46.548477+00
fe18c139-5904-4177-9ad4-63216cf73a1f	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	2ef14b41-2584-4570-93f3-c9242f932066	b300452a-332d-458b-a966-d0039e14a84e	2026-04-24 22:12:46.548477+00
2f1ddfcb-814b-4e75-a71f-9824a74514a7	3c60198d-1cf1-4443-af35-84f20511b17c	2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	portfolio	b300452a-332d-458b-a966-d0039e14a84e	989c8a4b-7991-428f-bfb9-d9d0c110cf34	2026-04-24 22:12:46.548477+00
4a12a89c-a3ff-4023-9f5a-2a099647b435	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	03763975-6efa-4a57-bd11-5d81aa72a588	5da96113-6762-43b5-9307-1fb7a5546f21	2026-04-24 22:12:46.548477+00
1ae237b5-0dc1-488f-98fc-f270546058c5	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	5da96113-6762-43b5-9307-1fb7a5546f21	df5f0755-86db-400d-8c6a-8f5b0c56acab	2026-04-24 22:12:46.548477+00
e06fca0c-9db4-4433-afb5-81b088319b0c	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	df5f0755-86db-400d-8c6a-8f5b0c56acab	8e428cec-f911-47c5-9c90-a1e2005aab28	2026-04-24 22:12:46.548477+00
7429f727-f680-4c40-a980-223542ffc913	3c60198d-1cf1-4443-af35-84f20511b17c	2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	portfolio	8e428cec-f911-47c5-9c90-a1e2005aab28	7e0550fa-c415-46cf-82c8-a9ad8de40f49	2026-04-24 22:12:46.548477+00
1361191e-7c22-4727-b2f9-9a591f82a418	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	fcf059b1-0fa0-4358-99a6-3b5c07887e73	6802f7d4-47d0-43c1-8b9a-a7fb479c2fb0	2026-04-24 22:12:46.548477+00
89d093a2-06c4-49de-8141-daeddabdc50b	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	6802f7d4-47d0-43c1-8b9a-a7fb479c2fb0	7075a751-911a-4955-b49b-fec58b959c14	2026-04-24 22:12:46.548477+00
675fca2e-530d-4afe-a2c2-b307d5c9b2bd	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	7075a751-911a-4955-b49b-fec58b959c14	d96109e4-6ef6-4892-ad8e-07f10575f16b	2026-04-24 22:12:46.548477+00
a333e026-0fed-4b2b-87b8-88b8779cdc2a	3c60198d-1cf1-4443-af35-84f20511b17c	b62bcf18-8d8e-4627-9119-8b09fc89a054	portfolio	d96109e4-6ef6-4892-ad8e-07f10575f16b	4b861fc7-7167-4c40-8310-26ee51ab7b57	2026-04-24 22:12:46.548477+00
12d640c2-566c-4ea6-9b40-0ce5f28e0d7a	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	fc9edeaa-c822-4f83-8385-205de0e3f351	35942319-db2f-41d1-8221-5738677fe232	2026-04-24 22:12:46.548477+00
74c13b27-48a3-4215-b18e-a17269e07bbb	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	35942319-db2f-41d1-8221-5738677fe232	6ed94467-9cfb-4a9e-9b3f-e1dbf7732afd	2026-04-24 22:12:46.548477+00
38a7f742-9849-457c-9802-c7e17944ca01	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	6ed94467-9cfb-4a9e-9b3f-e1dbf7732afd	f2d6b5de-7275-453b-9741-d7bccb276d08	2026-04-24 22:12:46.548477+00
65e6ea87-4f78-46fb-8df5-6ecf9f17cb34	3c60198d-1cf1-4443-af35-84f20511b17c	f15cf382-d9bb-4f51-b0e7-98aeebe09f10	execution	f2d6b5de-7275-453b-9741-d7bccb276d08	d05751d7-2242-4013-8aaf-76a4f7df9abd	2026-04-24 22:12:46.548477+00
f9d84852-0c6d-46c9-830e-6d6ae02230c2	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	09e1fc4b-8cd8-4467-b873-9bac8eb89256	d6bb3f4b-a46e-4722-8bce-5a00e0688e8d	2026-04-24 22:12:46.548477+00
0b907b71-083f-4c69-ae9b-12e04c31ba01	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	d6bb3f4b-a46e-4722-8bce-5a00e0688e8d	865be7b8-f228-47e8-8457-95faf79be695	2026-04-24 22:12:46.548477+00
129da31a-15e1-475e-8409-8af5b49dc1ed	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	865be7b8-f228-47e8-8457-95faf79be695	6a5a4cdf-a6ac-4009-a448-0a95d3a31259	2026-04-24 22:12:46.548477+00
3ededf66-34f8-4c9b-9661-62151816fb06	3c60198d-1cf1-4443-af35-84f20511b17c	6cdf63bf-557b-4e95-b287-7f86579ba492	execution	6a5a4cdf-a6ac-4009-a448-0a95d3a31259	ae6ce789-f3da-482e-9836-d37c7c0d63b3	2026-04-24 22:12:46.548477+00
068402fc-1582-4ed9-9e44-acd23bbbb0b7	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	8b40d623-b4cb-4ce9-b5ea-366f6d5323e8	7a26b123-86c3-41fa-a823-30fcfbae75f2	2026-04-24 22:12:46.548477+00
6b3bff68-ed9f-4dc6-8ddb-8cab29dee6cf	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	7a26b123-86c3-41fa-a823-30fcfbae75f2	874adbe6-59de-4e27-a2b2-f5a2b057e8cc	2026-04-24 22:12:46.548477+00
8a3115ab-dd5b-4c0a-bacd-764ef7ea8a16	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	874adbe6-59de-4e27-a2b2-f5a2b057e8cc	8bc2b5f5-fe76-4055-8026-d4a2ed8408ae	2026-04-24 22:12:46.548477+00
86b1f7fa-7856-4103-9a6f-97cf2a6479ba	3c60198d-1cf1-4443-af35-84f20511b17c	4da1609b-48cc-4168-bc48-34551e8cc093	execution	8bc2b5f5-fe76-4055-8026-d4a2ed8408ae	bc195284-dbd3-4d31-b595-3edac0042222	2026-04-24 22:12:46.548477+00
2b5b6382-0ebb-4777-b35f-78abfb75818d	3c60198d-1cf1-4443-af35-84f20511b17c	191df7a5-488a-445f-83e5-ae30d8ddd9c7	execution	b4d8efe2-1dc8-4b43-bc3f-53e18059b7bd	9ac8a226-9d44-42b9-927a-ef7a6f170c2e	2026-04-24 22:12:46.548477+00
34e109b9-f80b-4900-8ce5-d8174bff0857	3c60198d-1cf1-4443-af35-84f20511b17c	191df7a5-488a-445f-83e5-ae30d8ddd9c7	execution	9ac8a226-9d44-42b9-927a-ef7a6f170c2e	ce51b168-4b22-4b85-8621-c33de4734ce4	2026-04-24 22:12:46.548477+00
5d86bc14-c8c8-4757-9806-a1099033967a	3c60198d-1cf1-4443-af35-84f20511b17c	191df7a5-488a-445f-83e5-ae30d8ddd9c7	execution	ce51b168-4b22-4b85-8621-c33de4734ce4	6778fdea-fec0-49e9-b160-de4e395f3b4a	2026-04-24 22:12:46.548477+00
5f7c1725-531c-4477-bd06-3b1d0e7fb722	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	029a4a58-4d80-42d7-8251-63e668479ee3	916f0d1c-1448-4b6d-ba7c-779556a987a7	2026-04-24 22:12:49.958356+00
ac9b2ac4-16b4-423d-b87c-d254a51cc5f0	635ed3cf-3d86-4985-89eb-8975012d1420	4b6e5be4-68bd-49db-9cc6-1a1da26b433d	execution	916f0d1c-1448-4b6d-ba7c-779556a987a7	4f7dbfbe-a3aa-4d36-a81f-8c7fb4cea2bc	2026-04-24 22:12:49.958356+00
db7222ce-114d-43ff-bcc0-26e95ca27f5f	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	246ce41d-eb65-43fa-8151-1adf81e92901	bb8f0918-b8de-4225-867f-35abed9e1a45	2026-04-24 22:12:49.958356+00
04d5a946-b5a8-4d3a-95ca-3dd9f1590f25	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	bb8f0918-b8de-4225-867f-35abed9e1a45	9c6fdbdd-1ffb-4f9d-95b8-9709042ca576	2026-04-24 22:12:49.958356+00
91ed4734-585c-41b3-8695-d9e611757ad2	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	9c6fdbdd-1ffb-4f9d-95b8-9709042ca576	4c0ed1d1-d6dc-4c0d-b1c8-e0e4428070d2	2026-04-24 22:12:49.958356+00
f96c3993-fedd-4eb8-80e4-a290bfcfd744	635ed3cf-3d86-4985-89eb-8975012d1420	37a103ba-8ede-4b7a-82a1-1b8982d90053	execution	4c0ed1d1-d6dc-4c0d-b1c8-e0e4428070d2	b96133af-aff2-4bfc-b0d7-98858806b5d5	2026-04-24 22:12:49.958356+00
ab0d4939-6f63-42dc-9ed2-946661cfb838	635ed3cf-3d86-4985-89eb-8975012d1420	343caf1b-9cc4-46a2-ae0a-fe2418606033	execution	c3116e66-01b7-4f38-ac14-bbb952018f4c	1e79630a-d358-4f3a-aea2-6cb4c60c40a4	2026-04-24 22:12:49.958356+00
948ad522-8b0a-4831-a5ee-fce05e777a65	635ed3cf-3d86-4985-89eb-8975012d1420	343caf1b-9cc4-46a2-ae0a-fe2418606033	execution	1e79630a-d358-4f3a-aea2-6cb4c60c40a4	c8e14609-c9ad-47a8-ac95-4a16fdcc2db3	2026-04-24 22:12:49.958356+00
ac065bb3-dd20-4b7d-9576-728b1e8542e5	635ed3cf-3d86-4985-89eb-8975012d1420	343caf1b-9cc4-46a2-ae0a-fe2418606033	execution	c8e14609-c9ad-47a8-ac95-4a16fdcc2db3	9fe38804-c87c-4009-9a88-0cf0fb846651	2026-04-24 22:12:49.958356+00
96a4d3c0-5e36-4485-9297-f0da25b00ddc	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	47aea403-5a0a-429c-9fa6-99706a8e66ce	c97c194e-d298-4720-af20-4ab2589fafa6	2026-04-23 06:05:43.305888+00
85b21e00-9648-44b0-a326-5ab24ded1d98	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	c97c194e-d298-4720-af20-4ab2589fafa6	1e40ec5e-b987-4c8d-a5c6-1f4a2f477c20	2026-04-23 06:05:43.305888+00
886fb87b-e09e-4bc0-8c77-7801a261a0b3	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	1e40ec5e-b987-4c8d-a5c6-1f4a2f477c20	1111bd04-7b3f-4100-a204-fda66e3b5aa7	2026-04-23 06:05:43.305888+00
43861236-ffed-407f-955b-23cf8f647ec7	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	portfolio	1111bd04-7b3f-4100-a204-fda66e3b5aa7	3a8893f1-b17e-43a3-933b-7f3e27443542	2026-04-23 06:05:43.305888+00
562cdca7-a639-4cd9-82a8-0efe93cb85b9	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	313a0178-21c6-403c-907c-cace304cd216	02f2c853-e287-4c8b-b162-c2cbae4306bd	2026-04-23 06:05:43.305888+00
ada784d6-b1b6-4d6b-96b7-844f947fea41	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	02f2c853-e287-4c8b-b162-c2cbae4306bd	afe674ad-759b-4b4e-87e5-acc097103896	2026-04-23 06:05:43.305888+00
27677283-5bb7-4392-9a3f-cd6be21f1718	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	afe674ad-759b-4b4e-87e5-acc097103896	5a517650-4ad5-43db-a6a4-80fae44225d2	2026-04-23 06:05:43.305888+00
ce2dba8c-36ec-41ef-bb9c-4861fac22e85	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2510f6e1-2189-4c6b-aac2-0193f43c7e5c	portfolio	5a517650-4ad5-43db-a6a4-80fae44225d2	87a193cf-374b-4d41-8745-f98522963334	2026-04-23 06:05:43.305888+00
5b9314b6-a98d-420a-b5b8-dabe4b626d9e	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	49e09838-d038-4dbb-b503-8d442daf6e0e	1dda6cab-f973-41f1-af30-7dd45dddad03	2026-04-23 06:05:43.305888+00
cd36adff-ce5c-4be5-91ad-9730ac8e3e8f	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	1dda6cab-f973-41f1-af30-7dd45dddad03	b79db896-cbf4-4381-bba5-aa92aab23b07	2026-04-23 06:05:43.305888+00
68cc31b6-3f46-46c4-95af-f7674f05883c	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	b79db896-cbf4-4381-bba5-aa92aab23b07	3ada48af-d20a-4004-9b92-221b070bf784	2026-04-23 06:05:43.305888+00
63a3bf6c-a276-4e07-aef1-8098f50e113b	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	c44f3df9-9470-436e-a202-2e7e9af653c2	portfolio	3ada48af-d20a-4004-9b92-221b070bf784	dfcabbfe-6716-47d6-ac7f-27a8b4a34eb0	2026-04-23 06:05:43.305888+00
5aa0b948-08a6-4ee2-821b-3df7fc4dbe8a	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	80e1349c-220b-41b4-ac35-b13810a2b493	a21a4022-b691-43a0-b30c-37acf3895c09	2026-04-23 06:05:43.305888+00
f6219a08-0ecd-435c-90d4-f954411fe3b7	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	a21a4022-b691-43a0-b30c-37acf3895c09	08090a7b-b99e-4bf6-9ef6-521383603ee9	2026-04-23 06:05:43.305888+00
5a4bf4c7-e975-4a3b-84c5-2bd698337e11	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	08090a7b-b99e-4bf6-9ef6-521383603ee9	a9ca3e0f-2f37-42a4-b563-f332bdfd6462	2026-04-23 06:05:43.305888+00
c64a9aa6-13df-459b-b8ea-155272491669	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	28d37179-125e-4849-9304-8edce6ff1d9d	portfolio	a9ca3e0f-2f37-42a4-b563-f332bdfd6462	9b3f9846-824a-45f8-9d5a-8f56bfa29077	2026-04-23 06:05:43.305888+00
02cae368-37d8-403d-80ca-20d0c484f7bf	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	ed5dc39b-8d8b-442e-ac35-a83dcbfa606f	ae60d251-fda9-4ece-8afe-8929cde1a387	2026-04-23 06:05:43.305888+00
2a4553a2-5a99-4088-b0c9-a072e278b2bf	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	ae60d251-fda9-4ece-8afe-8929cde1a387	41504d62-0a6e-4b91-a93d-08cb2680276b	2026-04-23 06:05:43.305888+00
ce1c4525-609e-4c7f-85de-aa45016947e8	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	41504d62-0a6e-4b91-a93d-08cb2680276b	db452075-14e7-4ab9-a9cf-ee31b5eda51f	2026-04-23 06:05:43.305888+00
9092d5fb-6eba-440b-9a86-0099a9b65851	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	2a4ed1c2-466a-429c-83c4-c4625eb92f10	portfolio	db452075-14e7-4ab9-a9cf-ee31b5eda51f	d1a81062-12ef-4b07-b5c8-e159a0a0ee63	2026-04-23 06:05:43.305888+00
ffcfb862-a76d-4e67-afbd-a4fab3f537f5	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	8764d0b2-771a-4bf9-9d67-6c3649c64eb3	c62fbee4-0883-4dd1-90ef-25b8adb624ca	2026-04-23 06:05:43.305888+00
c1c6808d-ab5c-482b-a552-8ab671ac1850	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	c62fbee4-0883-4dd1-90ef-25b8adb624ca	bcb91d81-f546-4407-a74d-f8c751a3a63a	2026-04-23 06:05:43.305888+00
4606d436-9ad9-4177-b7e9-946b9386c91f	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	bcb91d81-f546-4407-a74d-f8c751a3a63a	99f14e2b-a52d-4c79-bb3d-627aaf0b69b4	2026-04-23 06:05:43.305888+00
a9fefa14-4eb1-4f4c-b993-aecb248b8c2b	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07046885-13df-47a2-aa9c-a246c9dbacd8	execution	99f14e2b-a52d-4c79-bb3d-627aaf0b69b4	592c3dce-451e-4768-8e4d-b22dbc96d8f6	2026-04-23 06:05:43.305888+00
4984eef2-a2fc-4026-8081-0f43226aaaf0	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	7b397224-a472-4392-9431-8152385fd51d	57d3b60f-8a7b-489b-bb6c-57ec0e337f80	2026-04-23 06:05:43.305888+00
db28e506-9f8c-48f5-bbef-c92f88f4a6f4	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	57d3b60f-8a7b-489b-bb6c-57ec0e337f80	ba858f37-756a-4325-aa26-548f3ce0382a	2026-04-23 06:05:43.305888+00
e2118a1b-b744-4e4a-8928-ea52cdcecee5	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	ba858f37-756a-4325-aa26-548f3ce0382a	9278cfc9-4089-4ee7-a85c-8ccfc19073d2	2026-04-23 06:05:43.305888+00
acc1c916-6195-4d41-9140-c0c32e75b888	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	9925ca3c-4b0e-4e8d-b4ce-610f709869f1	execution	9278cfc9-4089-4ee7-a85c-8ccfc19073d2	4c92ac30-97c7-4532-8458-0be1dd22e5b9	2026-04-23 06:05:43.305888+00
c4da9283-5aeb-43aa-a673-54d4952ac7de	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	e939a73c-1cf5-4245-8113-be1058ba0116	7b758698-106d-48a0-91d5-f2a60490c26c	2026-04-23 06:05:43.305888+00
6eecef6d-34e6-4065-bf34-147ba001246c	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	7b758698-106d-48a0-91d5-f2a60490c26c	b7f97619-ee3c-444b-a0a8-48ab486660e0	2026-04-23 06:05:43.305888+00
1397a432-8f14-45db-a9b2-947d62502eab	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	b7f97619-ee3c-444b-a0a8-48ab486660e0	7171948f-daa6-430f-acaa-8a55e7a30952	2026-04-23 06:05:43.305888+00
b5a4372c-81d9-4c13-a4c6-36d0679f4657	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	72332b94-8ef0-47d3-a0de-aad7b2b581db	execution	7171948f-daa6-430f-acaa-8a55e7a30952	313b7923-1801-4be2-b071-3bd4cb77eabb	2026-04-23 06:05:43.305888+00
a6e840fc-72ce-4155-b608-750b910ab57d	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	4f4dd6a3-e19e-48ab-bea6-1fc82a80d1c1	execution	e942b797-4df4-458b-acd5-f50db895dada	dc838440-4dc5-4acd-b82d-95deefd02f4d	2026-04-23 06:05:43.305888+00
35fa5856-75a6-4830-ae6b-0a889e440beb	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	4f4dd6a3-e19e-48ab-bea6-1fc82a80d1c1	execution	dc838440-4dc5-4acd-b82d-95deefd02f4d	bde6bf5c-b2c0-4101-95b1-88790e105ab4	2026-04-23 06:05:43.305888+00
facaaaed-b15a-4a69-8f1d-659f79c2681d	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	4f4dd6a3-e19e-48ab-bea6-1fc82a80d1c1	execution	bde6bf5c-b2c0-4101-95b1-88790e105ab4	b8ef79e3-c2d4-40aa-8bd0-5a8413ea4634	2026-04-23 06:05:43.305888+00
587427ed-6e7b-4519-a972-2874c53a001c	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	649d2c84-d551-4b31-b491-1351a969a9ee	2d095429-fdc5-49d6-bf38-1d4cdbe2d9ec	2026-04-23 06:05:44.631317+00
a251bdfd-0099-4c20-bfd5-76aa59c2f593	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	2d095429-fdc5-49d6-bf38-1d4cdbe2d9ec	be966f98-8122-48f1-96fa-736f5a5c8380	2026-04-23 06:05:44.631317+00
5f1e6c09-a641-45ce-bdff-a0ae51959a5f	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	be966f98-8122-48f1-96fa-736f5a5c8380	cdf40717-99cd-4a04-8adc-ac74715b3c4c	2026-04-23 06:05:44.631317+00
a3080140-bbd8-4b61-ab0c-039e6edb9730	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	005b73b4-0479-4b42-a78c-4ad2fc8fbb20	portfolio	cdf40717-99cd-4a04-8adc-ac74715b3c4c	cae4a171-17fe-417e-a5ac-d28248e5b637	2026-04-23 06:05:44.631317+00
180360b6-2bb1-4c22-9c3a-d2a9a8b53745	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	61d8aa96-131d-4616-bfa8-cb4cc2708585	26961c7b-1738-413a-8813-a0cc6a849fd5	2026-04-23 06:05:44.631317+00
1e8d89ba-141c-4594-81e1-70ea0c153584	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	26961c7b-1738-413a-8813-a0cc6a849fd5	ae77a398-40a5-45c7-884d-6179ebce466c	2026-04-23 06:05:44.631317+00
f6799cce-96fb-4b71-a5d3-230aae1bfc68	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	ae77a398-40a5-45c7-884d-6179ebce466c	52fbb603-f9b2-4018-bf28-187f63de6691	2026-04-23 06:05:44.631317+00
88db2a88-50b9-4823-ab04-5dd81c74fb65	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	9f1983cc-085a-459a-ab2d-77a6cad10860	portfolio	52fbb603-f9b2-4018-bf28-187f63de6691	83b5ce35-f211-4949-9cb3-7d02720e5b46	2026-04-23 06:05:44.631317+00
fbfccb1d-105b-40f4-909b-acda061068ae	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	28859822-1ed9-448d-8401-83dc9568a833	da9ab1d3-30c8-4196-a4ac-95d523239556	2026-04-23 06:05:44.631317+00
c715760b-6b56-423c-a0b0-29317ec95f81	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	da9ab1d3-30c8-4196-a4ac-95d523239556	29430569-eeb0-4a18-8e21-d1af58cbca93	2026-04-23 06:05:44.631317+00
ccfbcf1a-96f8-40d2-ab1f-dc2fc86b1085	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	29430569-eeb0-4a18-8e21-d1af58cbca93	79e8618d-fdee-4be5-a11f-99fa792a4a24	2026-04-23 06:05:44.631317+00
d926a151-2e43-4557-8dc9-cd07a7f474b8	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	916c245e-8a90-4425-a7b6-2161af9a8114	portfolio	79e8618d-fdee-4be5-a11f-99fa792a4a24	18391de6-0c21-415c-bc5d-2a93c787eefd	2026-04-23 06:05:44.631317+00
b4da3eb3-04cc-4527-952b-8b22343a02a1	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	a5f8a714-f10e-4379-b9d6-47b62f8aafe6	e7b4233c-bdb7-41f2-9c06-9702a3326851	2026-04-23 06:05:44.631317+00
108db29c-6219-4d46-9450-3605073e8abd	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	e7b4233c-bdb7-41f2-9c06-9702a3326851	b8546f32-fea2-446e-aeec-1dd29a4f6abd	2026-04-23 06:05:44.631317+00
b26278ce-64d3-4634-aa53-7ae942940f17	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	b8546f32-fea2-446e-aeec-1dd29a4f6abd	764591e7-73fe-4a48-b98e-c4186c3ed9fa	2026-04-23 06:05:44.631317+00
d3c74d55-01d7-4afc-b73f-970b8e43ec77	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	a127f090-3034-4ea4-a191-f098094f724d	portfolio	764591e7-73fe-4a48-b98e-c4186c3ed9fa	f23678d1-dabf-453b-92d6-24b32cbce417	2026-04-23 06:05:44.631317+00
6c535740-1069-480a-98b9-852bbb0b6a96	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	bf638fdd-dc9a-49eb-a2ec-918b0c4ead50	836dece3-b910-468a-9572-fa6cfd824572	2026-04-23 06:05:44.631317+00
1f72ae57-d4dc-4a1b-8bac-5d925513f86d	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	836dece3-b910-468a-9572-fa6cfd824572	76bea9fb-8a38-4297-b9d1-52613039f185	2026-04-23 06:05:44.631317+00
f9962508-3397-4ba2-b3e0-ef10f32e5068	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	76bea9fb-8a38-4297-b9d1-52613039f185	b5f81f8b-9e0b-4d0c-9a06-f262745f9ee2	2026-04-23 06:05:44.631317+00
395bd1a1-7e33-4e49-8aa4-16a90dd028a5	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	3c4dcda4-72ca-4a8b-9064-a638004271dc	portfolio	b5f81f8b-9e0b-4d0c-9a06-f262745f9ee2	17773700-b549-42f4-867c-0c695aa51305	2026-04-23 06:05:44.631317+00
353090db-121f-4e23-bf34-adc062475582	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	d3d93783-aad8-420c-8a7a-3d440c010d2e	37e27b00-6dee-4f73-ba8b-2d73a1b47970	2026-04-23 06:05:44.631317+00
8a60e147-bb3e-4ce8-ac76-e216375b8ce5	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	37e27b00-6dee-4f73-ba8b-2d73a1b47970	4bfbb414-aa41-4aa0-92f8-f5b166cd94e7	2026-04-23 06:05:44.631317+00
4b78529f-5021-4e0c-a8af-70a3aa5416af	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	4bfbb414-aa41-4aa0-92f8-f5b166cd94e7	65b99e7e-ad22-47f9-92d3-7a8413b9a5da	2026-04-23 06:05:44.631317+00
f4c4eb71-ef08-4d60-9f35-63a0bfe31129	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	5e2ee236-3a6c-4803-b60f-5e27c237de76	execution	65b99e7e-ad22-47f9-92d3-7a8413b9a5da	27ce34ef-8847-4c15-b6ce-6b75ee269b87	2026-04-23 06:05:44.631317+00
f360f082-5f66-482a-a894-00f6fffa3e23	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	a648ac8b-3f61-4a9d-8799-6490284cec2b	e5c11c24-1fdf-42bc-9557-bd1db6733f74	2026-04-23 06:05:44.631317+00
d776ef6b-5001-4089-8c5c-d74a226223d3	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	e5c11c24-1fdf-42bc-9557-bd1db6733f74	9f8e6993-e616-46d6-99bb-814e9facee61	2026-04-23 06:05:44.631317+00
11134d9e-6096-4326-9a09-cb006136744d	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	9f8e6993-e616-46d6-99bb-814e9facee61	e8914366-2e71-4da8-855e-df813afa2935	2026-04-23 06:05:44.631317+00
8ba62f2e-f5d2-427e-98d5-bda2b5087002	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	96408528-458d-4f6c-ac7e-b67c4d12521c	execution	e8914366-2e71-4da8-855e-df813afa2935	e28c7378-332a-481f-8972-60839bde34e5	2026-04-23 06:05:44.631317+00
4afa3477-82f3-4005-84b5-324c08d7bdfd	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	d65366b6-9eaa-4904-8479-2df31f0e8c9e	cefb7913-09ea-43b7-afbd-61fae3a0bf2c	2026-04-23 06:05:44.631317+00
2441403b-3f14-4c78-8579-da2d0759f72e	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	cefb7913-09ea-43b7-afbd-61fae3a0bf2c	51bbffc7-b6b0-49d4-b220-0959809ebeaf	2026-04-23 06:05:44.631317+00
ece9dce3-10e5-46b3-8679-fe2a27c7fad4	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	51bbffc7-b6b0-49d4-b220-0959809ebeaf	c022efe7-5967-48ea-a54e-6ce008e6426d	2026-04-23 06:05:44.631317+00
3a8a65f5-b808-4224-97f9-d6076391ec54	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	790f06d7-6f44-46eb-980f-39fc34e7b128	execution	c022efe7-5967-48ea-a54e-6ce008e6426d	fbb1a3e6-aba3-4024-86f9-9b8440be93fb	2026-04-23 06:05:44.631317+00
dfa55809-6a9c-4b0f-b7bf-f06e27d8cf13	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	ee951907-24db-487a-a174-b25a66ee6d1b	execution	a0b1a149-0009-47ae-8381-b38463c551c5	cf7a3546-d37e-4708-b1f5-f583c741d245	2026-04-23 06:05:44.631317+00
f12149c9-d950-4d6d-9b69-4ff40e3a2f7b	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	ee951907-24db-487a-a174-b25a66ee6d1b	execution	cf7a3546-d37e-4708-b1f5-f583c741d245	9b09efd9-a4b9-407b-a4ff-5f89c470ba36	2026-04-23 06:05:44.631317+00
894fb47b-9a89-420b-a3d0-3a7de68ce0fa	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	ee951907-24db-487a-a174-b25a66ee6d1b	execution	9b09efd9-a4b9-407b-a4ff-5f89c470ba36	2848c07c-6361-462a-b938-d15878d67118	2026-04-23 06:05:44.631317+00
16edcaaa-b8e7-4b71-89d8-f7d6ced5e2fb	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	dd018700-cb32-452c-a36b-f092138e8446	ed5a8563-0929-4c82-bc44-d33814fce6ec	2026-04-23 06:05:45.104266+00
5a68ce90-cf79-4337-b795-44bb7ab7b479	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	ed5a8563-0929-4c82-bc44-d33814fce6ec	7f92425f-d69d-486e-a0f5-c842191cf641	2026-04-23 06:05:45.104266+00
1d41803d-fbf2-47de-92a0-2b8c2943c8e4	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	7f92425f-d69d-486e-a0f5-c842191cf641	3a6a016f-2622-4968-ad26-ca2c98e38b0e	2026-04-23 06:05:45.104266+00
407d7a5f-f503-45d4-9a9d-a71104c26944	4fe02761-85c9-409a-9ea9-04c10f536394	f814f424-bb40-41d1-9f23-4359eee9d330	portfolio	3a6a016f-2622-4968-ad26-ca2c98e38b0e	9c43d4be-a0c3-4623-bb25-7023b0bbec86	2026-04-23 06:05:45.104266+00
23ad74fe-f96b-4f0d-8530-a287ff611110	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	0aa428d1-abd2-44e6-b825-6fee3f6c2b30	fff670e4-835b-42b2-9f73-73288ca86a20	2026-04-23 06:05:45.104266+00
4a113473-8b55-4e6d-8dbe-e83522ef743f	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	fff670e4-835b-42b2-9f73-73288ca86a20	d63027f7-9e3e-4678-b6b3-9f06605640c5	2026-04-23 06:05:45.104266+00
f1a1e7f0-6bc3-44eb-9b21-30a0af3981e6	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	d63027f7-9e3e-4678-b6b3-9f06605640c5	47c0606b-376d-4844-a0b6-1547536d76d1	2026-04-23 06:05:45.104266+00
051dc9ac-585e-41cf-baf0-4a83062d0092	4fe02761-85c9-409a-9ea9-04c10f536394	d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	portfolio	47c0606b-376d-4844-a0b6-1547536d76d1	62439c6e-1eb9-40d2-90fa-05bba5b734a4	2026-04-23 06:05:45.104266+00
c6b5cd61-61c8-471d-be4b-4a0755fdd696	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	fb557bc1-e8db-4752-b94f-a80c92c79680	1eedc891-2ee2-4fd1-af63-81ce46c9dfcd	2026-04-23 06:05:45.104266+00
f0a3a99e-7737-4e21-bb04-239d63d3c010	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	1eedc891-2ee2-4fd1-af63-81ce46c9dfcd	0ed5f360-e8e5-454c-a4f5-76e2e04368ea	2026-04-23 06:05:45.104266+00
148404e8-495a-42fa-ba05-db478755b014	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	0ed5f360-e8e5-454c-a4f5-76e2e04368ea	0173dd51-68eb-433f-8125-8e2a646ca923	2026-04-23 06:05:45.104266+00
44b5263c-da4d-4fa2-97f0-90681d19c244	4fe02761-85c9-409a-9ea9-04c10f536394	6e0020e4-f142-4096-b46d-1738c23406d1	portfolio	0173dd51-68eb-433f-8125-8e2a646ca923	e9c51a36-c28e-4e06-ae43-0d8fd3eca870	2026-04-23 06:05:45.104266+00
74f5283f-9d98-4e93-951d-5219aa55a7ef	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	2e990c08-4a03-4dbb-82ee-4b696559ca12	2af4dc65-ec8b-4da1-8bed-ef6670abe16c	2026-04-23 06:05:45.104266+00
8bc1ec8c-633a-4151-8475-1eedb5b8dc96	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	2af4dc65-ec8b-4da1-8bed-ef6670abe16c	52219da5-2aa8-4c22-a2eb-527a8c814fae	2026-04-23 06:05:45.104266+00
fadca9f8-4b39-4d3f-bf03-1b74fbf41ef2	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	52219da5-2aa8-4c22-a2eb-527a8c814fae	56277303-d3c5-41bd-b222-5e72b7f1a50d	2026-04-23 06:05:45.104266+00
30925cea-410b-42de-b200-9e647c5c1e7d	4fe02761-85c9-409a-9ea9-04c10f536394	ecc89495-702c-495c-8672-dda32e51d7d7	portfolio	56277303-d3c5-41bd-b222-5e72b7f1a50d	db4d1cef-778b-4f37-9512-82af82f48070	2026-04-23 06:05:45.104266+00
e3da25fc-cd83-4570-a07a-858237370aee	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	4291aa59-d3df-4fff-a770-068374231cec	e3e8fda2-965f-411f-a242-f65cb3499acf	2026-04-23 06:05:45.104266+00
f11ce8be-c8bc-4e72-b3e6-bba284e0126b	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	e3e8fda2-965f-411f-a242-f65cb3499acf	007993fb-6ce8-4e35-b57e-b3fb25c7960b	2026-04-23 06:05:45.104266+00
5b747084-3c34-455e-a092-0641efdd97f8	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	007993fb-6ce8-4e35-b57e-b3fb25c7960b	d938e638-4e35-426e-bb2d-b4394c53940e	2026-04-23 06:05:45.104266+00
1cb6fac5-5ca7-45e9-a4b8-037ff97d1692	4fe02761-85c9-409a-9ea9-04c10f536394	b54242f2-b44c-47b3-bdf2-17515967faee	portfolio	d938e638-4e35-426e-bb2d-b4394c53940e	57e2b0f5-eb57-456d-beb9-f2ec1c66bae7	2026-04-23 06:05:45.104266+00
a96cbd48-e9c8-40fc-a9d4-6fa2717e15f9	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	11180e3e-0a62-4211-bb6d-e30623a4e622	397bd04b-3d77-49c9-81af-d6e694d6ab54	2026-04-23 06:05:45.104266+00
0024368d-2e54-4e7d-ad8f-96f0d097a574	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	397bd04b-3d77-49c9-81af-d6e694d6ab54	d7a86cc0-1a4f-4edd-bf15-10ed25bd2028	2026-04-23 06:05:45.104266+00
cc738c74-8a9e-4c0d-9961-def018fddc83	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	d7a86cc0-1a4f-4edd-bf15-10ed25bd2028	62af399a-3b75-476e-8e81-05ea15d91716	2026-04-23 06:05:45.104266+00
e24af13b-553f-465a-9754-56c3407f8053	4fe02761-85c9-409a-9ea9-04c10f536394	039f773d-2d12-4952-9fa1-6e393e81bfe7	execution	62af399a-3b75-476e-8e81-05ea15d91716	46751583-558a-48aa-ab9f-93d870fa359b	2026-04-23 06:05:45.104266+00
ea58e740-2808-4aaf-94a3-e34c3fa70a49	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	efc790ef-1fd0-4d95-8c02-90a177b33d33	43b2ae2f-4168-43ef-9874-308b52c39c28	2026-04-23 06:05:45.104266+00
5fb77593-dfa8-4672-a2da-5d76a2f4a1b5	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	43b2ae2f-4168-43ef-9874-308b52c39c28	baa1309e-60e2-4b73-9efd-5393602d107a	2026-04-23 06:05:45.104266+00
4dd42490-a7fc-4b02-886a-4d40d6c6ea69	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	baa1309e-60e2-4b73-9efd-5393602d107a	06473d39-2735-415a-b84d-2fdb6fe56519	2026-04-23 06:05:45.104266+00
e3b0c0d0-21f5-4301-b84d-09e3247f6e83	4fe02761-85c9-409a-9ea9-04c10f536394	65eeac04-4ae5-47cb-8b6c-fe56a48ae4aa	execution	06473d39-2735-415a-b84d-2fdb6fe56519	805374e2-2cef-4dbc-8094-5135b0364251	2026-04-23 06:05:45.104266+00
6376acc9-af30-4896-8089-fb99da4fdf2e	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	cc53402b-bad8-42a3-a7ac-43ccf5c4a964	8c417fd1-ac40-4d51-a3a9-c1fd93e37cb1	2026-04-23 06:05:45.104266+00
1298088b-a7b6-47c8-a9d3-9641a004e2d7	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	8c417fd1-ac40-4d51-a3a9-c1fd93e37cb1	4fb80428-9f65-4dbf-93dc-c8eb1fd5c1f3	2026-04-23 06:05:45.104266+00
1ab9b45e-90a6-49ef-ac23-d731156d1700	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	4fb80428-9f65-4dbf-93dc-c8eb1fd5c1f3	ce4485c4-c11a-4145-a546-1f5e5af73f3e	2026-04-23 06:05:45.104266+00
47358b05-9739-49b7-b888-809807fef3cc	4fe02761-85c9-409a-9ea9-04c10f536394	7950d5d9-3b40-45bd-ba96-38982dacdf7c	execution	ce4485c4-c11a-4145-a546-1f5e5af73f3e	c5641ebb-5a71-4a8d-8c90-ad41eaa681d9	2026-04-23 06:05:45.104266+00
483c5e92-34f2-42d5-a53e-9313dcfb8e75	4fe02761-85c9-409a-9ea9-04c10f536394	4a53944b-543f-4396-b6ab-623f25b3b760	execution	47c147e7-a6b5-494f-b99c-369be4b59bba	92ce5be3-7a31-4596-820a-a7f11e58b434	2026-04-23 06:05:45.104266+00
78934e7f-1b80-4008-942c-b0c9e53c06d9	4fe02761-85c9-409a-9ea9-04c10f536394	4a53944b-543f-4396-b6ab-623f25b3b760	execution	92ce5be3-7a31-4596-820a-a7f11e58b434	74433420-7fed-4449-ab91-5b904f014d38	2026-04-23 06:05:45.104266+00
ee88156d-b558-4031-817f-4f6bc5066aec	4fe02761-85c9-409a-9ea9-04c10f536394	4a53944b-543f-4396-b6ab-623f25b3b760	execution	74433420-7fed-4449-ab91-5b904f014d38	dbe92876-bd78-43ca-8b38-b5cf135bf293	2026-04-23 06:05:45.104266+00
dfe2966a-7587-4b66-8499-2eee53a2216b	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	26cdc9f6-b052-4d0a-aa99-48d000ef7678	2ac5bfe9-bece-466d-a583-467d55d3abbc	2026-04-23 06:05:46.205643+00
889ae0ad-a842-4039-8e99-2fad84199315	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	2ac5bfe9-bece-466d-a583-467d55d3abbc	88d2b800-7cbc-4aca-af9e-8f86d3788ea3	2026-04-23 06:05:46.205643+00
9ec74ff1-d8c3-4b52-9f11-6ecd06ad98f8	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	88d2b800-7cbc-4aca-af9e-8f86d3788ea3	c14879cd-dc34-4779-9d3e-15414d5768c0	2026-04-23 06:05:46.205643+00
bf6f5e21-9dc5-499a-8e22-af22c1cd563f	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea54853f-bbde-44b6-8601-1d6c31a18fe0	portfolio	c14879cd-dc34-4779-9d3e-15414d5768c0	a6f37c71-15dd-40ac-a7db-3f0ac68fdc22	2026-04-23 06:05:46.205643+00
1376d048-2a9d-4ebf-b4d9-a14e6b5b3f22	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	bb1ec0a5-09c4-4ffc-9075-401144908649	afccb340-92b7-4afc-9a5a-98f84ac3654b	2026-04-23 06:05:46.205643+00
d94a147d-1450-46ca-872a-6000aecf219c	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	afccb340-92b7-4afc-9a5a-98f84ac3654b	d78dc0a1-e7f6-4638-a2f3-30922765a35d	2026-04-23 06:05:46.205643+00
db62028b-b644-4ffc-a610-230ae5078bf8	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	d78dc0a1-e7f6-4638-a2f3-30922765a35d	27c55ba8-e8d5-4f5d-a884-477a884e8bdc	2026-04-23 06:05:46.205643+00
e45a8748-c1d1-4a17-919e-ef27968c0f1b	1e2e4435-7c7b-4f13-898b-872f38a55ffd	ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	portfolio	27c55ba8-e8d5-4f5d-a884-477a884e8bdc	51ef3e87-b05d-4afd-b8fb-f741c6f3397a	2026-04-23 06:05:46.205643+00
e86c080f-38cf-4dbf-b600-871061982984	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	a0366e7c-d809-4248-849d-21d594d27f89	eca79efc-b1db-4487-9eb3-f5d680d601f6	2026-04-23 06:05:46.205643+00
7f540885-41ed-462f-a1ac-10a683677ce4	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	eca79efc-b1db-4487-9eb3-f5d680d601f6	89421a90-5d48-49f4-89ea-54729fba2735	2026-04-23 06:05:46.205643+00
3d7d3453-9940-4dec-b1b5-96002c861cc2	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	89421a90-5d48-49f4-89ea-54729fba2735	ac586d8a-ba98-4ace-8fa6-95118df33107	2026-04-23 06:05:46.205643+00
c399b242-5ad6-465a-9d35-6a9a5bb70421	1e2e4435-7c7b-4f13-898b-872f38a55ffd	4bc80cd2-a239-4565-834e-5b5f0a240375	portfolio	ac586d8a-ba98-4ace-8fa6-95118df33107	5aab72b4-e6a6-4046-a8e6-2d7c06609012	2026-04-23 06:05:46.205643+00
15abf7db-b0a9-42cc-b3f0-43d583030dee	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	7585fac9-9064-4b4a-a4ff-3d1c72c65ee7	88bd0375-9263-443d-9e96-597bd7de90df	2026-04-23 06:05:46.205643+00
229c5816-b612-4e34-aa4e-a7d909970382	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	88bd0375-9263-443d-9e96-597bd7de90df	1843b824-4380-4616-9b57-05b8dec71f46	2026-04-23 06:05:46.205643+00
9cd4af11-8157-438e-8808-d4f3e864f377	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	1843b824-4380-4616-9b57-05b8dec71f46	6ff3e2dc-5691-4b70-ab87-3ff83a89568f	2026-04-23 06:05:46.205643+00
fc57ccd9-2cbf-46f9-929c-6e251b1aac8d	1e2e4435-7c7b-4f13-898b-872f38a55ffd	a8c2f743-8799-4113-b8f5-9afff9a51791	portfolio	6ff3e2dc-5691-4b70-ab87-3ff83a89568f	c7d51a0a-c0f7-4070-835b-399185d9065e	2026-04-23 06:05:46.205643+00
c11a8ecf-dead-4332-9e0b-8784dbe5bc3f	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	c0a5ebe4-fb28-44f0-aa4b-b4755c96f693	23d6c326-24ed-498c-a336-00334119b0b5	2026-04-23 06:05:46.205643+00
c5da6e28-fd46-46b4-9730-9eb1b6145330	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	23d6c326-24ed-498c-a336-00334119b0b5	c2abe9e1-2d9d-4ffa-a6ad-c404f87b051a	2026-04-23 06:05:46.205643+00
1ec916b9-5a9e-40db-9492-fbc6214c959b	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	c2abe9e1-2d9d-4ffa-a6ad-c404f87b051a	07ef86d1-874d-4feb-a96b-fd10c893cbf3	2026-04-23 06:05:46.205643+00
86ad37f8-e504-4d36-b98b-3cc1388d91e3	1e2e4435-7c7b-4f13-898b-872f38a55ffd	f5c16bc0-fee7-42db-85bf-783564cd7009	portfolio	07ef86d1-874d-4feb-a96b-fd10c893cbf3	19870124-0346-4ae8-b575-8d93022e8647	2026-04-23 06:05:46.205643+00
0fc89abd-3bb1-48e6-a6c5-6b0ce30c3e58	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	44276948-4aef-4cf1-8cb6-56e2e754d59a	0bcd2cb7-a3fa-4003-9bd5-e3657df04f01	2026-04-23 06:05:46.205643+00
c0aca875-d036-48b1-9927-97b56ad796f2	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	0bcd2cb7-a3fa-4003-9bd5-e3657df04f01	4943af2b-0c84-4132-99ff-97782ae1494d	2026-04-23 06:05:46.205643+00
3f3811a1-93da-468d-84c3-b125e1985039	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	4943af2b-0c84-4132-99ff-97782ae1494d	b729274c-1cf0-4b4b-aafd-cf3d595a536b	2026-04-23 06:05:46.205643+00
48f0f1d4-5175-4ec7-a36c-04e0f06664f3	1e2e4435-7c7b-4f13-898b-872f38a55ffd	1e74dbb4-a262-461d-8e05-f9e36edf9c8c	execution	b729274c-1cf0-4b4b-aafd-cf3d595a536b	3d348a12-f261-40aa-b6e0-cca880a7b642	2026-04-23 06:05:46.205643+00
dfe5ea42-ad15-4ff0-8818-27a6e6d99871	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	f895d840-1fe9-4d45-96f3-3f1f76bbbe7d	accad4ec-229c-46f6-8504-951a6722bb61	2026-04-23 06:05:46.205643+00
36dfc4cc-a06c-4868-a3a2-440dd3ec73eb	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	accad4ec-229c-46f6-8504-951a6722bb61	9dce4f3c-9679-403a-917e-6c553fc082fe	2026-04-23 06:05:46.205643+00
81e6d876-2070-4c29-b147-4b7babdfee9b	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	9dce4f3c-9679-403a-917e-6c553fc082fe	7797a002-ada2-4193-8330-86d918f1edf0	2026-04-23 06:05:46.205643+00
ddc2351f-1c5b-4fba-8181-bee551f3f69a	1e2e4435-7c7b-4f13-898b-872f38a55ffd	523d9ccf-1d5e-4b9e-9c11-0c04d0665fe4	execution	7797a002-ada2-4193-8330-86d918f1edf0	f86b6c58-a954-4bfb-8ee6-5e99fae75c13	2026-04-23 06:05:46.205643+00
b453dce4-a725-41b6-bda6-3cf2c14c8a8f	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	d3b5e769-aae7-4301-b8ee-4cbf1bf1a083	eadcf2a3-a4ce-4033-bb95-ca5c6963112d	2026-04-23 06:05:46.205643+00
7f6771d8-c0c0-4033-ac7c-65a4b0c92b9f	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	eadcf2a3-a4ce-4033-bb95-ca5c6963112d	5f79b34c-bd71-4e35-9416-bfffd787337f	2026-04-23 06:05:46.205643+00
7d19e063-617b-4fb5-bc3e-17d4fa71f0b6	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	5f79b34c-bd71-4e35-9416-bfffd787337f	ba9082b5-a234-46b5-9ad1-3dab1c9fe6c4	2026-04-23 06:05:46.205643+00
06233706-3b2f-41b5-8c15-63b3b7691611	1e2e4435-7c7b-4f13-898b-872f38a55ffd	b72d35c6-0db1-45c4-bc67-89744427b645	execution	ba9082b5-a234-46b5-9ad1-3dab1c9fe6c4	09d809e6-8910-4116-acaf-82ca9dcb3045	2026-04-23 06:05:46.205643+00
75e27731-2830-449d-9ae1-b3d0bc32b8bc	1e2e4435-7c7b-4f13-898b-872f38a55ffd	e0ac39a8-e7d4-4d2a-8e6e-bb20db49943a	execution	8ef7f025-30d4-4a15-90ac-a9332f47e019	bac4ffb8-1164-4559-a34f-73adea517e8c	2026-04-23 06:05:46.205643+00
f60fea83-9a66-4ee9-89be-b576dc1d78da	1e2e4435-7c7b-4f13-898b-872f38a55ffd	e0ac39a8-e7d4-4d2a-8e6e-bb20db49943a	execution	bac4ffb8-1164-4559-a34f-73adea517e8c	b03971a4-80a4-4639-aabe-7f6641c5a852	2026-04-23 06:05:46.205643+00
cdef4845-5ee3-4376-9f14-39676b509eae	1e2e4435-7c7b-4f13-898b-872f38a55ffd	e0ac39a8-e7d4-4d2a-8e6e-bb20db49943a	execution	b03971a4-80a4-4639-aabe-7f6641c5a852	b2919fc3-3979-4a40-967c-d32b11ce1cdd	2026-04-23 06:05:46.205643+00
025ef38d-dda6-4313-b6f2-00c09e4310e1	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	26f52f81-976a-4f80-89d1-9951fe220767	1f387a62-41de-4919-934d-53d404dfc8d5	2026-04-23 06:06:00.889009+00
ffb6a7a9-0cd2-448b-b442-60482e1a98bd	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	1f387a62-41de-4919-934d-53d404dfc8d5	9f27cd91-fb1e-4181-984b-ea11382ffe30	2026-04-23 06:06:00.889009+00
e58aa806-949b-440e-a28b-031fe3a8cb76	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	9f27cd91-fb1e-4181-984b-ea11382ffe30	c7bad4f0-7461-46fc-9ad7-ed16eb84eed1	2026-04-23 06:06:00.889009+00
2c2c9941-8700-465d-b0ac-eb4d1e28af9e	2372603a-5775-46f7-8335-43dcde0a2a07	74773f25-ec5e-4310-bf1b-88d5e2bcbd04	portfolio	c7bad4f0-7461-46fc-9ad7-ed16eb84eed1	a619b4a8-ccfb-4d95-90eb-6becad5e95fa	2026-04-23 06:06:00.889009+00
086c2efa-61c8-4362-9ef4-e8c79d2d4c11	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	c31d1e31-c5c3-4397-8678-1c82582acbe7	7a249901-b379-48d2-b8c4-652c6882594a	2026-04-23 06:06:00.889009+00
73db6d69-c79f-4d1b-bce2-a9a0f15345d9	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	7a249901-b379-48d2-b8c4-652c6882594a	08cbd4e6-4271-470b-9f78-5e3ea5cdca64	2026-04-23 06:06:00.889009+00
307f5a27-2177-4f4c-8e74-6882e268ddb5	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	08cbd4e6-4271-470b-9f78-5e3ea5cdca64	360375a0-0cfb-4a3a-8c4c-b789441d5c9b	2026-04-23 06:06:00.889009+00
865ec01a-11c4-44a0-bf30-bdc52782db78	2372603a-5775-46f7-8335-43dcde0a2a07	0a0509ec-c69b-4d6b-9749-064f811bc18a	portfolio	360375a0-0cfb-4a3a-8c4c-b789441d5c9b	49f35c86-2563-4166-868b-81bf883bb4f6	2026-04-23 06:06:00.889009+00
54c9f5fd-f961-4665-95be-c256824d2068	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	73037da7-6c63-4922-94f2-eb19e28c58f8	a216625e-a93d-4d3e-b067-76768dd87a50	2026-04-23 06:06:00.889009+00
4ee656de-5009-4da0-a194-e9f87c9c5f11	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	a216625e-a93d-4d3e-b067-76768dd87a50	67e19e64-4d0e-4928-8ef6-775c0afb3c8c	2026-04-23 06:06:00.889009+00
9a451b7e-380d-40a0-a501-c73df118fe81	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	67e19e64-4d0e-4928-8ef6-775c0afb3c8c	a98a44fa-f75f-4bcf-a70f-0c3300a9f6ad	2026-04-23 06:06:00.889009+00
74ee570f-d682-48ac-94c6-ec5c75fda024	2372603a-5775-46f7-8335-43dcde0a2a07	1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	portfolio	a98a44fa-f75f-4bcf-a70f-0c3300a9f6ad	d6ec1b57-2412-4183-847e-97aec20a47a9	2026-04-23 06:06:00.889009+00
5efa4412-da1d-48b8-8acb-b7f719f5bef9	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	9a1a4560-8a83-4741-8936-cff382d469d0	f45077c1-5601-4124-955c-df9997f788bc	2026-04-23 06:06:00.889009+00
7d013daf-75f0-45c8-ab4b-f4332857fcb8	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	f45077c1-5601-4124-955c-df9997f788bc	a696e5d4-d73d-46ff-9143-dc950bc349cf	2026-04-23 06:06:00.889009+00
66e90794-88dd-479a-9e83-6ad8513693a9	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	a696e5d4-d73d-46ff-9143-dc950bc349cf	5137dd26-836c-4c2a-8a58-5f0b43a68157	2026-04-23 06:06:00.889009+00
9162a04c-40b6-4560-8005-576f5a01eb1e	2372603a-5775-46f7-8335-43dcde0a2a07	f70b6272-e3a6-4698-9c54-3672afc71dca	portfolio	5137dd26-836c-4c2a-8a58-5f0b43a68157	0d80c19e-e809-4432-b759-b086ecf6328f	2026-04-23 06:06:00.889009+00
085bbca1-ca80-4271-8890-94059e9b601a	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	fe8b2119-2c3f-4cc3-895a-5eea8d83aa1b	6367ba61-681e-4eec-8528-d12c61352bdd	2026-04-23 06:06:00.889009+00
8c0fb00b-22a3-4cab-bc7d-5e27e2f5a153	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	6367ba61-681e-4eec-8528-d12c61352bdd	40d80edc-a288-4af5-9008-8e7e4054db22	2026-04-23 06:06:00.889009+00
8ee457e9-f6d3-4a05-b798-2e56bca58ce8	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	40d80edc-a288-4af5-9008-8e7e4054db22	73868181-0dfb-4a3d-8b3b-aabf27be6bc4	2026-04-23 06:06:00.889009+00
d09c9416-d32d-45c6-b79f-4137cb3c7ee2	2372603a-5775-46f7-8335-43dcde0a2a07	a47b7aeb-6928-4739-9999-2c65dfdd8e4d	portfolio	73868181-0dfb-4a3d-8b3b-aabf27be6bc4	7f7f51de-0120-4f43-941a-25d2500581fa	2026-04-23 06:06:00.889009+00
7b6b2d5d-5f92-4c76-a0ad-dc7fe9aae2eb	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	5b4924ad-faa1-4237-9e26-c64c5869d87e	b8b4e841-b123-409b-8963-30251235709f	2026-04-23 06:06:00.889009+00
0061beb5-0f1e-45df-96b2-ebcdfaa5f237	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	b8b4e841-b123-409b-8963-30251235709f	b96189c1-33f3-4f00-aa9e-bd3b0c98fb9a	2026-04-23 06:06:00.889009+00
218081d4-34eb-4030-b292-916a18c1c3c6	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	b96189c1-33f3-4f00-aa9e-bd3b0c98fb9a	45295f59-7307-46e4-9106-e85053001516	2026-04-23 06:06:00.889009+00
42cdc23d-0d49-4ea6-a281-dfe008c24d19	2372603a-5775-46f7-8335-43dcde0a2a07	55eda00a-de92-48c9-8a43-a517839fde02	execution	45295f59-7307-46e4-9106-e85053001516	b3ea16eb-1c99-4d06-b414-b35748a52ef6	2026-04-23 06:06:00.889009+00
99791713-171e-4429-9b0f-f475a620c4be	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	2d07fdcb-e30f-4ae9-9a37-396887cb4823	3cb9a4cb-d74c-4b40-bdc4-0e3494691e26	2026-04-23 06:06:00.889009+00
e2274bc0-bf4d-40e6-a49e-5ca38fc2ef25	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	3cb9a4cb-d74c-4b40-bdc4-0e3494691e26	79bd165d-f076-4c80-a8d4-8b68203f57f0	2026-04-23 06:06:00.889009+00
177d3d82-2446-43ed-b8b6-5911ba30bd32	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	79bd165d-f076-4c80-a8d4-8b68203f57f0	613c8131-96e9-40d2-a673-f090a1f682fc	2026-04-23 06:06:00.889009+00
a37ed2ef-c460-4249-8e94-d0d898b50738	2372603a-5775-46f7-8335-43dcde0a2a07	868eb635-d6ff-4a0c-a9e4-684001e684cc	execution	613c8131-96e9-40d2-a673-f090a1f682fc	ac0b58e1-2d4f-48e5-81f8-ff3297487672	2026-04-23 06:06:00.889009+00
e1b70c30-a3ad-4964-a948-bb87b7ff64d3	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	b8b3fbab-af7b-44f9-bb18-c649ce692a6e	9c072d7e-3fbd-4794-a3f1-bff73c448ea2	2026-04-23 06:06:00.889009+00
6ce23ef2-1ffe-4796-ab63-a3b2939817f9	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	9c072d7e-3fbd-4794-a3f1-bff73c448ea2	4b6ebbad-1942-4df3-ab45-2c3253f342a6	2026-04-23 06:06:00.889009+00
818cf219-1587-4225-9597-2ba7606d4ba5	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	4b6ebbad-1942-4df3-ab45-2c3253f342a6	deaf0e39-2e1f-4adf-9cb5-250a734834da	2026-04-23 06:06:00.889009+00
8c7adc7e-a69b-477d-b283-d2e5a981f35e	2372603a-5775-46f7-8335-43dcde0a2a07	a2f81349-c33a-4748-9ba6-ab8df41b4b63	execution	deaf0e39-2e1f-4adf-9cb5-250a734834da	34c424fe-bd6c-496f-9891-783bce1a85f9	2026-04-23 06:06:00.889009+00
ab25382a-a40c-45a2-a786-d8c00fe67f94	2372603a-5775-46f7-8335-43dcde0a2a07	be44b997-91f0-4253-b79f-94c4361abcd7	execution	2bbbfa24-2d02-4583-ac5f-85e1a58a9324	d779317d-4037-45f8-9288-cdaeea115769	2026-04-23 06:06:00.889009+00
69907774-3bed-431d-b31f-98ef52aa7553	2372603a-5775-46f7-8335-43dcde0a2a07	be44b997-91f0-4253-b79f-94c4361abcd7	execution	d779317d-4037-45f8-9288-cdaeea115769	b9f59dd1-e2e5-416e-8ed1-1fc4ead03239	2026-04-23 06:06:00.889009+00
7e095e60-b83f-4a3b-8a6f-d891651f6449	2372603a-5775-46f7-8335-43dcde0a2a07	be44b997-91f0-4253-b79f-94c4361abcd7	execution	b9f59dd1-e2e5-416e-8ed1-1fc4ead03239	a236a35c-ccdb-4823-87d8-00b9c3901a91	2026-04-23 06:06:00.889009+00
27a7400c-487e-44d3-8331-95b1349c0cd7	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	e77e898b-cde4-4fdc-a749-d76908ecb51a	2c156a06-6253-47d4-819a-2317f8f24354	2026-04-23 06:06:02.598873+00
108655d7-3457-4c54-9253-b3d213dcc503	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	2c156a06-6253-47d4-819a-2317f8f24354	8d864134-e829-4ef1-8d89-1dca7f989586	2026-04-23 06:06:02.598873+00
b8e039be-849a-4f2f-9c90-d1da2aa1a3fc	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	8d864134-e829-4ef1-8d89-1dca7f989586	0d7226c0-3f94-4848-b4b0-88d8318b3d91	2026-04-23 06:06:02.598873+00
35dbdbb4-3faf-4806-83e1-9e9a9c0b6679	10cc89f7-0092-4267-9b90-0bce22d1edab	0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	portfolio	0d7226c0-3f94-4848-b4b0-88d8318b3d91	1d5c5727-16d8-4f83-97bb-d5a5cdf04270	2026-04-23 06:06:02.598873+00
d6883627-ae36-45b0-9e66-102380b847c7	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	b262aa61-900d-4722-a25f-fe35ceb2fb22	82c3e3d0-dd05-4ef5-a991-e512d7c165a5	2026-04-23 06:06:02.598873+00
7a9f023d-d9a3-4ba6-959c-c496d4b49222	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	82c3e3d0-dd05-4ef5-a991-e512d7c165a5	4c6b8cca-d99a-4445-80e3-817cf8f23e5d	2026-04-23 06:06:02.598873+00
77634d08-c40d-4965-8131-c8b61f8da49e	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	4c6b8cca-d99a-4445-80e3-817cf8f23e5d	c6920e75-e7a2-4f0d-a926-7407f59ac993	2026-04-23 06:06:02.598873+00
d0d126aa-6c59-4735-bc2c-e3ba57aaf7eb	10cc89f7-0092-4267-9b90-0bce22d1edab	5e90fd21-b930-487f-9b2d-fa1605678618	portfolio	c6920e75-e7a2-4f0d-a926-7407f59ac993	259f0cc8-a578-46c2-8eb2-bfcbbf083eef	2026-04-23 06:06:02.598873+00
3d4bcdaf-a025-47c6-adb4-ada2af53223e	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	4c14bd77-a66a-49f4-8714-27b261e87290	47baeea1-781b-47a5-ba1f-b88dc13ddeee	2026-04-23 06:06:02.598873+00
cbb51d2a-0578-4895-83be-5e7aaa7cb4e1	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	47baeea1-781b-47a5-ba1f-b88dc13ddeee	1c5f85c0-3e7a-47ea-91a8-f7ea7e1eef5b	2026-04-23 06:06:02.598873+00
9fed3439-edea-4cee-9d85-effb492c01d7	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	1c5f85c0-3e7a-47ea-91a8-f7ea7e1eef5b	b7e84795-578f-40eb-a997-1127ac999dbe	2026-04-23 06:06:02.598873+00
112e289d-a073-496a-aef9-3647c872125f	10cc89f7-0092-4267-9b90-0bce22d1edab	603ab5aa-686f-4b7d-8db4-db612c66bd39	portfolio	b7e84795-578f-40eb-a997-1127ac999dbe	69537d2b-cfca-4ace-ba1d-e36773224a88	2026-04-23 06:06:02.598873+00
39914d95-e3e6-4617-b95c-35108c6827f6	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	296f7c68-c500-4ad8-b8b4-3133508f97a6	95f2ecb4-349a-4962-938e-37866d1e0510	2026-04-23 06:06:02.598873+00
df2addd3-985c-4326-9141-14998bccc92c	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	95f2ecb4-349a-4962-938e-37866d1e0510	1b342be9-39df-498a-8730-f914143a8a0b	2026-04-23 06:06:02.598873+00
c8c36000-bd91-4c98-8d60-80c94d72d86a	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	1b342be9-39df-498a-8730-f914143a8a0b	09dbc207-b5ad-483a-bc93-2f9d327a8273	2026-04-23 06:06:02.598873+00
cd033835-b241-4247-9be8-7179e1baf5e5	10cc89f7-0092-4267-9b90-0bce22d1edab	da057211-0f35-4cc4-988d-0fa3d577e314	portfolio	09dbc207-b5ad-483a-bc93-2f9d327a8273	50634c87-406c-442b-bc0c-e03a7bad80a6	2026-04-23 06:06:02.598873+00
63760651-b1b7-4ba3-b4c6-35763b6d3f9f	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	20aaa234-a2e7-42c1-a2be-fb54b20adeff	241163f8-dd34-4a2f-9861-70419d4625e4	2026-04-23 06:06:02.598873+00
34a982ad-5216-436f-b5d4-a55784c51307	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	241163f8-dd34-4a2f-9861-70419d4625e4	512f26be-2722-4203-ac12-f55213785e5d	2026-04-23 06:06:02.598873+00
58973f66-5fb6-4782-82a1-d6cd5e813dee	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	512f26be-2722-4203-ac12-f55213785e5d	0212e464-7f3b-4eeb-ae4b-8353a7b4dfb4	2026-04-23 06:06:02.598873+00
4b2ee549-87d6-41ad-9839-bf3ede7d7f64	10cc89f7-0092-4267-9b90-0bce22d1edab	74a53a41-9e3a-4466-b267-ca94be3597af	portfolio	0212e464-7f3b-4eeb-ae4b-8353a7b4dfb4	7a807c44-f3a4-4016-ac2a-ab4a1bab05ea	2026-04-23 06:06:02.598873+00
8accccd9-bc37-4950-9513-b9a3f335fb58	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	58ff79e8-f6b8-4073-ad92-535b904d9898	63858b25-54ed-4ad7-9cca-cd864ecc0644	2026-04-23 06:06:02.598873+00
e1130cce-c367-4577-a263-bf396337041f	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	63858b25-54ed-4ad7-9cca-cd864ecc0644	53082fd4-cc69-4a81-b921-d7496680d146	2026-04-23 06:06:02.598873+00
a7e2aeba-18fa-4d52-8d46-e5764332e974	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	53082fd4-cc69-4a81-b921-d7496680d146	029298ed-0b29-4bc5-b2ee-38af5335170f	2026-04-23 06:06:02.598873+00
a0d11932-d851-4569-a92c-def037f528bc	10cc89f7-0092-4267-9b90-0bce22d1edab	eb6ae363-0250-49a5-b85d-aad4f533ca53	execution	029298ed-0b29-4bc5-b2ee-38af5335170f	a2632047-8a1b-4976-8782-f831e4e80450	2026-04-23 06:06:02.598873+00
603d8078-cba8-4f89-873a-ab3f585c5e81	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	50944fb9-d96d-4ecd-b6dc-37e47d586076	8997a5c8-5bc9-410d-91e7-b02a097d7a96	2026-04-23 06:06:02.598873+00
0bc91030-a8a7-41bb-9db2-902cf5a2f7bf	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	8997a5c8-5bc9-410d-91e7-b02a097d7a96	a0191457-7714-4481-a181-30edd3ea17ee	2026-04-23 06:06:02.598873+00
01924e48-e0e3-4433-85d9-caa14e8eb4b0	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	a0191457-7714-4481-a181-30edd3ea17ee	c84a3ea3-7305-428c-9c64-78a8d185f6ca	2026-04-23 06:06:02.598873+00
36012af3-4c18-4b1e-826a-a415beeb97b0	10cc89f7-0092-4267-9b90-0bce22d1edab	2b52e241-277f-4e81-a3b0-124bf89a4772	execution	c84a3ea3-7305-428c-9c64-78a8d185f6ca	8c77c412-10e4-4582-ba6e-250799435c9e	2026-04-23 06:06:02.598873+00
512c08dd-519e-4a98-93a5-eb5fa9691cc0	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	d4569602-554d-4e6c-b09f-bbfd2fe254ac	f59483ac-e7c7-4b66-8f8b-30f069e892f0	2026-04-23 06:06:02.598873+00
0dbbb183-67d4-41d5-8948-da6e2cc8d245	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	f59483ac-e7c7-4b66-8f8b-30f069e892f0	e3edec4b-4b60-41fe-8ab2-7506236dac3d	2026-04-23 06:06:02.598873+00
d1fda742-f320-4345-ad9b-a5cae2a1fb89	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	e3edec4b-4b60-41fe-8ab2-7506236dac3d	f4c405db-39db-481c-8787-345d6f473e76	2026-04-23 06:06:02.598873+00
f6ffdf41-4c20-47f1-abcc-dea64d68a902	10cc89f7-0092-4267-9b90-0bce22d1edab	4957290a-5d6c-45b5-88b1-4cbeb8bf8bdc	execution	f4c405db-39db-481c-8787-345d6f473e76	8352ccbb-b18f-4f63-a81b-6f1f779f2b15	2026-04-23 06:06:02.598873+00
07002437-cfa4-4097-ac35-aba50807f131	10cc89f7-0092-4267-9b90-0bce22d1edab	c5ce4402-e020-49a1-971a-a6a1c41e606d	execution	44db02bb-aba4-4996-b2f0-b8353368c068	0196769d-911b-4242-8cfe-3ca5e9bc6010	2026-04-23 06:06:02.598873+00
9b8dfe18-4918-4fbf-a42c-2d0efcb15a14	10cc89f7-0092-4267-9b90-0bce22d1edab	c5ce4402-e020-49a1-971a-a6a1c41e606d	execution	0196769d-911b-4242-8cfe-3ca5e9bc6010	2aba91e2-5e50-4e71-80f9-119d28978c0e	2026-04-23 06:06:02.598873+00
c79b8344-734a-4bda-9397-2fef15988fe4	10cc89f7-0092-4267-9b90-0bce22d1edab	c5ce4402-e020-49a1-971a-a6a1c41e606d	execution	2aba91e2-5e50-4e71-80f9-119d28978c0e	973a3d8f-4a48-49fa-adb7-b4c69aea461f	2026-04-23 06:06:02.598873+00
884af434-8431-4682-a4cd-0c4f21838a21	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	fad01d20-c726-424b-abe0-417b7c416808	d1a9217f-af95-47fe-b5c2-ffbd3bfe21fd	2026-04-23 06:06:03.316659+00
a45c3452-02e4-4ef7-84d8-f37ffb24f8d8	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	d1a9217f-af95-47fe-b5c2-ffbd3bfe21fd	8e8b1b59-7da9-45d1-9655-fe201d291ce6	2026-04-23 06:06:03.316659+00
01aae5f0-2b3c-4921-8dc8-1606ade623d5	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	8e8b1b59-7da9-45d1-9655-fe201d291ce6	c01c14e1-321f-4d8b-a277-bd8ce9af8041	2026-04-23 06:06:03.316659+00
7156d2a1-9f2d-4532-9801-d3e5e8827de9	f936845a-e36a-459b-9b4b-dd5bddf1443e	dc4c8d24-5a5a-431b-8563-711d42904ca5	portfolio	c01c14e1-321f-4d8b-a277-bd8ce9af8041	e033914c-a034-447c-a5fb-21fac645737f	2026-04-23 06:06:03.316659+00
495abdef-3518-4dd0-9cb1-e7e4a0ca882d	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	f806ccec-32b1-455c-9c70-bd6c9a206484	ff77b8eb-4ef7-486b-8eaf-b9f2ed15be17	2026-04-23 06:06:03.316659+00
1f0a3297-0ceb-449c-8aa2-949301494813	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	ff77b8eb-4ef7-486b-8eaf-b9f2ed15be17	2bccf1c0-2fe3-46bd-b1fc-5210dd202b78	2026-04-23 06:06:03.316659+00
ab45a31d-1b92-4a90-879f-9787ae54efa1	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	2bccf1c0-2fe3-46bd-b1fc-5210dd202b78	417611cd-63af-47e4-9aae-b698c745a446	2026-04-23 06:06:03.316659+00
2ded9f01-bf0c-474f-b79f-eacdec2521f5	f936845a-e36a-459b-9b4b-dd5bddf1443e	ed7dc14a-af12-48d0-b0db-7a6d85a1565a	portfolio	417611cd-63af-47e4-9aae-b698c745a446	8dace650-3564-426a-ba69-ec60c3cd0560	2026-04-23 06:06:03.316659+00
6c42fa94-d64f-44c0-a390-ad95791078fa	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	43486973-0930-4bbb-ad16-b210b4166495	7f892bf3-58df-46a7-a5f0-668652b702a1	2026-04-23 06:06:03.316659+00
15221ee9-bf1d-4e79-a2aa-dc40f2f4a307	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	7f892bf3-58df-46a7-a5f0-668652b702a1	535bf44f-cd63-44dd-9a32-c55c97382995	2026-04-23 06:06:03.316659+00
7f343147-bb49-457b-b04e-0b5a27ea2c0a	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	535bf44f-cd63-44dd-9a32-c55c97382995	f0ad5a9d-2a8b-4e6b-8c9f-5faef40b7f3c	2026-04-23 06:06:03.316659+00
949f4777-78bf-4c0a-95cc-876987d289b2	f936845a-e36a-459b-9b4b-dd5bddf1443e	cf8c784e-7bdf-4519-96d2-7492df3781fd	portfolio	f0ad5a9d-2a8b-4e6b-8c9f-5faef40b7f3c	cbad8aee-f829-4c57-bcfc-ebf1c6b08ff0	2026-04-23 06:06:03.316659+00
e051d36d-b345-4a90-bacc-aad7dc18db1f	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	64d4e218-0cc3-4ca4-b7de-344950563e23	5e6a5da6-3e31-4a91-823e-dc8ec72fc0a1	2026-04-23 06:06:03.316659+00
92efd80e-b3fe-4112-bf4c-7df32bbe074e	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	5e6a5da6-3e31-4a91-823e-dc8ec72fc0a1	45ce9b40-5349-42b8-911d-3d6195b4c4ec	2026-04-23 06:06:03.316659+00
e36d421f-f988-4344-b8a8-b8dbdf80e867	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	45ce9b40-5349-42b8-911d-3d6195b4c4ec	bc76c6b6-526c-4bc3-aa48-e821e26a6918	2026-04-23 06:06:03.316659+00
6e047b98-73af-44e0-b63b-0ae7d542abfb	f936845a-e36a-459b-9b4b-dd5bddf1443e	eaf28bde-29b3-4ce7-a325-ccb286e905f3	portfolio	bc76c6b6-526c-4bc3-aa48-e821e26a6918	fd6ffee9-eccf-41d8-af5e-ac8f7264588c	2026-04-23 06:06:03.316659+00
90b9784c-0b09-4b0e-a2b0-d144eeb747b9	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	5b5fdfd2-5100-46ec-a1c3-c7752a83d6a2	e2750c56-5076-4339-8e2e-618bd51c76fc	2026-04-23 06:06:03.316659+00
727b0f6f-01b0-427c-9e0b-3814bcd1e6e4	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	e2750c56-5076-4339-8e2e-618bd51c76fc	02df3f8b-8119-4ceb-b0ac-d388abfb006c	2026-04-23 06:06:03.316659+00
fd9bbd97-56c2-46ed-bea1-cb36c9bacc71	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	02df3f8b-8119-4ceb-b0ac-d388abfb006c	8d5a18ea-2048-4893-b774-6e47ffafd205	2026-04-23 06:06:03.316659+00
1e3a7c20-af57-4283-83f6-82c1647ec8b5	f936845a-e36a-459b-9b4b-dd5bddf1443e	f4d76b7b-ecb9-4c48-aac5-68e47eb13885	portfolio	8d5a18ea-2048-4893-b774-6e47ffafd205	b253bdb2-edbb-4d7f-9493-bac9c2b99139	2026-04-23 06:06:03.316659+00
3950c297-7c7d-44f8-a630-e693dd9a690d	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	05487a8a-9ee5-4a53-9cba-538a48a419c5	cb724dc3-fb0f-4fd1-b037-0eb6fbe1e3e7	2026-04-23 06:06:03.316659+00
e6afc970-7dfc-4d6c-a59f-b93af207abea	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	cb724dc3-fb0f-4fd1-b037-0eb6fbe1e3e7	c4142bb5-8b81-49a3-b3fd-c32b2c116867	2026-04-23 06:06:03.316659+00
5200ab34-bc6a-4f58-b9e6-a3fd3445300e	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	c4142bb5-8b81-49a3-b3fd-c32b2c116867	a1420fcd-8253-4444-af58-45bc1f22057c	2026-04-23 06:06:03.316659+00
bf18147f-2abb-4ef2-a9b7-940cf9fe3c21	f936845a-e36a-459b-9b4b-dd5bddf1443e	7e807a8e-3225-4173-9d1e-943c02caa407	execution	a1420fcd-8253-4444-af58-45bc1f22057c	b62b68bd-5a3a-45d1-a080-1499aab9fc21	2026-04-23 06:06:03.316659+00
86454962-60c4-4e0f-8bad-b97860c17058	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	47fb0387-b56f-4bd4-9ff1-d7bf79d01a19	fd24b950-3ee0-423a-85f4-270ed50d5c61	2026-04-23 06:06:03.316659+00
fd57f8d5-8537-4b00-9a69-7e6145d72a28	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	fd24b950-3ee0-423a-85f4-270ed50d5c61	906f837e-af48-4cb9-84a3-7911973d0f9b	2026-04-23 06:06:03.316659+00
043e4714-13b2-416f-8196-248c88f87bb7	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	906f837e-af48-4cb9-84a3-7911973d0f9b	63a1aef8-4d3b-41e4-8df6-0410066206d9	2026-04-23 06:06:03.316659+00
43c1f78b-f3e8-49d2-85a1-2611b0b3f996	f936845a-e36a-459b-9b4b-dd5bddf1443e	c5015cce-50b1-40d5-8813-457076334b5e	execution	63a1aef8-4d3b-41e4-8df6-0410066206d9	bbeca720-3169-40e9-84f3-c4c9f87c7099	2026-04-23 06:06:03.316659+00
f5024a78-55a8-426d-9eb9-dab86a44a1e9	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	7811e9d3-187a-4cfd-8289-e5403c7565ea	03a4c4f1-22f7-4db1-809a-66c411175b94	2026-04-23 06:06:03.316659+00
4d010abe-3e9b-4a03-a121-00d709b258c6	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	03a4c4f1-22f7-4db1-809a-66c411175b94	e2bbfcbd-8be7-4860-9e4b-dfed0e2e6813	2026-04-23 06:06:03.316659+00
29d87abb-6453-4df3-acd5-22ea1b26ed9b	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	e2bbfcbd-8be7-4860-9e4b-dfed0e2e6813	69c589fe-03ea-4107-8e9f-3dfe0cc9a872	2026-04-23 06:06:03.316659+00
f7ed324f-7902-4765-8b63-d76895bee9ba	f936845a-e36a-459b-9b4b-dd5bddf1443e	a2342136-2a6a-4b9f-87f7-0475737a8271	execution	69c589fe-03ea-4107-8e9f-3dfe0cc9a872	87887ed8-dae6-40b0-be84-0d1f52c1d841	2026-04-23 06:06:03.316659+00
dea29e52-56d6-441c-8a08-6d7781c8d593	f936845a-e36a-459b-9b4b-dd5bddf1443e	fae18c8f-5591-4bcf-9870-b83bb30f9fcf	execution	627902b1-b4be-49a2-ba43-daba1cbc05e7	b359a71c-5b2b-439c-ac8c-524cd7e8379d	2026-04-23 06:06:03.316659+00
6d06d0c6-680c-42cd-a147-252be51b8c86	f936845a-e36a-459b-9b4b-dd5bddf1443e	fae18c8f-5591-4bcf-9870-b83bb30f9fcf	execution	b359a71c-5b2b-439c-ac8c-524cd7e8379d	40be9a04-335c-456e-8f82-94d291922c54	2026-04-23 06:06:03.316659+00
13be4bdc-fa4b-48c9-96a6-59416925d59d	f936845a-e36a-459b-9b4b-dd5bddf1443e	fae18c8f-5591-4bcf-9870-b83bb30f9fcf	execution	40be9a04-335c-456e-8f82-94d291922c54	f96a673f-16a7-43ea-b8e9-8102e892fd00	2026-04-23 06:06:03.316659+00
9bd37c2c-2f14-4790-985c-74f5c11fbd35	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	a6cf303f-5f40-4a23-a5fa-108b71219508	c6a56ce2-7574-40a8-be5b-55d867b0acb3	2026-04-24 22:12:48.185961+00
25de9f58-a77d-45d7-b4ed-d5860ca7271a	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	c6a56ce2-7574-40a8-be5b-55d867b0acb3	bae41b69-d42c-4cd7-9c0b-81be6ed70d87	2026-04-24 22:12:48.185961+00
8f87bc2e-4d42-4141-b931-bc4da7e8909f	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	bae41b69-d42c-4cd7-9c0b-81be6ed70d87	49053485-b0f3-4948-9b6f-f16c5f232393	2026-04-24 22:12:48.185961+00
6672b0d0-90e4-4d39-a2d3-f45ed97849d1	96c676b2-8388-49bd-8fc1-e4adba6e8831	8e8b9e71-b893-4bcd-9adf-5b735677b059	portfolio	49053485-b0f3-4948-9b6f-f16c5f232393	96c1144b-3b70-41e6-acae-644803d58da1	2026-04-24 22:12:48.185961+00
219dd048-fa64-461e-ad73-49e8385a808a	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	99b34858-b3d6-49f6-9e50-e9e3f66b7d71	529c112d-84fa-4827-aab7-f393f9eada63	2026-04-24 22:12:48.185961+00
bc17c555-cfc5-4c75-8964-d6e09d499f47	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	529c112d-84fa-4827-aab7-f393f9eada63	cb6cd589-2ce9-4ec4-8543-5fcb1d435379	2026-04-24 22:12:48.185961+00
08124f61-3e13-4ecc-a99f-fdda70060591	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	cb6cd589-2ce9-4ec4-8543-5fcb1d435379	a52ffd61-4711-4171-aef0-eb5fb284be80	2026-04-24 22:12:48.185961+00
2479597b-0d71-4100-9313-797f50f5b071	96c676b2-8388-49bd-8fc1-e4adba6e8831	b442b1b8-01bd-49fd-8763-ec848b4090ba	portfolio	a52ffd61-4711-4171-aef0-eb5fb284be80	75a53914-87ae-494b-815e-0c86f70e6397	2026-04-24 22:12:48.185961+00
6027661c-0cce-4e0a-90de-82cc4e37eec8	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	d873f114-6801-479b-b558-5859b82b63e8	c6091ea9-bd2c-4b14-85d6-e09f2b2447d5	2026-04-24 22:12:48.185961+00
13e28d5e-8e80-4cc7-a9d2-420b7676e386	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	c6091ea9-bd2c-4b14-85d6-e09f2b2447d5	c4441cd9-6411-48a7-b5bb-56815a1a2640	2026-04-24 22:12:48.185961+00
4e06ac95-a31a-477b-8b2c-0f4bcaae2082	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	c4441cd9-6411-48a7-b5bb-56815a1a2640	5dbcbc88-4ff7-422d-9cc3-f675b55e8097	2026-04-24 22:12:48.185961+00
d8214f88-7670-453a-bf5b-7cd1488710e4	96c676b2-8388-49bd-8fc1-e4adba6e8831	9ce3ea52-3ae5-4be0-952c-196d3631749f	portfolio	5dbcbc88-4ff7-422d-9cc3-f675b55e8097	fecca3e5-fbcb-4147-92cc-d6468b23b135	2026-04-24 22:12:48.185961+00
1696f98e-8977-401c-86b7-0d57e1bcc337	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	511f600f-dca1-4356-9a1a-239f3363eff0	fb524beb-444d-4754-bce2-fb53c326ae88	2026-04-24 22:12:48.185961+00
2fc08b65-56aa-4a3a-acf7-c9c9fd92e567	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	fb524beb-444d-4754-bce2-fb53c326ae88	39e0a89f-a693-48cc-ae5a-528ca271db13	2026-04-24 22:12:48.185961+00
f1f991e0-d4ff-4413-8117-87a516e0cfc5	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	39e0a89f-a693-48cc-ae5a-528ca271db13	5f9cfbef-f9d0-41de-8eed-cfd2e62cbea0	2026-04-24 22:12:48.185961+00
091e0e62-13b3-492b-a3d0-99e353020cd5	96c676b2-8388-49bd-8fc1-e4adba6e8831	466dcd02-5519-4bd1-b896-3678c248788b	portfolio	5f9cfbef-f9d0-41de-8eed-cfd2e62cbea0	fc0ca3e6-7413-419a-b3f1-6b68f7df14a9	2026-04-24 22:12:48.185961+00
5b855c99-67d5-46ba-8e33-0d94550f294d	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	1c6bee71-572b-405c-b4b2-ac7a0025d9a9	4e3de2fd-a80f-4c2d-967a-2d0232298e29	2026-04-24 22:12:48.185961+00
42fb7afb-16b2-44bd-9a99-97d575455e82	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	4e3de2fd-a80f-4c2d-967a-2d0232298e29	1cfc8249-da7d-4fad-b937-a776445512e8	2026-04-24 22:12:48.185961+00
4e67c6a0-1361-42e1-afe2-ad177171ed97	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	1cfc8249-da7d-4fad-b937-a776445512e8	e0b42571-53c2-449c-9079-8c7d94f6a29c	2026-04-24 22:12:48.185961+00
3001d59f-9d89-4eb0-84a2-78498423bb2d	96c676b2-8388-49bd-8fc1-e4adba6e8831	031f78f0-5e95-4f50-98fd-303b86394b95	portfolio	e0b42571-53c2-449c-9079-8c7d94f6a29c	54bb81c7-38e7-413b-9587-742b6e9dc18a	2026-04-24 22:12:48.185961+00
0f5442c4-d3d2-421f-a02e-1f3494187af0	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	01779125-bac1-4809-8575-6ed47e0358c9	12eafef9-949f-4b53-8266-839d99e4b498	2026-04-24 22:12:48.185961+00
a43d14af-9ef1-4fab-aa97-ec66d3108abb	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	12eafef9-949f-4b53-8266-839d99e4b498	3c1fe9b4-7cc4-4c24-90a6-01e73302ab05	2026-04-24 22:12:48.185961+00
7ad0a1ea-5068-41ac-aefa-9b63341e1a19	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	3c1fe9b4-7cc4-4c24-90a6-01e73302ab05	a7252490-ce0a-403b-9b23-15c791ea44a0	2026-04-24 22:12:48.185961+00
dd7fa538-3dfd-40f7-90ab-209f7b183315	96c676b2-8388-49bd-8fc1-e4adba6e8831	bff9dee3-0473-4dd7-b728-b4891ad31366	execution	a7252490-ce0a-403b-9b23-15c791ea44a0	8e95f6a0-111f-4ee8-ba58-8db753b53241	2026-04-24 22:12:48.185961+00
a460eda8-8910-4a03-9fc2-8c11d253db37	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	3942b380-7b45-40f5-adbc-8a4f07b64d88	317e32cc-385d-4836-a156-03b6653da0b0	2026-04-24 22:12:48.185961+00
be58d9e5-857d-4eea-80b2-37867ac35bb3	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	317e32cc-385d-4836-a156-03b6653da0b0	7dc20b22-8539-4e53-adbe-2c5ee0abbc42	2026-04-24 22:12:48.185961+00
112c547d-c727-4977-bee6-d7f8039e3966	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	7dc20b22-8539-4e53-adbe-2c5ee0abbc42	dcd0de90-6b41-4617-8f40-f0a5fe1e8f64	2026-04-24 22:12:48.185961+00
92732034-5be3-42e9-9ea1-81d2ff84e8dd	96c676b2-8388-49bd-8fc1-e4adba6e8831	c5daf7d8-4126-4d19-80ae-94c903b1bfcb	execution	dcd0de90-6b41-4617-8f40-f0a5fe1e8f64	f316b5a3-4c6d-42b2-a7dd-66160649b956	2026-04-24 22:12:48.185961+00
31e5c7e5-a85e-46ce-8719-a62eceb99a1f	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	29962df7-8f69-4b89-a901-e1c890a75aad	f9c8fa41-ed99-496a-b0e1-391e63a3e54c	2026-04-24 22:12:48.185961+00
bc83f5e8-f868-402b-bb09-eba43347c2b4	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	f9c8fa41-ed99-496a-b0e1-391e63a3e54c	efa854a1-73b2-425e-92d3-255784c83be1	2026-04-24 22:12:48.185961+00
7fab5d34-2e75-4e71-a7f4-cc4284a31e20	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	efa854a1-73b2-425e-92d3-255784c83be1	739b22f1-122b-49ad-a53d-8e72b3c4fddd	2026-04-24 22:12:48.185961+00
66d7a2a5-5d29-4107-ac4a-3cb2d3abb69c	96c676b2-8388-49bd-8fc1-e4adba6e8831	a7cd51b3-bc8a-43ad-8e80-8d981c7df9ee	execution	739b22f1-122b-49ad-a53d-8e72b3c4fddd	983c527a-9ace-4c07-a634-3bf4e8f56d3d	2026-04-24 22:12:48.185961+00
f9645887-db53-47b7-8189-0d0567d23215	96c676b2-8388-49bd-8fc1-e4adba6e8831	1b4adcb8-72a6-473d-bd46-26ad1eaa9991	execution	0e32c726-e36f-4c95-85ff-28342e8fcc02	6bd892b9-15a2-48b5-9b93-3450a49dd0bb	2026-04-24 22:12:48.185961+00
0c352841-d991-4b43-98db-e9c324355053	96c676b2-8388-49bd-8fc1-e4adba6e8831	1b4adcb8-72a6-473d-bd46-26ad1eaa9991	execution	6bd892b9-15a2-48b5-9b93-3450a49dd0bb	3d5f64fd-ad85-4d7e-a98c-2aedbc2c23b9	2026-04-24 22:12:48.185961+00
a0e264cc-9f24-4fed-84f1-3f58ae3c6460	96c676b2-8388-49bd-8fc1-e4adba6e8831	1b4adcb8-72a6-473d-bd46-26ad1eaa9991	execution	3d5f64fd-ad85-4d7e-a98c-2aedbc2c23b9	1828a399-b0ce-4ce1-8b4d-38a3432429d8	2026-04-24 22:12:48.185961+00
9e8c3f2a-5007-4194-be7e-33492854d738	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	254c16ce-9f7c-453f-b0a1-14724d587c49	f48a18a2-d2c9-47f7-8538-f54e88bbbad4	2026-04-24 22:12:48.887502+00
9ecbdbc7-1c74-451d-bf0b-a7398ea561d8	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	f48a18a2-d2c9-47f7-8538-f54e88bbbad4	693a9fcf-5bde-44fb-af44-badf6136e99c	2026-04-24 22:12:48.887502+00
212b0c31-6f66-4315-b70e-35f3c349c4b9	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	693a9fcf-5bde-44fb-af44-badf6136e99c	b4d86c71-e716-429e-91ec-0e9ba1e2e370	2026-04-24 22:12:48.887502+00
2387703c-92b3-4dd1-a1a4-c175e055ce33	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	32bd7080-9014-4b73-93c5-46e57c61581a	portfolio	b4d86c71-e716-429e-91ec-0e9ba1e2e370	345529be-93ae-430e-b770-d2adfb7a3932	2026-04-24 22:12:48.887502+00
527168f1-4cf7-41cd-9fb2-43c6e02db57b	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	061d2643-0738-4942-b488-75e8aa41100c	fce236cf-1bb2-4663-a658-5fbcbb14f302	2026-04-24 22:12:48.887502+00
73d2a812-a185-4b86-8066-7e1410127734	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	fce236cf-1bb2-4663-a658-5fbcbb14f302	112b84a1-d18b-4494-98cf-66f49a1867d4	2026-04-24 22:12:48.887502+00
fb53cded-03a8-4ac6-b210-5a8bc6e95a3b	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	112b84a1-d18b-4494-98cf-66f49a1867d4	3bf93654-c2ab-4d60-8815-b3c7415f0f68	2026-04-24 22:12:48.887502+00
5fccc0a9-5d01-4dc3-83a7-aff8b6709f74	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	portfolio	3bf93654-c2ab-4d60-8815-b3c7415f0f68	e39832fd-eac0-4335-a81f-b85ce6d79c61	2026-04-24 22:12:48.887502+00
f5cf0dfb-4c5f-4854-9605-90eefcfee25a	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	a010372b-5b70-4b27-907e-fdd652f5bb1c	268b689d-3d35-4424-9ba2-4e7b66c05e80	2026-04-24 22:12:48.887502+00
ad1dd0fa-c571-4a1e-927c-93a410f8f3db	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	268b689d-3d35-4424-9ba2-4e7b66c05e80	8940b26e-a7de-4e47-a274-1e3d30fda6a5	2026-04-24 22:12:48.887502+00
47b1634d-2dd4-4350-b148-0360d69c1327	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	8940b26e-a7de-4e47-a274-1e3d30fda6a5	31e3f0cc-33ba-43c7-8d16-db557a927cc2	2026-04-24 22:12:48.887502+00
b9c6d7d9-d3ef-4f83-9f08-46f9c3259d12	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	3709bf8b-b40a-4919-9b93-6ef98f3f4199	portfolio	31e3f0cc-33ba-43c7-8d16-db557a927cc2	4da66aea-1662-40f8-bcba-e55ce796f624	2026-04-24 22:12:48.887502+00
2a0d2b76-1b7a-483e-b6af-612d0f651757	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	d83bf882-69fe-44b6-bd70-e0b1781263f2	b148b322-63f3-4721-ab3b-85c76199f2d0	2026-04-24 22:12:48.887502+00
8eb530eb-00b8-4ad8-a72e-c309fcd84976	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	b148b322-63f3-4721-ab3b-85c76199f2d0	600f1a7f-29cd-4898-89b7-f1ad9caa534c	2026-04-24 22:12:48.887502+00
9a584b46-d444-4645-ab7d-9f700b915b92	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	600f1a7f-29cd-4898-89b7-f1ad9caa534c	e1bbbeaa-9462-4645-95bb-880a38cfdd4b	2026-04-24 22:12:48.887502+00
02e7c19d-d847-4e5c-bc87-ebcc55f896cc	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	44b7f512-e019-4eef-98c6-1aad1d537c22	portfolio	e1bbbeaa-9462-4645-95bb-880a38cfdd4b	fe924a31-622c-4835-a4ea-2a590e9b743e	2026-04-24 22:12:48.887502+00
4d4ef5d5-062c-4e9f-a92d-bd2cba9771b1	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	f4936f46-5606-4cf7-bae4-33273f525443	f1d38220-6e5e-4f33-8c82-34edb57e6786	2026-04-24 22:12:48.887502+00
801fddf5-19fb-48a9-8df9-3ae365de5568	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	f1d38220-6e5e-4f33-8c82-34edb57e6786	077e31ec-a36d-45c2-bb41-f7389efb4aa9	2026-04-24 22:12:48.887502+00
77409876-1a63-482b-9420-72e15690cc22	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	d5461ed3-bceb-4180-8c8e-5177007789eb	8bb272c0-beea-4e35-9f52-fb5c369a943e	2026-04-23 06:06:04.398317+00
75e3c4b6-3f09-46b5-b1b0-ebcf4df10fc2	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	8bb272c0-beea-4e35-9f52-fb5c369a943e	dc06e71e-0ac5-4d6e-851b-31d7eb757536	2026-04-23 06:06:04.398317+00
e169c250-3d64-47b8-859d-e456d5e150cc	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	dc06e71e-0ac5-4d6e-851b-31d7eb757536	1171abb9-d241-4c72-a2d3-3fca6167dbd4	2026-04-23 06:06:04.398317+00
e2169d09-b271-434c-9a69-c78fec117353	876093ad-808b-47be-ae6c-e6705d7e57b1	1af01e55-f68d-4d49-b0b6-218c6d2f879f	portfolio	1171abb9-d241-4c72-a2d3-3fca6167dbd4	054289ef-1397-43c9-ae5d-26072b5607c7	2026-04-23 06:06:04.398317+00
a8c1321b-0b07-4b3b-8184-22f773533e8c	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	f1ca64ff-36f4-429d-87ed-53e59ce7e901	a2376e3b-198a-4eb4-8bae-53c301d51b79	2026-04-23 06:06:04.398317+00
9d9d73a5-f297-4090-a9a9-7de77433897d	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	a2376e3b-198a-4eb4-8bae-53c301d51b79	0a73aa35-a41c-4ad0-b32f-4a7a91c4cb39	2026-04-23 06:06:04.398317+00
19a1110a-ea6b-4960-8a72-aee0579048c3	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	0a73aa35-a41c-4ad0-b32f-4a7a91c4cb39	49027125-0b3a-481f-903b-efcb7f2987b5	2026-04-23 06:06:04.398317+00
48f4d482-ba81-4690-88a2-4c0b32a08ed3	876093ad-808b-47be-ae6c-e6705d7e57b1	52274a2c-97e0-4ff0-a8bc-fde5e04280f2	portfolio	49027125-0b3a-481f-903b-efcb7f2987b5	b9138d13-976f-44a9-aa81-5a0b12c89e4d	2026-04-23 06:06:04.398317+00
6244f395-ea0e-4706-8dae-d671f706280c	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	7f3b2b63-77a6-42f7-847f-4044c1b76124	62bb7ba6-2dc3-4a40-bd78-f47fe20c03e4	2026-04-23 06:06:04.398317+00
d8aa6da3-d7a0-4b51-a08d-265280577766	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	62bb7ba6-2dc3-4a40-bd78-f47fe20c03e4	7d355502-ce6b-4987-98f0-8a9cc6f17ffc	2026-04-23 06:06:04.398317+00
42980233-f343-4709-853c-d8d4b6292b3a	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	7d355502-ce6b-4987-98f0-8a9cc6f17ffc	9a515123-b4df-4184-917f-654c0282ee9c	2026-04-23 06:06:04.398317+00
617ccd9b-e810-49d6-9732-7234e73ccb96	876093ad-808b-47be-ae6c-e6705d7e57b1	ed479c5f-f2ab-47c2-ab5c-090645b58ec3	portfolio	9a515123-b4df-4184-917f-654c0282ee9c	40782239-cbac-42e6-b0ad-c90d51f5daf2	2026-04-23 06:06:04.398317+00
f36c3b02-db53-487f-ab0d-f98d2eb73322	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	1e6880a4-3cb3-4452-bd44-286e3a540ad0	c484d716-c642-4ce1-96b8-b2d4ce96a465	2026-04-23 06:06:04.398317+00
bb59c586-9d77-4bdf-92e8-940f93c926ea	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	c484d716-c642-4ce1-96b8-b2d4ce96a465	54013294-dd0c-4e10-b9f1-0d56ee034eb6	2026-04-23 06:06:04.398317+00
89f1d4ec-8691-4a02-bdfc-382fb3257c99	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	54013294-dd0c-4e10-b9f1-0d56ee034eb6	15cf8ab8-bc7c-4af6-bd60-ba4bfaa94765	2026-04-23 06:06:04.398317+00
77f1a8f1-85ee-4b97-bd7c-1847c13a99f3	876093ad-808b-47be-ae6c-e6705d7e57b1	c39b618b-8453-418b-9d1d-e1a23b6b5f16	portfolio	15cf8ab8-bc7c-4af6-bd60-ba4bfaa94765	f665a8ba-207a-4f6c-9481-70a88160df75	2026-04-23 06:06:04.398317+00
366cb5db-74a6-4abd-845d-ebdd66238e62	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	280fdafc-c848-4296-8a67-20d3cb8fb060	3a0b8dc6-7c00-42ea-8585-ab2574320bda	2026-04-23 06:06:04.398317+00
6a2121b1-4f15-4cf6-8fdd-300d846ae272	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	3a0b8dc6-7c00-42ea-8585-ab2574320bda	542de25a-ba66-4bc1-aadf-8de7099ac746	2026-04-23 06:06:04.398317+00
5cfb38be-b4a9-4eb3-acff-0a134b18f4b7	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	542de25a-ba66-4bc1-aadf-8de7099ac746	912d62bf-0897-4f7c-87e9-d1491e7d5992	2026-04-23 06:06:04.398317+00
e705f2e5-6d9e-4ed9-a282-4f247b9a235c	876093ad-808b-47be-ae6c-e6705d7e57b1	e40d4f2a-54d2-4e4c-8088-95af6d742716	portfolio	912d62bf-0897-4f7c-87e9-d1491e7d5992	eff6b727-ed71-4a3f-8792-57dac7757650	2026-04-23 06:06:04.398317+00
cf0febdf-c34f-4f2f-bbba-91a7b169d389	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	f115e3cd-8894-4035-bd74-a9e85ac1bf26	2428aeef-0519-405a-bc9d-46b91b91c19e	2026-04-23 06:06:04.398317+00
d0e02c00-12df-46d1-a2bc-14408248582e	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	2428aeef-0519-405a-bc9d-46b91b91c19e	38ec77fc-061c-49ce-898a-8467e7850283	2026-04-23 06:06:04.398317+00
76d360ba-5f92-4cff-9670-31045bd26827	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	38ec77fc-061c-49ce-898a-8467e7850283	072e124c-b555-4e29-a3d8-59ea4a1d4668	2026-04-23 06:06:04.398317+00
1d34bece-de02-452a-8d8d-b6859885647f	876093ad-808b-47be-ae6c-e6705d7e57b1	f53838c3-4f0e-4b35-999c-160f946ad6c2	execution	072e124c-b555-4e29-a3d8-59ea4a1d4668	46ee089f-ef14-472a-8644-014ac8d5b334	2026-04-23 06:06:04.398317+00
66a7ff3a-011f-4319-bdb9-c3973953cbc8	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	332b2b3e-8c51-4ef0-92b7-bcab6c159e6e	7aea7667-b8c9-4aca-8d2b-1d8c34391fa4	2026-04-23 06:06:04.398317+00
ac057422-6d4b-4d5f-b7a4-9228023bca7b	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	7aea7667-b8c9-4aca-8d2b-1d8c34391fa4	0f99e724-b167-4980-89ac-1efd5d174ede	2026-04-23 06:06:04.398317+00
57d10cc7-fb63-466c-a9ef-b447107c290a	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	0f99e724-b167-4980-89ac-1efd5d174ede	62a9f51c-f7bb-48d7-b18a-1172f7a78392	2026-04-23 06:06:04.398317+00
ae137434-d41c-4a5c-aa85-c6b0d41fc1a6	876093ad-808b-47be-ae6c-e6705d7e57b1	d61b9965-346d-4361-9eec-18ad8b9ac338	execution	62a9f51c-f7bb-48d7-b18a-1172f7a78392	b49339aa-f3df-4194-ba23-ae6af81111ee	2026-04-23 06:06:04.398317+00
11ae7284-71e6-4eb6-84be-dc9209e53ef8	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	7d5fd112-e056-4959-9d76-174eddaa15df	f8081ceb-f176-4bff-b1c7-b610e06db65c	2026-04-23 06:06:04.398317+00
69d1edea-e2bf-4ce3-b43b-1300772dd244	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	f8081ceb-f176-4bff-b1c7-b610e06db65c	672bcef2-f6ed-4b2f-b3ef-e70e73dac4d8	2026-04-23 06:06:04.398317+00
163ffd2a-2286-43ec-997c-8cc4a0778e33	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	672bcef2-f6ed-4b2f-b3ef-e70e73dac4d8	6873e2e8-b39d-4db5-92d3-5ee493103e5c	2026-04-23 06:06:04.398317+00
c0632767-97c3-4811-b9ef-1d36ffb0a81a	876093ad-808b-47be-ae6c-e6705d7e57b1	1fbc03be-6b68-4cd4-85a8-c0e0b2b0c800	execution	6873e2e8-b39d-4db5-92d3-5ee493103e5c	c88da2f8-5c16-4e8c-87f4-376cbe5e30d6	2026-04-23 06:06:04.398317+00
026db5a5-4ca0-474e-92a4-e6f3c36d786e	876093ad-808b-47be-ae6c-e6705d7e57b1	7ee9afa4-8321-4e4b-a541-678742524dfe	execution	9d315137-cdcd-4c3b-9c38-bd9efe6a8442	da04813b-dbff-4e7d-a30b-aac3e46acf9c	2026-04-23 06:06:04.398317+00
d78991df-3e16-4e7c-9c3b-5c2c9ce1d22d	876093ad-808b-47be-ae6c-e6705d7e57b1	7ee9afa4-8321-4e4b-a541-678742524dfe	execution	da04813b-dbff-4e7d-a30b-aac3e46acf9c	13641cc5-ed5f-4365-883f-1a9282e02b3f	2026-04-23 06:06:04.398317+00
2ef70a90-0ea3-4a40-9cb1-d54ab6e3356f	876093ad-808b-47be-ae6c-e6705d7e57b1	7ee9afa4-8321-4e4b-a541-678742524dfe	execution	13641cc5-ed5f-4365-883f-1a9282e02b3f	0a2a9bb6-da21-4283-bb56-82163b5ded41	2026-04-23 06:06:04.398317+00
d3dfba70-6251-44c0-9b94-b32a8dbbfc9e	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	077e31ec-a36d-45c2-bb41-f7389efb4aa9	e0a2ed6c-4dea-449c-b8ae-1fd1ff0d8866	2026-04-24 22:12:48.887502+00
e816dda9-fcea-437b-bd06-1f5f0521fd03	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	991681c5-3cce-4f31-b5ef-eab20f735446	portfolio	e0a2ed6c-4dea-449c-b8ae-1fd1ff0d8866	8277eb57-98b8-427e-8e8b-5720a69e87ad	2026-04-24 22:12:48.887502+00
7e8a0ea2-d391-4f70-9b58-345b58363ab4	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	2df8005f-75aa-4b1d-a651-df705027dece	bd6b18a9-70d2-48a1-a6b8-7f9d38007b12	2026-04-24 22:12:48.887502+00
70baa688-d4f7-4061-a440-69e8d476422c	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	bd6b18a9-70d2-48a1-a6b8-7f9d38007b12	0f05f826-25c6-4408-bf58-b96e357b27a9	2026-04-24 22:12:48.887502+00
473edbdf-6d03-4845-8e5e-31b666522da3	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	0f05f826-25c6-4408-bf58-b96e357b27a9	bb5e1807-d7db-4104-84a7-3ad1981bd4a1	2026-04-24 22:12:48.887502+00
629f6e17-adcd-4867-9a6a-6e9714dcd919	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	0c55bb41-22c2-46b5-84a1-e88b8968be55	execution	bb5e1807-d7db-4104-84a7-3ad1981bd4a1	70eb0e99-7c3e-4451-afbc-2ccb83a9b9a7	2026-04-24 22:12:48.887502+00
ccf0f028-9936-4932-b1fe-dd65e63b5e9e	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	a24055f0-a51d-4e31-b546-4fc9bdc43242	4f59af44-95cf-4651-9c27-7ec7f2b2cf27	2026-04-24 22:12:48.887502+00
df3e466c-e17c-4855-8fac-b3e6ce1486fc	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	8062683a-5d86-4f0c-81c5-025032daf4af	execution	4f59af44-95cf-4651-9c27-7ec7f2b2cf27	ed0d87c6-1059-4735-b901-d5893799f698	2026-04-24 22:12:48.887502+00
\.


--
-- Data for Name: portfolio_item_types; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.portfolio_item_types (id, subscription_id, name, tag, sort_order, archived_at, created_at, updated_at) FROM stdin;
a9f9df9b-bc5b-414b-a87c-b96169c41ee2	00000000-0000-0000-0000-000000000001	Portfolio Runway	RO	10	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
00eedd40-baf4-4e4c-8085-9ef139f4cf35	00000000-0000-0000-0000-000000000001	Product	PR	20	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
68280f5c-d607-4443-9add-2d3ffead80e3	00000000-0000-0000-0000-000000000001	Business Objective	BO	30	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
9bdfc74f-517e-4704-84a0-083c230b22ec	00000000-0000-0000-0000-000000000001	Theme	TH	40	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
feb72662-32e9-495c-b18b-7a2827fdb854	00000000-0000-0000-0000-000000000001	Feature	FE	50	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
0c88f29b-75b2-4ff5-ba7f-6a245eb9f648	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	Portfolio Runway	RO	10	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
2510f6e1-2189-4c6b-aac2-0193f43c7e5c	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	Product	PR	20	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
c44f3df9-9470-436e-a202-2e7e9af653c2	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	Business Objective	BO	30	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
28d37179-125e-4849-9304-8edce6ff1d9d	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	Theme	TH	40	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
2a4ed1c2-466a-429c-83c4-c4625eb92f10	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	Feature	FE	50	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
005b73b4-0479-4b42-a78c-4ad2fc8fbb20	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	Portfolio Runway	RO	10	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
9f1983cc-085a-459a-ab2d-77a6cad10860	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	Product	PR	20	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
916c245e-8a90-4425-a7b6-2161af9a8114	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	Business Objective	BO	30	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
a127f090-3034-4ea4-a191-f098094f724d	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	Theme	TH	40	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
3c4dcda4-72ca-4a8b-9064-a638004271dc	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	Feature	FE	50	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
f814f424-bb40-41d1-9f23-4359eee9d330	4fe02761-85c9-409a-9ea9-04c10f536394	Portfolio Runway	RO	10	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
d66c0d50-1a83-4e12-8f70-82a7b5f15b4b	4fe02761-85c9-409a-9ea9-04c10f536394	Product	PR	20	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
6e0020e4-f142-4096-b46d-1738c23406d1	4fe02761-85c9-409a-9ea9-04c10f536394	Business Objective	BO	30	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
ecc89495-702c-495c-8672-dda32e51d7d7	4fe02761-85c9-409a-9ea9-04c10f536394	Theme	TH	40	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
b54242f2-b44c-47b3-bdf2-17515967faee	4fe02761-85c9-409a-9ea9-04c10f536394	Feature	FE	50	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
ea54853f-bbde-44b6-8601-1d6c31a18fe0	1e2e4435-7c7b-4f13-898b-872f38a55ffd	Portfolio Runway	RO	10	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
ea8871da-ea8e-40ec-b363-f1cc6b7f7e4e	1e2e4435-7c7b-4f13-898b-872f38a55ffd	Product	PR	20	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
4bc80cd2-a239-4565-834e-5b5f0a240375	1e2e4435-7c7b-4f13-898b-872f38a55ffd	Business Objective	BO	30	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
a8c2f743-8799-4113-b8f5-9afff9a51791	1e2e4435-7c7b-4f13-898b-872f38a55ffd	Theme	TH	40	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
f5c16bc0-fee7-42db-85bf-783564cd7009	1e2e4435-7c7b-4f13-898b-872f38a55ffd	Feature	FE	50	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
7373de20-cb84-48c9-8f72-52d2597571fc	231c3275-4a6f-4589-af4b-1ac863e41f5a	Portfolio Runway	RO	10	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
819aa802-956d-4bba-90ef-1aa097aa2c48	231c3275-4a6f-4589-af4b-1ac863e41f5a	Product	PR	20	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
e1fb6bb3-6b39-4e62-ac06-4a1e59952ea0	231c3275-4a6f-4589-af4b-1ac863e41f5a	Business Objective	BO	30	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
7b0cad3c-30b0-457d-9b1b-25d4f248ad5c	231c3275-4a6f-4589-af4b-1ac863e41f5a	Theme	TH	40	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
906dec47-da6c-4b3f-b1c5-c6673f25099d	231c3275-4a6f-4589-af4b-1ac863e41f5a	Feature	FE	50	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
74773f25-ec5e-4310-bf1b-88d5e2bcbd04	2372603a-5775-46f7-8335-43dcde0a2a07	Portfolio Runway	RO	10	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
0a0509ec-c69b-4d6b-9749-064f811bc18a	2372603a-5775-46f7-8335-43dcde0a2a07	Product	PR	20	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
1eb7d8e2-04c7-4bc8-81b5-f583145ee9df	2372603a-5775-46f7-8335-43dcde0a2a07	Business Objective	BO	30	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
f70b6272-e3a6-4698-9c54-3672afc71dca	2372603a-5775-46f7-8335-43dcde0a2a07	Theme	TH	40	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
a47b7aeb-6928-4739-9999-2c65dfdd8e4d	2372603a-5775-46f7-8335-43dcde0a2a07	Feature	FE	50	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
64d05085-4571-499c-a3d5-2b6b236518d8	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	Portfolio Runway	RO	10	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
3540e89a-9715-40f0-96ee-699ef645dca6	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	Product	PR	20	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
9d09c452-2191-43b7-a273-11795120c82a	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	Business Objective	BO	30	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
def9b1f4-4095-4b53-abbf-a3f6d5ad5382	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	Theme	TH	40	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
b7e196ec-6c4b-4cf4-ab20-74af5b4ba38d	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	Feature	FE	50	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
996eb1c5-dc10-445a-b648-91f52782b539	97492b25-c98a-48ee-9009-047c783b3f44	Portfolio Runway	RO	10	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
d3afb047-93e7-4b34-ba04-f9f8430f7880	97492b25-c98a-48ee-9009-047c783b3f44	Product	PR	20	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
222abd0b-53c7-44c2-94b3-cc58f54668e4	97492b25-c98a-48ee-9009-047c783b3f44	Business Objective	BO	30	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
582ee73b-f460-45ef-b8de-664bf509f9cb	97492b25-c98a-48ee-9009-047c783b3f44	Theme	TH	40	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
b33627c7-be8c-49dd-908e-f31b8d106a38	97492b25-c98a-48ee-9009-047c783b3f44	Feature	FE	50	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
0f3dfd7e-2286-4b3c-909c-84d50c3a6d4f	10cc89f7-0092-4267-9b90-0bce22d1edab	Portfolio Runway	RO	10	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
5e90fd21-b930-487f-9b2d-fa1605678618	10cc89f7-0092-4267-9b90-0bce22d1edab	Product	PR	20	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
603ab5aa-686f-4b7d-8db4-db612c66bd39	10cc89f7-0092-4267-9b90-0bce22d1edab	Business Objective	BO	30	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
da057211-0f35-4cc4-988d-0fa3d577e314	10cc89f7-0092-4267-9b90-0bce22d1edab	Theme	TH	40	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
74a53a41-9e3a-4466-b267-ca94be3597af	10cc89f7-0092-4267-9b90-0bce22d1edab	Feature	FE	50	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
dc4c8d24-5a5a-431b-8563-711d42904ca5	f936845a-e36a-459b-9b4b-dd5bddf1443e	Portfolio Runway	RO	10	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
ed7dc14a-af12-48d0-b0db-7a6d85a1565a	f936845a-e36a-459b-9b4b-dd5bddf1443e	Product	PR	20	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
cf8c784e-7bdf-4519-96d2-7492df3781fd	f936845a-e36a-459b-9b4b-dd5bddf1443e	Business Objective	BO	30	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
eaf28bde-29b3-4ce7-a325-ccb286e905f3	f936845a-e36a-459b-9b4b-dd5bddf1443e	Theme	TH	40	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
f4d76b7b-ecb9-4c48-aac5-68e47eb13885	f936845a-e36a-459b-9b4b-dd5bddf1443e	Feature	FE	50	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
69c28110-e2bc-4b97-b067-9787bad66dc6	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	Portfolio Runway	RO	10	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
4ced0f69-5d3f-4e59-bc2f-4eb5915323ab	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	Product	PR	20	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
92e1f73d-da41-4ed3-b7e0-b1ea00e90981	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	Business Objective	BO	30	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
14af1dd7-7ade-4a6a-8205-7e074f1a8f55	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	Theme	TH	40	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
972cc219-c406-4c91-985b-13b6478a59e3	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	Feature	FE	50	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
1af01e55-f68d-4d49-b0b6-218c6d2f879f	876093ad-808b-47be-ae6c-e6705d7e57b1	Portfolio Runway	RO	10	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
52274a2c-97e0-4ff0-a8bc-fde5e04280f2	876093ad-808b-47be-ae6c-e6705d7e57b1	Product	PR	20	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
ed479c5f-f2ab-47c2-ab5c-090645b58ec3	876093ad-808b-47be-ae6c-e6705d7e57b1	Business Objective	BO	30	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
c39b618b-8453-418b-9d1d-e1a23b6b5f16	876093ad-808b-47be-ae6c-e6705d7e57b1	Theme	TH	40	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
e40d4f2a-54d2-4e4c-8088-95af6d742716	876093ad-808b-47be-ae6c-e6705d7e57b1	Feature	FE	50	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
b0c7826f-c8d8-45f2-96e6-1a8e44b6f0f9	3c60198d-1cf1-4443-af35-84f20511b17c	Portfolio Runway	RO	10	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
875527c3-23e2-4450-bb14-1db7765db06d	3c60198d-1cf1-4443-af35-84f20511b17c	Product	PR	20	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
2b2ceab7-102e-4ae1-bee3-0d639cd7c3d4	3c60198d-1cf1-4443-af35-84f20511b17c	Business Objective	BO	30	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
2536fd7e-8b10-4eab-a18b-05c0cf85cfa7	3c60198d-1cf1-4443-af35-84f20511b17c	Theme	TH	40	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
b62bcf18-8d8e-4627-9119-8b09fc89a054	3c60198d-1cf1-4443-af35-84f20511b17c	Feature	FE	50	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
8e8b9e71-b893-4bcd-9adf-5b735677b059	96c676b2-8388-49bd-8fc1-e4adba6e8831	Portfolio Runway	RO	10	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
b442b1b8-01bd-49fd-8763-ec848b4090ba	96c676b2-8388-49bd-8fc1-e4adba6e8831	Product	PR	20	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
9ce3ea52-3ae5-4be0-952c-196d3631749f	96c676b2-8388-49bd-8fc1-e4adba6e8831	Business Objective	BO	30	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
466dcd02-5519-4bd1-b896-3678c248788b	96c676b2-8388-49bd-8fc1-e4adba6e8831	Theme	TH	40	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
031f78f0-5e95-4f50-98fd-303b86394b95	96c676b2-8388-49bd-8fc1-e4adba6e8831	Feature	FE	50	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
32bd7080-9014-4b73-93c5-46e57c61581a	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	Portfolio Runway	RO	10	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
477e9fb3-706e-4402-b1ae-c4fc51d4f4a3	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	Product	PR	20	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
3709bf8b-b40a-4919-9b93-6ef98f3f4199	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	Business Objective	BO	30	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
44b7f512-e019-4eef-98c6-1aad1d537c22	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	Theme	TH	40	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
991681c5-3cce-4f31-b5ef-eab20f735446	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	Feature	FE	50	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
18398d24-f96e-4cdf-893f-25c03631fd25	635ed3cf-3d86-4985-89eb-8975012d1420	Portfolio Runway	RO	10	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
49013a59-4c36-417e-865f-3a80529b7684	635ed3cf-3d86-4985-89eb-8975012d1420	Product	PR	20	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
fe103d44-4c19-4554-bff9-13497c6921c9	635ed3cf-3d86-4985-89eb-8975012d1420	Business Objective	BO	30	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
300efd1f-dc81-471c-bab2-7d6ccf3ea81a	635ed3cf-3d86-4985-89eb-8975012d1420	Theme	TH	40	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
6022fd50-95f7-4a8a-b80e-ed68e841e1e4	635ed3cf-3d86-4985-89eb-8975012d1420	Feature	FE	50	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
\.


--
-- Data for Name: product; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.product (id, subscription_id, workspace_id, parent_portfolio_id, type_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
9320b036-816b-41a7-aa6f-4033ee07d2f6	00000000-0000-0000-0000-000000000001	0e794717-699e-4577-be0c-b419350d265b	\N	\N	1	Product	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
e5694a22-0b71-4f60-8d0b-7e92d5d58464	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	07779114-f12e-4191-8856-1a761eff8e63	\N	\N	1	Product	45501c52-9ef3-4bbb-9ebb-a83084306802	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
0f87b6b3-17de-4d40-b299-71a39d73244e	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	c30894ad-825a-4567-9ce2-c2f0bf4f38c2	\N	\N	1	Product	95f6f04a-da7f-418d-b9d2-4e94767872ba	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
753285df-c003-42de-bddf-88bae23c81a6	4fe02761-85c9-409a-9ea9-04c10f536394	8fb68ada-0673-42c9-8f49-02eaa56dc7d3	\N	\N	1	Product	d89e9e28-3702-4c76-8f11-0f1bd96b98d4	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
d18d32ba-73ad-45db-b4c7-28ad1bd0bb4b	1e2e4435-7c7b-4f13-898b-872f38a55ffd	0a9f3365-5c2a-41b7-96c6-538790cb8166	\N	\N	1	Product	51f70c45-02d5-40d6-a063-a4ddab4a6f7e	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
6e4036e3-0ad5-46cc-8a59-9798e7de6385	2372603a-5775-46f7-8335-43dcde0a2a07	03509a03-6c4d-4df1-85aa-c88d617ab3b5	\N	\N	1	Product	22645a90-02a1-4cfb-9dc1-b8ad690e91f2	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
bda43e12-c0b2-4e4d-b86b-e298dec8cf62	10cc89f7-0092-4267-9b90-0bce22d1edab	83549435-de1a-459a-a0cf-687d0c150dd4	\N	\N	1	Product	76921247-366c-4eab-adbb-30934671ca1f	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
a175f0bf-757e-47fc-beec-e0109e0152ae	f936845a-e36a-459b-9b4b-dd5bddf1443e	a766edab-a312-4c77-b584-c4cb2fde7a97	\N	\N	1	Product	fbb8537a-e556-47ea-a6dc-bcabbe92a8b5	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
179925bd-24b1-423f-bfb1-86a45fb7d93f	876093ad-808b-47be-ae6c-e6705d7e57b1	5bb9f018-c87b-448c-94c2-c22e2e7482d1	\N	\N	1	Product	c43007f6-30b9-49de-9d96-38585886341a	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
3ba76062-b5bb-4d0b-afef-975d25d25143	231c3275-4a6f-4589-af4b-1ac863e41f5a	32beb657-7090-4adb-a479-7faeccd57d13	\N	\N	1	Product	f4dd18ea-7a09-4ec4-bca0-71c8c1bee84b	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
5dd5fb6c-5939-48d4-b767-adc01142c1c9	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	38cc341b-f5d4-4b9e-bd15-722981a77baa	\N	\N	1	Product	ae705ff6-26ed-4d59-8ffd-9a093ada3e5d	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
cf472ce3-fb0d-4ff5-a720-4819eecb451e	97492b25-c98a-48ee-9009-047c783b3f44	c4bbc795-56a7-4465-9f43-f8d3b1dfd0f4	\N	\N	1	Product	b9cb1f18-66f0-4315-badc-9b20af6da3cb	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
09abee88-acf3-4b63-af18-655b509f78c9	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	5726ee8a-c202-415a-bab3-cf87cdf6c8f7	\N	\N	1	Product	60e7b593-a97c-447b-b3da-7f4fcebb5a43	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
1c1b5f04-8e6d-41ad-9f82-6e9ed2876b59	3c60198d-1cf1-4443-af35-84f20511b17c	f83c2e8b-0f56-47d7-afa2-8b93143ef00b	\N	\N	1	Product	c853e4f1-553e-485f-a627-2dd8bb604e84	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
f69ae18c-ab47-4629-beb0-c152b58e3464	96c676b2-8388-49bd-8fc1-e4adba6e8831	e3e0eb83-5f2c-4e02-8800-845682b45664	\N	\N	1	Product	916f7c76-da0a-4ff7-9a36-b3a2d013e2af	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
8f884112-e08d-4b61-936c-fdf2db212143	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	334ad168-a744-4422-9ac8-d1adc631c3f3	\N	\N	1	Product	e5f5fed0-3ed4-48a6-a64f-0d416d92dbb0	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
56e10597-627d-44be-8ff5-a6d2552d75ae	635ed3cf-3d86-4985-89eb-8975012d1420	a6695cd0-01ef-4627-a863-9d47a4669e62	\N	\N	1	Product	d57588dc-c748-4240-8ecc-ce2f2d0826c6	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
\.


--
-- Data for Name: subscription_sequence; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.subscription_sequence (subscription_id, scope, next_num, updated_at) FROM stdin;
00000000-0000-0000-0000-000000000001	roadmap	2	2026-04-21 05:46:22.307829+00
00000000-0000-0000-0000-000000000001	workspace	2	2026-04-21 05:46:22.307829+00
00000000-0000-0000-0000-000000000001	product	2	2026-04-21 05:46:22.307829+00
00000000-0000-0000-0000-000000000001	portfolio	1	2026-04-21 05:46:22.307829+00
cd12a3eb-10cf-4e67-b3fa-f7063c97725d	roadmap	2	2026-04-23 06:05:43.305888+00
cd12a3eb-10cf-4e67-b3fa-f7063c97725d	workspace	2	2026-04-23 06:05:43.305888+00
cd12a3eb-10cf-4e67-b3fa-f7063c97725d	product	2	2026-04-23 06:05:43.305888+00
cd12a3eb-10cf-4e67-b3fa-f7063c97725d	portfolio	1	2026-04-23 06:05:43.305888+00
359fb261-0f98-4adc-9ff8-fa03ad8a77dc	roadmap	2	2026-04-23 06:05:44.631317+00
359fb261-0f98-4adc-9ff8-fa03ad8a77dc	workspace	2	2026-04-23 06:05:44.631317+00
359fb261-0f98-4adc-9ff8-fa03ad8a77dc	product	2	2026-04-23 06:05:44.631317+00
359fb261-0f98-4adc-9ff8-fa03ad8a77dc	portfolio	1	2026-04-23 06:05:44.631317+00
4fe02761-85c9-409a-9ea9-04c10f536394	roadmap	2	2026-04-23 06:05:45.104266+00
4fe02761-85c9-409a-9ea9-04c10f536394	workspace	2	2026-04-23 06:05:45.104266+00
4fe02761-85c9-409a-9ea9-04c10f536394	product	2	2026-04-23 06:05:45.104266+00
4fe02761-85c9-409a-9ea9-04c10f536394	portfolio	1	2026-04-23 06:05:45.104266+00
1e2e4435-7c7b-4f13-898b-872f38a55ffd	roadmap	2	2026-04-23 06:05:46.205643+00
1e2e4435-7c7b-4f13-898b-872f38a55ffd	workspace	2	2026-04-23 06:05:46.205643+00
1e2e4435-7c7b-4f13-898b-872f38a55ffd	product	2	2026-04-23 06:05:46.205643+00
1e2e4435-7c7b-4f13-898b-872f38a55ffd	portfolio	1	2026-04-23 06:05:46.205643+00
2372603a-5775-46f7-8335-43dcde0a2a07	roadmap	2	2026-04-23 06:06:00.889009+00
2372603a-5775-46f7-8335-43dcde0a2a07	workspace	2	2026-04-23 06:06:00.889009+00
2372603a-5775-46f7-8335-43dcde0a2a07	product	2	2026-04-23 06:06:00.889009+00
2372603a-5775-46f7-8335-43dcde0a2a07	portfolio	1	2026-04-23 06:06:00.889009+00
10cc89f7-0092-4267-9b90-0bce22d1edab	roadmap	2	2026-04-23 06:06:02.598873+00
10cc89f7-0092-4267-9b90-0bce22d1edab	workspace	2	2026-04-23 06:06:02.598873+00
10cc89f7-0092-4267-9b90-0bce22d1edab	product	2	2026-04-23 06:06:02.598873+00
10cc89f7-0092-4267-9b90-0bce22d1edab	portfolio	1	2026-04-23 06:06:02.598873+00
f936845a-e36a-459b-9b4b-dd5bddf1443e	roadmap	2	2026-04-23 06:06:03.316659+00
f936845a-e36a-459b-9b4b-dd5bddf1443e	workspace	2	2026-04-23 06:06:03.316659+00
f936845a-e36a-459b-9b4b-dd5bddf1443e	product	2	2026-04-23 06:06:03.316659+00
f936845a-e36a-459b-9b4b-dd5bddf1443e	portfolio	1	2026-04-23 06:06:03.316659+00
876093ad-808b-47be-ae6c-e6705d7e57b1	roadmap	2	2026-04-23 06:06:04.398317+00
876093ad-808b-47be-ae6c-e6705d7e57b1	workspace	2	2026-04-23 06:06:04.398317+00
876093ad-808b-47be-ae6c-e6705d7e57b1	product	2	2026-04-23 06:06:04.398317+00
876093ad-808b-47be-ae6c-e6705d7e57b1	portfolio	1	2026-04-23 06:06:04.398317+00
231c3275-4a6f-4589-af4b-1ac863e41f5a	roadmap	2	2026-04-23 06:17:04.167639+00
231c3275-4a6f-4589-af4b-1ac863e41f5a	workspace	2	2026-04-23 06:17:04.167639+00
231c3275-4a6f-4589-af4b-1ac863e41f5a	product	2	2026-04-23 06:17:04.167639+00
231c3275-4a6f-4589-af4b-1ac863e41f5a	portfolio	1	2026-04-23 06:17:04.167639+00
de48a74b-6fdd-43d8-ba69-93ec6d9d0160	roadmap	2	2026-04-23 06:17:05.488182+00
de48a74b-6fdd-43d8-ba69-93ec6d9d0160	workspace	2	2026-04-23 06:17:05.488182+00
de48a74b-6fdd-43d8-ba69-93ec6d9d0160	product	2	2026-04-23 06:17:05.488182+00
de48a74b-6fdd-43d8-ba69-93ec6d9d0160	portfolio	1	2026-04-23 06:17:05.488182+00
97492b25-c98a-48ee-9009-047c783b3f44	roadmap	2	2026-04-23 06:17:05.967504+00
97492b25-c98a-48ee-9009-047c783b3f44	workspace	2	2026-04-23 06:17:05.967504+00
97492b25-c98a-48ee-9009-047c783b3f44	product	2	2026-04-23 06:17:05.967504+00
97492b25-c98a-48ee-9009-047c783b3f44	portfolio	1	2026-04-23 06:17:05.967504+00
9adc7407-5c6a-4cde-acb2-bc0f7af623c2	roadmap	2	2026-04-23 06:17:06.742455+00
9adc7407-5c6a-4cde-acb2-bc0f7af623c2	workspace	2	2026-04-23 06:17:06.742455+00
9adc7407-5c6a-4cde-acb2-bc0f7af623c2	product	2	2026-04-23 06:17:06.742455+00
9adc7407-5c6a-4cde-acb2-bc0f7af623c2	portfolio	1	2026-04-23 06:17:06.742455+00
3c60198d-1cf1-4443-af35-84f20511b17c	roadmap	2	2026-04-24 22:12:46.548477+00
3c60198d-1cf1-4443-af35-84f20511b17c	workspace	2	2026-04-24 22:12:46.548477+00
3c60198d-1cf1-4443-af35-84f20511b17c	product	2	2026-04-24 22:12:46.548477+00
3c60198d-1cf1-4443-af35-84f20511b17c	portfolio	1	2026-04-24 22:12:46.548477+00
96c676b2-8388-49bd-8fc1-e4adba6e8831	roadmap	2	2026-04-24 22:12:48.185961+00
96c676b2-8388-49bd-8fc1-e4adba6e8831	workspace	2	2026-04-24 22:12:48.185961+00
96c676b2-8388-49bd-8fc1-e4adba6e8831	product	2	2026-04-24 22:12:48.185961+00
96c676b2-8388-49bd-8fc1-e4adba6e8831	portfolio	1	2026-04-24 22:12:48.185961+00
1a36a25b-8a5c-4e52-b59a-76b24f6d9543	roadmap	2	2026-04-24 22:12:48.887502+00
1a36a25b-8a5c-4e52-b59a-76b24f6d9543	workspace	2	2026-04-24 22:12:48.887502+00
1a36a25b-8a5c-4e52-b59a-76b24f6d9543	product	2	2026-04-24 22:12:48.887502+00
1a36a25b-8a5c-4e52-b59a-76b24f6d9543	portfolio	1	2026-04-24 22:12:48.887502+00
635ed3cf-3d86-4985-89eb-8975012d1420	roadmap	2	2026-04-24 22:12:49.958356+00
635ed3cf-3d86-4985-89eb-8975012d1420	workspace	2	2026-04-24 22:12:49.958356+00
635ed3cf-3d86-4985-89eb-8975012d1420	product	2	2026-04-24 22:12:49.958356+00
635ed3cf-3d86-4985-89eb-8975012d1420	portfolio	1	2026-04-24 22:12:49.958356+00
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.subscriptions (id, name, slug, is_active, created_at, updated_at, tier) FROM stdin;
00000000-0000-0000-0000-000000000001	MMFFDev	mmffdev	t	2026-04-21 01:13:46.308757+00	2026-04-21 01:13:46.308757+00	pro
cd12a3eb-10cf-4e67-b3fa-f7063c97725d	users-test-create-allowed-cf9082aa	users-test-create-allowed-cf9082aa	t	2026-04-23 06:05:43.273446+00	2026-04-23 06:05:43.273446+00	pro
359fb261-0f98-4adc-9ff8-fa03ad8a77dc	users-test-upd-a-4a8fae9b	users-test-upd-a-4a8fae9b	t	2026-04-23 06:05:44.58003+00	2026-04-23 06:05:44.58003+00	pro
4fe02761-85c9-409a-9ea9-04c10f536394	users-test-upd-target-ceiling-b9fcb60f	users-test-upd-target-ceiling-b9fcb60f	t	2026-04-23 06:05:45.039981+00	2026-04-23 06:05:45.039981+00	pro
1e2e4435-7c7b-4f13-898b-872f38a55ffd	users-test-upd-gadmin-happy-69f121fe	users-test-upd-gadmin-happy-69f121fe	t	2026-04-23 06:05:46.164598+00	2026-04-23 06:05:46.164598+00	pro
2372603a-5775-46f7-8335-43dcde0a2a07	users-test-create-allowed-48f93206	users-test-create-allowed-48f93206	t	2026-04-23 06:06:00.830653+00	2026-04-23 06:06:00.830653+00	pro
10cc89f7-0092-4267-9b90-0bce22d1edab	users-test-upd-a-6bd12e9c	users-test-upd-a-6bd12e9c	t	2026-04-23 06:06:02.508103+00	2026-04-23 06:06:02.508103+00	pro
f936845a-e36a-459b-9b4b-dd5bddf1443e	users-test-upd-target-ceiling-8d8af20a	users-test-upd-target-ceiling-8d8af20a	t	2026-04-23 06:06:03.226437+00	2026-04-23 06:06:03.226437+00	pro
876093ad-808b-47be-ae6c-e6705d7e57b1	users-test-upd-gadmin-happy-c76a636a	users-test-upd-gadmin-happy-c76a636a	t	2026-04-23 06:06:04.338867+00	2026-04-23 06:06:04.338867+00	pro
231c3275-4a6f-4589-af4b-1ac863e41f5a	users-test-create-allowed-df8cc54c	users-test-create-allowed-df8cc54c	t	2026-04-23 06:17:04.135218+00	2026-04-23 06:17:04.135218+00	pro
de48a74b-6fdd-43d8-ba69-93ec6d9d0160	users-test-upd-a-a743a1cd	users-test-upd-a-a743a1cd	t	2026-04-23 06:17:05.434867+00	2026-04-23 06:17:05.434867+00	pro
97492b25-c98a-48ee-9009-047c783b3f44	users-test-upd-target-ceiling-bc774407	users-test-upd-target-ceiling-bc774407	t	2026-04-23 06:17:05.914629+00	2026-04-23 06:17:05.914629+00	pro
9adc7407-5c6a-4cde-acb2-bc0f7af623c2	users-test-upd-gadmin-happy-f8b3e6db	users-test-upd-gadmin-happy-f8b3e6db	t	2026-04-23 06:17:06.686873+00	2026-04-23 06:17:06.686873+00	pro
3c60198d-1cf1-4443-af35-84f20511b17c	users-test-create-allowed-cd87fec6	users-test-create-allowed-cd87fec6	t	2026-04-24 22:12:46.490078+00	2026-04-24 22:12:46.490078+00	pro
96c676b2-8388-49bd-8fc1-e4adba6e8831	users-test-upd-a-1ba48250	users-test-upd-a-1ba48250	t	2026-04-24 22:12:48.097185+00	2026-04-24 22:12:48.097185+00	pro
1a36a25b-8a5c-4e52-b59a-76b24f6d9543	users-test-upd-target-ceiling-020635f6	users-test-upd-target-ceiling-020635f6	t	2026-04-24 22:12:48.798775+00	2026-04-24 22:12:48.798775+00	pro
635ed3cf-3d86-4985-89eb-8975012d1420	users-test-upd-gadmin-happy-24e4a1a8	users-test-upd-gadmin-happy-24e4a1a8	t	2026-04-24 22:12:49.899104+00	2026-04-24 22:12:49.899104+00	pro
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.users (id, subscription_id, email, password_hash, role, is_active, last_login, created_at, updated_at, auth_method, ldap_dn, force_password_change, password_changed_at, failed_login_count, locked_until, mfa_enrolled, mfa_secret, mfa_enrolled_at, mfa_recovery_codes) FROM stdin;
45501c52-9ef3-4bbb-9ebb-a83084306802	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	u-ebac7cb8@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00	local	\N	f	\N	0	\N	f	\N	\N	\N
2ed845b0-0de3-4665-a0c1-b66277ae7fe4	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	new-984f2a@example.com	$2a$12$eIXRcmA8PKbtSZrMGFwuBOZactQ5sYVME0kmSySNtfgqYVFn8hLEW	user	t	\N	2026-04-23 06:05:43.644965+00	2026-04-23 06:05:43.644965+00	local	\N	t	\N	0	\N	f	\N	\N	\N
869a7d19-cb0a-4e72-9e2a-39c5d7c95ebd	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	new-4aa5eb@example.com	$2a$12$3r2/5Y1tvPpCoCNyO4n7u.G5qZut.2gvhgNOGaB2sYHO2P6zLLT3O	padmin	t	\N	2026-04-23 06:05:43.983766+00	2026-04-23 06:05:43.983766+00	local	\N	t	\N	0	\N	f	\N	\N	\N
48bc648e-7140-4070-abcc-56a0bbebcc7f	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	new-089678@example.com	$2a$12$bApyMxxnIXWzQEIDMmtw7eWYdrsWQemAKhpACpYfV2ft5FNu4dE.u	gadmin	t	\N	2026-04-23 06:05:44.284651+00	2026-04-23 06:05:44.284651+00	local	\N	t	\N	0	\N	f	\N	\N	\N
95f6f04a-da7f-418d-b9d2-4e94767872ba	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	u-7b9a9169@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00	local	\N	f	\N	0	\N	f	\N	\N	\N
14c88043-918e-451a-9586-cf2f8398fed8	4fe02761-85c9-409a-9ea9-04c10f536394	u-eaa96475@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	padmin	t	\N	2026-04-23 06:05:45.081368+00	2026-04-23 06:05:45.081368+00	local	\N	f	\N	0	\N	f	\N	\N	\N
31c74efc-432c-4d51-8da8-9e603bbd2778	00000000-0000-0000-0000-000000000001	user@mmffdev.com	$2a$12$vlb5FYuKaE.kL8ir10vIQOcrqUDlawANvKcIQpYGYrgSGdANsJnKC	user	t	2026-04-23 05:26:25.950753+00	2026-04-21 01:56:50.117861+00	2026-04-23 05:26:25.950753+00	local	\N	f	2026-04-21 02:11:39.347263+00	0	\N	f	\N	\N	\N
07489c05-d7aa-46ab-9346-facd64c2cbc4	00000000-0000-0000-0000-000000000001	padmin@mmffdev.com	$2a$12$e3vkaF8PHMcQrKArtesdUep/rjC4ZTujfrelOKTsN.VyxU6.bstOC	padmin	t	2026-04-23 08:59:00.92252+00	2026-04-21 01:48:03.520815+00	2026-04-23 08:59:00.92252+00	local	\N	f	2026-04-21 02:18:29.811456+00	0	\N	f	\N	\N	\N
e426557b-98dd-47b9-a116-59d153630e86	3c60198d-1cf1-4443-af35-84f20511b17c	new-a97380@example.com	$2a$12$Nrc7dvcboCDsMpUtc2wQR.mpiFC1rNi2CPEZati6wcJZec9jnDaSu	padmin	t	\N	2026-04-24 22:12:47.281509+00	2026-04-24 22:12:47.281509+00	local	\N	t	\N	0	\N	f	\N	\N	\N
d89e9e28-3702-4c76-8f11-0f1bd96b98d4	4fe02761-85c9-409a-9ea9-04c10f536394	u-d3b700c6@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00	local	\N	f	\N	0	\N	f	\N	\N	\N
51f70c45-02d5-40d6-a063-a4ddab4a6f7e	1e2e4435-7c7b-4f13-898b-872f38a55ffd	u-a9066e0e@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00	local	\N	f	\N	0	\N	f	\N	\N	\N
b7376bc4-ed20-452c-8378-243ee3b6e9e3	1e2e4435-7c7b-4f13-898b-872f38a55ffd	u-d6b6a45e@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	padmin	f	\N	2026-04-23 06:05:46.258865+00	2026-04-23 06:05:46.320581+00	local	\N	f	\N	0	\N	f	\N	\N	\N
dbf65721-7b73-4906-a5d0-18fcd7b1db58	00000000-0000-0000-0000-000000000001	gadmin@mmffdev.com	$2a$12$ptsYZ79r3QL7/t1r1LGxfe5SeA/UFRXDKEBlCM4WFdj5J95uwetLi	gadmin	t	2026-04-25 01:09:25.146448+00	2026-04-21 01:13:46.309628+00	2026-04-25 01:09:25.146448+00	local	\N	f	2026-04-25 00:11:38.909148+00	0	\N	f	\N	\N	\N
22645a90-02a1-4cfb-9dc1-b8ad690e91f2	2372603a-5775-46f7-8335-43dcde0a2a07	u-9e244d29@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00	local	\N	f	\N	0	\N	f	\N	\N	\N
96c4fb93-45e3-498d-8a72-d166e8ebf6b6	2372603a-5775-46f7-8335-43dcde0a2a07	new-28052c@example.com	$2a$12$s3FbTjTaUE28ESd5KsrEpe2SyrDeA3AztEPCrpwcK0T/w5WpQ84yK	user	t	\N	2026-04-23 06:06:01.25568+00	2026-04-23 06:06:01.25568+00	local	\N	t	\N	0	\N	f	\N	\N	\N
9e9dd078-f199-4f92-8406-56221ef49c28	2372603a-5775-46f7-8335-43dcde0a2a07	new-98083f@example.com	$2a$12$fCvC/AHbz8NlaOEQCeHhKe7C4BytbLWEmfp.CceA6gDiFzLPeMNsS	padmin	t	\N	2026-04-23 06:06:01.665125+00	2026-04-23 06:06:01.665125+00	local	\N	t	\N	0	\N	f	\N	\N	\N
3dfd4a64-755c-496e-9b45-f31d70413a39	2372603a-5775-46f7-8335-43dcde0a2a07	new-3fea6f@example.com	$2a$12$jeZvKSHlGvZBpW.6K6uZje0of0isb7niKq0STk/6cfwDGbtv3lCDm	gadmin	t	\N	2026-04-23 06:06:02.012778+00	2026-04-23 06:06:02.012778+00	local	\N	t	\N	0	\N	f	\N	\N	\N
76921247-366c-4eab-adbb-30934671ca1f	10cc89f7-0092-4267-9b90-0bce22d1edab	u-ec3ecf00@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00	local	\N	f	\N	0	\N	f	\N	\N	\N
36566f26-b467-49b1-a6b8-7b2b673198f4	f936845a-e36a-459b-9b4b-dd5bddf1443e	u-0647354f@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	padmin	t	\N	2026-04-23 06:06:03.288483+00	2026-04-23 06:06:03.288483+00	local	\N	f	\N	0	\N	f	\N	\N	\N
fbb8537a-e556-47ea-a6dc-bcabbe92a8b5	f936845a-e36a-459b-9b4b-dd5bddf1443e	u-f222f488@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00	local	\N	f	\N	0	\N	f	\N	\N	\N
c43007f6-30b9-49de-9d96-38585886341a	876093ad-808b-47be-ae6c-e6705d7e57b1	u-9d33da6e@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00	local	\N	f	\N	0	\N	f	\N	\N	\N
060ff171-b110-4615-88c2-2c11f9fe986f	876093ad-808b-47be-ae6c-e6705d7e57b1	u-16477cfc@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	padmin	f	\N	2026-04-23 06:06:04.456391+00	2026-04-23 06:06:04.578663+00	local	\N	f	\N	0	\N	f	\N	\N	\N
f4dd18ea-7a09-4ec4-bca0-71c8c1bee84b	231c3275-4a6f-4589-af4b-1ac863e41f5a	u-2255aff1@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00	local	\N	f	\N	0	\N	f	\N	\N	\N
329a2da2-802b-4fbd-b239-806db669c0f4	231c3275-4a6f-4589-af4b-1ac863e41f5a	new-30db76@example.com	$2a$12$DOKcJBBn7o4HVAhStXDG6urB3h6oWPkCqwbEn019pkxPvpXCGtGI2	user	t	\N	2026-04-23 06:17:04.507382+00	2026-04-23 06:17:04.507382+00	local	\N	t	\N	0	\N	f	\N	\N	\N
e40faaca-ed61-4b32-9e00-345a551bb23f	231c3275-4a6f-4589-af4b-1ac863e41f5a	new-3250e9@example.com	$2a$12$nu3HHDmAIdw7mz2fuNX5aulQge.EEI1SRzAJy54XTVOaBQlaPM/3m	padmin	t	\N	2026-04-23 06:17:04.839242+00	2026-04-23 06:17:04.839242+00	local	\N	t	\N	0	\N	f	\N	\N	\N
f203b89c-68dc-4f33-91ca-0c72ed1cf2a6	231c3275-4a6f-4589-af4b-1ac863e41f5a	new-ac0b28@example.com	$2a$12$h3hw2JZ1J73jWeCaMnQUseAQ0tLDoT7aXA8sSQjNk7nKZ7f6NWpIK	gadmin	t	\N	2026-04-23 06:17:05.132897+00	2026-04-23 06:17:05.132897+00	local	\N	t	\N	0	\N	f	\N	\N	\N
ae705ff6-26ed-4d59-8ffd-9a093ada3e5d	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	u-2b958511@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00	local	\N	f	\N	0	\N	f	\N	\N	\N
c06937c7-c73a-4370-b22e-45400a8441e7	97492b25-c98a-48ee-9009-047c783b3f44	u-48e4a7ca@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	padmin	t	\N	2026-04-23 06:17:05.946941+00	2026-04-23 06:17:05.946941+00	local	\N	f	\N	0	\N	f	\N	\N	\N
b9cb1f18-66f0-4315-badc-9b20af6da3cb	97492b25-c98a-48ee-9009-047c783b3f44	u-96bb170c@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00	local	\N	f	\N	0	\N	f	\N	\N	\N
60e7b593-a97c-447b-b3da-7f4fcebb5a43	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	u-b6880ff5@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00	local	\N	f	\N	0	\N	f	\N	\N	\N
a78f25ed-1df5-44d3-949e-272080e0affd	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	u-6a4c2650@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	padmin	f	\N	2026-04-23 06:17:06.802008+00	2026-04-23 06:17:06.879549+00	local	\N	f	\N	0	\N	f	\N	\N	\N
c853e4f1-553e-485f-a627-2dd8bb604e84	3c60198d-1cf1-4443-af35-84f20511b17c	u-9708b02d@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00	local	\N	f	\N	0	\N	f	\N	\N	\N
883aee64-639e-4201-9320-9811ce0ce528	3c60198d-1cf1-4443-af35-84f20511b17c	new-c84e67@example.com	$2a$12$vrjaZJWe9qMfvR0XxFdtPetOJg8vE0HCVa2/bEyII9U6IBefTcbX2	user	t	\N	2026-04-24 22:12:46.882744+00	2026-04-24 22:12:46.882744+00	local	\N	t	\N	0	\N	f	\N	\N	\N
892997f0-4922-479e-920f-82f85b1b4b84	3c60198d-1cf1-4443-af35-84f20511b17c	new-a28372@example.com	$2a$12$ijQEaeJVfl8xIQFUiH5Rp.NG0s7sgzH/n5hyttZSiPDmNCGxU82AC	gadmin	t	\N	2026-04-24 22:12:47.624273+00	2026-04-24 22:12:47.624273+00	local	\N	t	\N	0	\N	f	\N	\N	\N
916f7c76-da0a-4ff7-9a36-b3a2d013e2af	96c676b2-8388-49bd-8fc1-e4adba6e8831	u-996337f1@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00	local	\N	f	\N	0	\N	f	\N	\N	\N
0410b772-2a5f-4504-bb30-85984eb449f8	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	u-ba1f4b7c@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	padmin	t	\N	2026-04-24 22:12:48.853715+00	2026-04-24 22:12:48.853715+00	local	\N	f	\N	0	\N	f	\N	\N	\N
e5f5fed0-3ed4-48a6-a64f-0d416d92dbb0	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	u-4246ae49@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00	local	\N	f	\N	0	\N	f	\N	\N	\N
d57588dc-c748-4240-8ecc-ce2f2d0826c6	635ed3cf-3d86-4985-89eb-8975012d1420	u-cec93fdd@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	gadmin	t	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00	local	\N	f	\N	0	\N	f	\N	\N	\N
b5a1732d-b3cc-4bcf-8f4a-e5e93fbfc51b	635ed3cf-3d86-4985-89eb-8975012d1420	u-223bdc41@example.com	$2a$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd	padmin	f	\N	2026-04-24 22:12:50.021449+00	2026-04-24 22:12:50.134941+00	local	\N	f	\N	0	\N	f	\N	\N	\N
\.


--
-- Data for Name: workspace; Type: TABLE DATA; Schema: public; Owner: mmff_dev
--

COPY public.workspace (id, subscription_id, company_roadmap_id, key_num, name, owner_user_id, archived_at, created_at, updated_at) FROM stdin;
0e794717-699e-4577-be0c-b419350d265b	00000000-0000-0000-0000-000000000001	bb51d169-ef92-4205-9ae2-ada94cba46cb	1	My Workspace	dbf65721-7b73-4906-a5d0-18fcd7b1db58	\N	2026-04-21 05:46:22.307829+00	2026-04-21 05:46:22.307829+00
32beb657-7090-4adb-a479-7faeccd57d13	231c3275-4a6f-4589-af4b-1ac863e41f5a	293cb1c8-452d-4dbd-95ae-e3d73580ebd2	1	My Workspace	f4dd18ea-7a09-4ec4-bca0-71c8c1bee84b	\N	2026-04-23 06:17:04.167639+00	2026-04-23 06:17:04.167639+00
38cc341b-f5d4-4b9e-bd15-722981a77baa	de48a74b-6fdd-43d8-ba69-93ec6d9d0160	03ef4711-1bce-4d2e-98a4-cc0365c21c86	1	My Workspace	ae705ff6-26ed-4d59-8ffd-9a093ada3e5d	\N	2026-04-23 06:17:05.488182+00	2026-04-23 06:17:05.488182+00
c4bbc795-56a7-4465-9f43-f8d3b1dfd0f4	97492b25-c98a-48ee-9009-047c783b3f44	76f01b45-9145-4a7b-955b-09ca405c15e3	1	My Workspace	b9cb1f18-66f0-4315-badc-9b20af6da3cb	\N	2026-04-23 06:17:05.967504+00	2026-04-23 06:17:05.967504+00
5726ee8a-c202-415a-bab3-cf87cdf6c8f7	9adc7407-5c6a-4cde-acb2-bc0f7af623c2	47aab634-e3bd-4a52-8300-71a07cee73ff	1	My Workspace	60e7b593-a97c-447b-b3da-7f4fcebb5a43	\N	2026-04-23 06:17:06.742455+00	2026-04-23 06:17:06.742455+00
f83c2e8b-0f56-47d7-afa2-8b93143ef00b	3c60198d-1cf1-4443-af35-84f20511b17c	f7f345e4-6caf-49b9-bae7-9f2c892e9d13	1	My Workspace	c853e4f1-553e-485f-a627-2dd8bb604e84	\N	2026-04-24 22:12:46.548477+00	2026-04-24 22:12:46.548477+00
e3e0eb83-5f2c-4e02-8800-845682b45664	96c676b2-8388-49bd-8fc1-e4adba6e8831	13d2d442-31ac-4c8f-a0e3-af6ada972a55	1	My Workspace	916f7c76-da0a-4ff7-9a36-b3a2d013e2af	\N	2026-04-24 22:12:48.185961+00	2026-04-24 22:12:48.185961+00
334ad168-a744-4422-9ac8-d1adc631c3f3	1a36a25b-8a5c-4e52-b59a-76b24f6d9543	2f5a4d4f-31ca-4a54-97b7-e88ff2509066	1	My Workspace	e5f5fed0-3ed4-48a6-a64f-0d416d92dbb0	\N	2026-04-24 22:12:48.887502+00	2026-04-24 22:12:48.887502+00
a6695cd0-01ef-4627-a863-9d47a4669e62	635ed3cf-3d86-4985-89eb-8975012d1420	e6d5f93b-5049-4105-b31e-7824d7cac625	1	My Workspace	d57588dc-c748-4240-8ecc-ce2f2d0826c6	\N	2026-04-24 22:12:49.958356+00	2026-04-24 22:12:49.958356+00
07779114-f12e-4191-8856-1a761eff8e63	cd12a3eb-10cf-4e67-b3fa-f7063c97725d	ac1cda0a-ece6-4fad-8eb4-60cbb4b7e19a	1	My Workspace	45501c52-9ef3-4bbb-9ebb-a83084306802	\N	2026-04-23 06:05:43.305888+00	2026-04-23 06:05:43.305888+00
c30894ad-825a-4567-9ce2-c2f0bf4f38c2	359fb261-0f98-4adc-9ff8-fa03ad8a77dc	15ba9e8d-b82b-4543-b63b-1bdd1a0fa6ce	1	My Workspace	95f6f04a-da7f-418d-b9d2-4e94767872ba	\N	2026-04-23 06:05:44.631317+00	2026-04-23 06:05:44.631317+00
8fb68ada-0673-42c9-8f49-02eaa56dc7d3	4fe02761-85c9-409a-9ea9-04c10f536394	60be15f0-bc7c-4653-b91f-b3d0d1829d99	1	My Workspace	d89e9e28-3702-4c76-8f11-0f1bd96b98d4	\N	2026-04-23 06:05:45.104266+00	2026-04-23 06:05:45.104266+00
0a9f3365-5c2a-41b7-96c6-538790cb8166	1e2e4435-7c7b-4f13-898b-872f38a55ffd	be53cf9d-7ddd-4c5d-b619-93c24a50a9c6	1	My Workspace	51f70c45-02d5-40d6-a063-a4ddab4a6f7e	\N	2026-04-23 06:05:46.205643+00	2026-04-23 06:05:46.205643+00
03509a03-6c4d-4df1-85aa-c88d617ab3b5	2372603a-5775-46f7-8335-43dcde0a2a07	3361d1d7-4a9d-4822-b416-bcf2d7e8b15d	1	My Workspace	22645a90-02a1-4cfb-9dc1-b8ad690e91f2	\N	2026-04-23 06:06:00.889009+00	2026-04-23 06:06:00.889009+00
83549435-de1a-459a-a0cf-687d0c150dd4	10cc89f7-0092-4267-9b90-0bce22d1edab	4718999b-b91f-40cf-9879-bac6ea5e4f09	1	My Workspace	76921247-366c-4eab-adbb-30934671ca1f	\N	2026-04-23 06:06:02.598873+00	2026-04-23 06:06:02.598873+00
a766edab-a312-4c77-b584-c4cb2fde7a97	f936845a-e36a-459b-9b4b-dd5bddf1443e	0641ed79-1ac3-45aa-b987-18d6ed1062a3	1	My Workspace	fbb8537a-e556-47ea-a6dc-bcabbe92a8b5	\N	2026-04-23 06:06:03.316659+00	2026-04-23 06:06:03.316659+00
5bb9f018-c87b-448c-94c2-c22e2e7482d1	876093ad-808b-47be-ae6c-e6705d7e57b1	18c15e1f-36e7-4178-9df9-6491c91a061b	1	My Workspace	c43007f6-30b9-49de-9d96-38585886341a	\N	2026-04-23 06:06:04.398317+00	2026-04-23 06:06:04.398317+00
\.


--
-- Name: company_roadmap company_roadmap_key_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: company_roadmap company_roadmap_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_pkey PRIMARY KEY (id);


--
-- Name: company_roadmap company_roadmap_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_subscription_id_key UNIQUE (subscription_id);


--
-- Name: item_type_transition_edges edge_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_transition_edges
    ADD CONSTRAINT edge_unique UNIQUE (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id);


--
-- Name: entity_stakeholders entity_stakeholders_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.entity_stakeholders
    ADD CONSTRAINT entity_stakeholders_pkey PRIMARY KEY (id);


--
-- Name: execution_item_types execution_item_types_name_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.execution_item_types
    ADD CONSTRAINT execution_item_types_name_unique UNIQUE (subscription_id, name);


--
-- Name: execution_item_types execution_item_types_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.execution_item_types
    ADD CONSTRAINT execution_item_types_pkey PRIMARY KEY (id);


--
-- Name: execution_item_types execution_item_types_tag_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.execution_item_types
    ADD CONSTRAINT execution_item_types_tag_unique UNIQUE (subscription_id, tag);


--
-- Name: item_type_states item_type_states_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_states
    ADD CONSTRAINT item_type_states_pkey PRIMARY KEY (id);


--
-- Name: item_type_states item_type_states_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_states
    ADD CONSTRAINT item_type_states_unique UNIQUE (subscription_id, item_type_id, item_type_kind, name);


--
-- Name: item_type_transition_edges item_type_transition_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_transition_edges
    ADD CONSTRAINT item_type_transition_edges_pkey PRIMARY KEY (id);


--
-- Name: portfolio_item_types portfolio_item_types_name_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.portfolio_item_types
    ADD CONSTRAINT portfolio_item_types_name_unique UNIQUE (subscription_id, name);


--
-- Name: portfolio_item_types portfolio_item_types_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.portfolio_item_types
    ADD CONSTRAINT portfolio_item_types_pkey PRIMARY KEY (id);


--
-- Name: portfolio_item_types portfolio_item_types_tag_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.portfolio_item_types
    ADD CONSTRAINT portfolio_item_types_tag_unique UNIQUE (subscription_id, tag);


--
-- Name: product product_key_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: product product_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (id);


--
-- Name: entity_stakeholders stakeholder_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.entity_stakeholders
    ADD CONSTRAINT stakeholder_unique UNIQUE (entity_kind, entity_id, user_id, role);


--
-- Name: subscription_sequence subscription_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.subscription_sequence
    ADD CONSTRAINT subscription_sequence_pkey PRIMARY KEY (subscription_id, scope);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_slug_key; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_slug_key UNIQUE (slug);


--
-- Name: users users_email_subscription_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_subscription_unique UNIQUE (email, subscription_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace workspace_key_unique; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_key_unique UNIQUE (subscription_id, key_num);


--
-- Name: workspace workspace_pkey; Type: CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_pkey PRIMARY KEY (id);


--
-- Name: idx_execution_item_types_active; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_execution_item_types_active ON public.execution_item_types USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_execution_item_types_subscription_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_execution_item_types_subscription_id ON public.execution_item_types USING btree (subscription_id);


--
-- Name: idx_item_type_states_active; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_item_type_states_active ON public.item_type_states USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_item_type_states_canonical; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_item_type_states_canonical ON public.item_type_states USING btree (canonical_code);


--
-- Name: idx_item_type_states_subscription_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_item_type_states_subscription_id ON public.item_type_states USING btree (subscription_id);


--
-- Name: idx_item_type_states_type; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_item_type_states_type ON public.item_type_states USING btree (item_type_id, item_type_kind);


--
-- Name: idx_portfolio_item_types_active; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_portfolio_item_types_active ON public.portfolio_item_types USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_portfolio_item_types_subscription_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_portfolio_item_types_subscription_id ON public.portfolio_item_types USING btree (subscription_id);


--
-- Name: idx_product_active; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_product_active ON public.product USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_product_parent_portfolio_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_product_parent_portfolio_id ON public.product USING btree (parent_portfolio_id);


--
-- Name: idx_product_subscription_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_product_subscription_id ON public.product USING btree (subscription_id);


--
-- Name: idx_product_workspace_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_product_workspace_id ON public.product USING btree (workspace_id);


--
-- Name: idx_stakeholders_entity; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_stakeholders_entity ON public.entity_stakeholders USING btree (entity_kind, entity_id);


--
-- Name: idx_stakeholders_subscription_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_stakeholders_subscription_id ON public.entity_stakeholders USING btree (subscription_id);


--
-- Name: idx_stakeholders_user; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_stakeholders_user ON public.entity_stakeholders USING btree (user_id);


--
-- Name: idx_transition_edges_from; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_transition_edges_from ON public.item_type_transition_edges USING btree (from_state_id);


--
-- Name: idx_transition_edges_subscription_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_transition_edges_subscription_id ON public.item_type_transition_edges USING btree (subscription_id);


--
-- Name: idx_transition_edges_to; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_transition_edges_to ON public.item_type_transition_edges USING btree (to_state_id);


--
-- Name: idx_transition_edges_type; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_transition_edges_type ON public.item_type_transition_edges USING btree (item_type_id, item_type_kind);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_subscription_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_users_subscription_id ON public.users USING btree (subscription_id);


--
-- Name: idx_workspace_active; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_workspace_active ON public.workspace USING btree (subscription_id) WHERE (archived_at IS NULL);


--
-- Name: idx_workspace_company_roadmap_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_workspace_company_roadmap_id ON public.workspace USING btree (company_roadmap_id);


--
-- Name: idx_workspace_subscription_id; Type: INDEX; Schema: public; Owner: mmff_dev
--

CREATE INDEX idx_workspace_subscription_id ON public.workspace USING btree (subscription_id);


--
-- Name: company_roadmap trg_company_roadmap_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_company_roadmap_updated_at BEFORE UPDATE ON public.company_roadmap FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: entity_stakeholders trg_entity_stakeholders_dispatch; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_entity_stakeholders_dispatch BEFORE INSERT OR UPDATE OF entity_kind, entity_id, subscription_id ON public.entity_stakeholders FOR EACH ROW EXECUTE FUNCTION public.trg_entity_stakeholders_dispatch();


--
-- Name: execution_item_types trg_execution_item_types_lock_name; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_execution_item_types_lock_name BEFORE UPDATE ON public.execution_item_types FOR EACH ROW EXECUTE FUNCTION public.execution_item_types_lock_name();


--
-- Name: execution_item_types trg_execution_item_types_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_execution_item_types_updated_at BEFORE UPDATE ON public.execution_item_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: item_type_states trg_item_type_states_dispatch; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_item_type_states_dispatch BEFORE INSERT OR UPDATE OF item_type_kind, item_type_id, subscription_id ON public.item_type_states FOR EACH ROW EXECUTE FUNCTION public.trg_item_type_states_dispatch();


--
-- Name: item_type_states trg_item_type_states_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_item_type_states_updated_at BEFORE UPDATE ON public.item_type_states FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_item_types trg_portfolio_item_types_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_portfolio_item_types_updated_at BEFORE UPDATE ON public.portfolio_item_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product trg_product_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_product_updated_at BEFORE UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_provision_on_first_gadmin; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_provision_on_first_gadmin AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.provision_on_first_gadmin();


--
-- Name: subscription_sequence trg_subscription_sequence_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_subscription_sequence_updated_at BEFORE UPDATE ON public.subscription_sequence FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions trg_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace trg_workspace_updated_at; Type: TRIGGER; Schema: public; Owner: mmff_dev
--

CREATE TRIGGER trg_workspace_updated_at BEFORE UPDATE ON public.workspace FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: company_roadmap company_roadmap_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: company_roadmap company_roadmap_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.company_roadmap
    ADD CONSTRAINT company_roadmap_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: entity_stakeholders entity_stakeholders_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.entity_stakeholders
    ADD CONSTRAINT entity_stakeholders_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: entity_stakeholders entity_stakeholders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.entity_stakeholders
    ADD CONSTRAINT entity_stakeholders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: execution_item_types execution_item_types_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.execution_item_types
    ADD CONSTRAINT execution_item_types_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: item_type_states item_type_states_canonical_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_states
    ADD CONSTRAINT item_type_states_canonical_code_fkey FOREIGN KEY (canonical_code) REFERENCES public.canonical_states(code) ON DELETE RESTRICT;


--
-- Name: item_type_states item_type_states_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_states
    ADD CONSTRAINT item_type_states_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: item_type_transition_edges item_type_transition_edges_from_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_transition_edges
    ADD CONSTRAINT item_type_transition_edges_from_state_id_fkey FOREIGN KEY (from_state_id) REFERENCES public.item_type_states(id) ON DELETE RESTRICT;


--
-- Name: item_type_transition_edges item_type_transition_edges_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_transition_edges
    ADD CONSTRAINT item_type_transition_edges_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: item_type_transition_edges item_type_transition_edges_to_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.item_type_transition_edges
    ADD CONSTRAINT item_type_transition_edges_to_state_id_fkey FOREIGN KEY (to_state_id) REFERENCES public.item_type_states(id) ON DELETE RESTRICT;


--
-- Name: portfolio_item_types portfolio_item_types_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.portfolio_item_types
    ADD CONSTRAINT portfolio_item_types_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: product product_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: product product_parent_portfolio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_parent_portfolio_id_fkey FOREIGN KEY (parent_portfolio_id) REFERENCES public.portfolio(id) ON DELETE RESTRICT;


--
-- Name: product product_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: product product_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE RESTRICT;


--
-- Name: subscription_sequence subscription_sequence_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.subscription_sequence
    ADD CONSTRAINT subscription_sequence_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: users users_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- Name: workspace workspace_company_roadmap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_company_roadmap_id_fkey FOREIGN KEY (company_roadmap_id) REFERENCES public.company_roadmap(id) ON DELETE RESTRICT;


--
-- Name: workspace workspace_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workspace workspace_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mmff_dev
--

ALTER TABLE ONLY public.workspace
    ADD CONSTRAINT workspace_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict TsGbcLww1AqL9dAzoHtId0CrN4mlZ9VCSUolPVpg4RzkEargxgDgmKIjU1yi9Ce

