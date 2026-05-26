-- ============================================================
-- 113_p2_move_collisions.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 5 of N.
--
-- Resolves the 4 non-MRW collisions between mmff_vector and
-- vector_artefacts. Per handovers/refactorDB_collisions.md, all 4
-- are PARITY-DROPS: VA's copies are empty placeholder shells; the
-- live data (where any exists) lives in mmff_v. Resolution = drop
-- VA's empty copy, create-fresh in VA, optionally copy data.
--
-- Tables in scope:
--   1. admin_api_keys   (mmff_v: 50 rows, VA: 0)  — COPY 50 rows
--   2. users_sessions   (mmff_v: 1411 rows, VA: 0) — COPY 1411 rows
--   3. csp_reports      (mmff_v: 0, VA: 0)        — fresh-create only,
--                                                    adopt prefixed shape
--   4. dpop_jti_cache   (mmff_v: 15 rows, VA: 0)  — fresh-create with
--                                                    prefixed shape, SKIP
--                                                    the 15 rows (DPoP
--                                                    replay cache is
--                                                    ephemeral, TTL out
--                                                    within minutes)
--
-- Notes:
--   * admin_api_keys + users_sessions are ALREADY prefix-swept on
--     both sides (Pillar 1 wave 4–5). VA's empty copy has the same
--     column shape as mmff_v's, so we drop it cleanly and recreate.
--   * csp_reports + dpop_jti_cache are still BARE-COLUMN in BOTH
--     DBs (Pillar 1 explicitly skipped them per the collision
--     register). We adopt the prefix-swept shape here, fresh — no
--     in-place ALTER on either side. The bare columns evaporate
--     when mmff_v's copy is dropped in Pillar 3.
--   * FK constraints on admin_api_keys (→ subscriptions, users) and
--     users_sessions (→ users) are deferred to 118_p2_add_all_fks.sql.
-- ============================================================

BEGIN;

-- ---- Drop VA's empty placeholder copies first ----
DROP TABLE IF EXISTS public.admin_api_keys CASCADE;
DROP TABLE IF EXISTS public.users_sessions CASCADE;
DROP TABLE IF EXISTS public.csp_reports CASCADE;
DROP TABLE IF EXISTS public.dpop_jti_cache CASCADE;


-- ======================================================================
-- TABLE 1: admin_api_keys
-- ======================================================================

CREATE TABLE public.admin_api_keys (
    admin_api_keys_id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_api_keys_id_subscription uuid NOT NULL,
    admin_api_keys_prefix text NOT NULL,
    admin_api_keys_hash bytea NOT NULL,
    admin_api_keys_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    admin_api_keys_rate_limit_config jsonb,
    admin_api_keys_created_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_api_keys_expires_at timestamp with time zone,
    admin_api_keys_revoked_at timestamp with time zone,
    admin_api_keys_last_used_at timestamp with time zone,
    admin_api_keys_id_user_creator uuid
);

ALTER TABLE ONLY public.admin_api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (admin_api_keys_id);

ALTER TABLE ONLY public.admin_api_keys
    ADD CONSTRAINT admin_api_keys_hash_key UNIQUE (admin_api_keys_hash);

ALTER TABLE ONLY public.admin_api_keys
    ADD CONSTRAINT admin_api_keys_prefix_key UNIQUE (admin_api_keys_prefix);

CREATE INDEX idx_admin_api_keys_expires_at ON public.admin_api_keys USING btree (admin_api_keys_expires_at);
CREATE INDEX idx_admin_api_keys_id_subscription ON public.admin_api_keys USING btree (admin_api_keys_id_subscription);
CREATE INDEX idx_admin_api_keys_prefix ON public.admin_api_keys USING btree (admin_api_keys_prefix);
CREATE INDEX idx_admin_api_keys_revoked_at ON public.admin_api_keys USING btree (admin_api_keys_revoked_at);

INSERT INTO public.admin_api_keys (
    admin_api_keys_id, admin_api_keys_id_subscription, admin_api_keys_prefix,
    admin_api_keys_hash, admin_api_keys_scopes, admin_api_keys_rate_limit_config,
    admin_api_keys_created_at, admin_api_keys_expires_at, admin_api_keys_revoked_at,
    admin_api_keys_last_used_at, admin_api_keys_id_user_creator
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT admin_api_keys_id, admin_api_keys_id_subscription, admin_api_keys_prefix, admin_api_keys_hash, admin_api_keys_scopes, admin_api_keys_rate_limit_config, admin_api_keys_created_at, admin_api_keys_expires_at, admin_api_keys_revoked_at, admin_api_keys_last_used_at, admin_api_keys_id_user_creator FROM public.admin_api_keys')
AS t(
    admin_api_keys_id uuid, admin_api_keys_id_subscription uuid,
    admin_api_keys_prefix text, admin_api_keys_hash bytea,
    admin_api_keys_scopes text[], admin_api_keys_rate_limit_config jsonb,
    admin_api_keys_created_at timestamp with time zone,
    admin_api_keys_expires_at timestamp with time zone,
    admin_api_keys_revoked_at timestamp with time zone,
    admin_api_keys_last_used_at timestamp with time zone,
    admin_api_keys_id_user_creator uuid
);

SELECT _p2_assert_rowcount('admin_api_keys', _p2_source_rowcount('admin_api_keys'));


-- ======================================================================
-- TABLE 2: users_sessions
-- ======================================================================

CREATE TABLE public.users_sessions (
    users_sessions_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_sessions_id_user uuid NOT NULL,
    users_sessions_token_hash text NOT NULL,
    users_sessions_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_sessions_expires_at timestamp with time zone NOT NULL,
    users_sessions_last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    users_sessions_ip_address inet,
    users_sessions_user_agent text,
    users_sessions_revoked boolean DEFAULT false NOT NULL,
    users_sessions_rotated_at timestamp with time zone,
    users_sessions_successor_hash text,
    users_sessions_dpop_jkt text NOT NULL,
    users_sessions_first_ip inet,
    users_sessions_first_asn text,
    users_sessions_first_country text,
    users_sessions_first_ua_fp text
);

ALTER TABLE ONLY public.users_sessions
    ADD CONSTRAINT users_sessions_pkey PRIMARY KEY (users_sessions_id);

ALTER TABLE ONLY public.users_sessions
    ADD CONSTRAINT users_sessions_token_hash_key UNIQUE (users_sessions_token_hash);

CREATE INDEX idx_users_sessions_expires_at ON public.users_sessions USING btree (users_sessions_expires_at);
CREATE INDEX idx_users_sessions_id_user ON public.users_sessions USING btree (users_sessions_id_user);
CREATE INDEX idx_users_sessions_successor_hash
    ON public.users_sessions USING btree (users_sessions_successor_hash)
    WHERE (users_sessions_successor_hash IS NOT NULL);
CREATE INDEX idx_users_sessions_token_hash ON public.users_sessions USING btree (users_sessions_token_hash);

INSERT INTO public.users_sessions (
    users_sessions_id, users_sessions_id_user, users_sessions_token_hash,
    users_sessions_created_at, users_sessions_expires_at, users_sessions_last_used_at,
    users_sessions_ip_address, users_sessions_user_agent, users_sessions_revoked,
    users_sessions_rotated_at, users_sessions_successor_hash, users_sessions_dpop_jkt,
    users_sessions_first_ip, users_sessions_first_asn, users_sessions_first_country,
    users_sessions_first_ua_fp
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_sessions_id, users_sessions_id_user, users_sessions_token_hash, users_sessions_created_at, users_sessions_expires_at, users_sessions_last_used_at, users_sessions_ip_address, users_sessions_user_agent, users_sessions_revoked, users_sessions_rotated_at, users_sessions_successor_hash, users_sessions_dpop_jkt, users_sessions_first_ip, users_sessions_first_asn, users_sessions_first_country, users_sessions_first_ua_fp FROM public.users_sessions')
AS t(
    users_sessions_id uuid, users_sessions_id_user uuid, users_sessions_token_hash text,
    users_sessions_created_at timestamp with time zone,
    users_sessions_expires_at timestamp with time zone,
    users_sessions_last_used_at timestamp with time zone,
    users_sessions_ip_address inet, users_sessions_user_agent text,
    users_sessions_revoked boolean,
    users_sessions_rotated_at timestamp with time zone,
    users_sessions_successor_hash text, users_sessions_dpop_jkt text,
    users_sessions_first_ip inet, users_sessions_first_asn text,
    users_sessions_first_country text, users_sessions_first_ua_fp text
);

SELECT _p2_assert_rowcount('users_sessions', _p2_source_rowcount('users_sessions'));


-- ======================================================================
-- TABLE 3: csp_reports — fresh-create with PREFIX-SWEPT shape
--
-- Both copies were bare-column on the way in; both empty. We adopt
-- the full <table>_<col> shape per the column-prefix HARD RULE.
-- No data copy step needed. The bare-column source in mmff_v gets
-- dropped in Pillar 3; no risk of column-name drift since nothing
-- writes to mmff_v.csp_reports between Pillar 2 and Pillar 3
-- (csp_reports is currently routed to vaPool by the backend's CSP
-- handler post Pillar 1).
-- ======================================================================

CREATE TABLE public.csp_reports (
    csp_reports_id uuid DEFAULT gen_random_uuid() NOT NULL,
    csp_reports_received_at timestamp with time zone DEFAULT now() NOT NULL,
    csp_reports_document_uri text,
    csp_reports_referrer text,
    csp_reports_violated_directive text,
    csp_reports_effective_directive text,
    csp_reports_original_policy text,
    csp_reports_disposition text,
    csp_reports_blocked_uri text,
    csp_reports_source_file text,
    csp_reports_line_number integer,
    csp_reports_column_number integer,
    csp_reports_status_code integer,
    csp_reports_user_agent text,
    csp_reports_remote_ip inet,
    csp_reports_raw jsonb NOT NULL,
    csp_reports_id_subscription uuid
);

ALTER TABLE ONLY public.csp_reports
    ADD CONSTRAINT csp_reports_pkey PRIMARY KEY (csp_reports_id);

CREATE INDEX idx_csp_reports_received_at_desc
    ON public.csp_reports USING btree (csp_reports_received_at DESC);

CREATE INDEX idx_csp_reports_violated_directive
    ON public.csp_reports USING btree (csp_reports_violated_directive, csp_reports_received_at DESC);

-- No INSERT — both sides were 0 rows.


-- ======================================================================
-- TABLE 4: dpop_jti_cache — fresh-create with PREFIX-SWEPT shape
--
-- Adopt prefixed column names. The 15 ephemeral rows in mmff_v are
-- DPoP replay-prevention JTI entries (RFC 9449) that TTL out within
-- minutes; per the collision register, we SKIP the data copy and
-- let the cache rebuild naturally. The backend's DPoP handler will
-- repoint from mmff_v.dpop_jti_cache to VA.dpop_jti_cache in
-- Pillar 3 (or earlier, since the table is now the canonical home).
-- ======================================================================

CREATE TABLE public.dpop_jti_cache (
    dpop_jti_cache_jti text NOT NULL,
    dpop_jti_cache_expires_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.dpop_jti_cache
    ADD CONSTRAINT dpop_jti_cache_pkey PRIMARY KEY (dpop_jti_cache_jti);

CREATE INDEX idx_dpop_jti_cache_expires_at
    ON public.dpop_jti_cache USING btree (dpop_jti_cache_expires_at);

-- No INSERT — 15 ephemeral rows discarded by design (see comment above).

COMMIT;
