-- ============================================================
-- PLA064 / CUT1.3.1 part 1 — Replicate auth/identity cluster schema
--
-- Creates EMPTY replicas of 4 mmff_vector tables in vector_artefacts:
--   admin_api_keys, csp_reports, dpop_jti_cache, users_sessions.
--
-- The data ETL is CUT1.3.1 part 2 (separate ship).
-- The pool-swap to vaPool is CUT1.4.1 (Phase 4).
-- schema_migrations excluded — per-DB history stays per-DB until
-- Phase 6 decommission.
--
-- Cross-DB FK note: admin_api_keys.admin_api_keys_id_subscription →
-- subscriptions(id) and admin_api_keys.admin_api_keys_id_user_creator →
-- users(id); users_sessions.users_sessions_id_user → users(id) are
-- present in mmff_vector but omitted here because cross-DB FKs are
-- impossible in Postgres (soft FK, app-enforced per SY003). These FKs
-- will be reinstated against the VA-side subscriptions/users replicas
-- once those tables are in vector_artefacts (CUT1.3.x / CUT1.4.x).
--
-- Schemas captured from LIVE mmff_vector tables via information_schema
-- introspection 2026-05-25, folding in all post-CREATE ALTERs.
-- 0-inbound: no foreign tables in vector_artefacts reference these 4
-- tables, so order within the migration is free.
-- ============================================================

BEGIN;

-- ── admin_api_keys ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_api_keys (
    admin_api_keys_id               uuid        NOT NULL DEFAULT gen_random_uuid(),
    admin_api_keys_id_subscription  uuid        NOT NULL,
    admin_api_keys_prefix           text        NOT NULL,
    admin_api_keys_hash             bytea       NOT NULL,
    admin_api_keys_scopes           text[]      NOT NULL DEFAULT '{}',
    admin_api_keys_rate_limit_config jsonb,
    admin_api_keys_created_at       timestamptz NOT NULL DEFAULT now(),
    admin_api_keys_expires_at       timestamptz,
    admin_api_keys_revoked_at       timestamptz,
    admin_api_keys_last_used_at     timestamptz,
    admin_api_keys_id_user_creator  uuid,

    CONSTRAINT api_keys_pkey               PRIMARY KEY (admin_api_keys_id),
    CONSTRAINT admin_api_keys_hash_key     UNIQUE      (admin_api_keys_hash),
    CONSTRAINT admin_api_keys_prefix_key   UNIQUE      (admin_api_keys_prefix)
    -- Cross-DB FKs omitted: subscriptions and users not yet in vector_artefacts.
    -- Reinstate at CUT1.3.x when those replica tables land.
);

CREATE INDEX IF NOT EXISTS idx_admin_api_keys_id_subscription
    ON admin_api_keys (admin_api_keys_id_subscription);
CREATE INDEX IF NOT EXISTS idx_admin_api_keys_prefix
    ON admin_api_keys (admin_api_keys_prefix);
CREATE INDEX IF NOT EXISTS idx_admin_api_keys_expires_at
    ON admin_api_keys (admin_api_keys_expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_api_keys_revoked_at
    ON admin_api_keys (admin_api_keys_revoked_at);


-- ── csp_reports ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS csp_reports (
    id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
    received_at         timestamptz NOT NULL DEFAULT now(),
    document_uri        text,
    referrer            text,
    violated_directive  text,
    effective_directive text,
    original_policy     text,
    disposition         text,
    blocked_uri         text,
    source_file         text,
    line_number         integer,
    column_number       integer,
    status_code         integer,
    user_agent          text,
    remote_ip           inet,
    raw                 jsonb       NOT NULL,
    subscription_id     uuid,

    CONSTRAINT csp_reports_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE csp_reports IS
    'Browser CSP violation reports received at /_site/csp-report. '
    'Subscription nullable because pre-login pages (login, reset, help) '
    'also report. See TD-SEC-CSP-NONCES-SRI in docs/c_tech_debt.md.';

CREATE INDEX IF NOT EXISTS idx_csp_reports_received_at_desc
    ON csp_reports (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_csp_reports_violated_directive
    ON csp_reports (violated_directive, received_at DESC);


-- ── dpop_jti_cache ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dpop_jti_cache (
    jti         text        NOT NULL,
    expires_at  timestamptz NOT NULL,

    CONSTRAINT dpop_jti_cache_pkey PRIMARY KEY (jti)
);

COMMENT ON TABLE dpop_jti_cache IS
    'RFC 9449 DPoP proof JTI replay cache. Each row records that a proof '
    'jti has been seen; INSERT ... ON CONFLICT DO NOTHING returning xmax=0 '
    'is the "first time seen" signal (any other result is a replay attempt '
    '→ 401 invalid_dpop_proof). Cleaned by a 10-min background cron in '
    'backend/cmd/server/main.go. See TD-SEC-DPOP-BINDING in docs/c_tech_debt.md.';

CREATE INDEX IF NOT EXISTS idx_dpop_jti_cache_expires_at
    ON dpop_jti_cache (expires_at);


-- ── users_sessions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users_sessions (
    users_sessions_id             uuid        NOT NULL DEFAULT gen_random_uuid(),
    users_sessions_id_user        uuid        NOT NULL,
    users_sessions_token_hash     text        NOT NULL,
    users_sessions_created_at     timestamptz NOT NULL DEFAULT now(),
    users_sessions_expires_at     timestamptz NOT NULL,
    users_sessions_last_used_at   timestamptz NOT NULL DEFAULT now(),
    users_sessions_ip_address     inet,
    users_sessions_user_agent     text,
    users_sessions_revoked        boolean     NOT NULL DEFAULT false,
    users_sessions_rotated_at     timestamptz,
    users_sessions_successor_hash text,
    users_sessions_dpop_jkt       text        NOT NULL,
    users_sessions_first_ip       inet,
    users_sessions_first_asn      text,
    users_sessions_first_country  text,
    users_sessions_first_ua_fp    text,

    CONSTRAINT users_sessions_pkey           PRIMARY KEY (users_sessions_id),
    CONSTRAINT users_sessions_token_hash_key UNIQUE      (users_sessions_token_hash)
    -- Cross-DB FK omitted: users not yet in vector_artefacts.
    -- Reinstate when users replica lands (CUT1.3.x / CUT1.4.x).
);

COMMENT ON COLUMN users_sessions.users_sessions_dpop_jkt IS
    'RFC 7638 base64url SHA-256 thumbprint of the DPoP public key that '
    'bound this session at login. NOT NULL — every session is DPoP-bound. '
    'See TD-SEC-DPOP-BINDING in docs/c_tech_debt.md.';
COMMENT ON COLUMN users_sessions.users_sessions_first_ip IS
    'IP address observed at session creation (login or mfa_verify). '
    'Used by TD-SEC-SESSION-ANOMALY drift detection on every refresh.';
COMMENT ON COLUMN users_sessions.users_sessions_first_asn IS
    'ASN resolved via MaxMind GeoLite2-ASN at session creation. NULL when '
    'lookup failed or DB unavailable. Drift = different ASN on refresh.';
COMMENT ON COLUMN users_sessions.users_sessions_first_country IS
    'ISO 3166-1 alpha-2 country resolved at session creation. NULL on '
    'lookup miss. Drift = different country on refresh → step-up.';
COMMENT ON COLUMN users_sessions.users_sessions_first_ua_fp IS
    'SHA-256 base64url of the User-Agent string at session creation. '
    'Cheap equality check on refresh; raw UA is in audit_logs.metadata.';

CREATE INDEX IF NOT EXISTS idx_users_sessions_id_user
    ON users_sessions (users_sessions_id_user);
CREATE INDEX IF NOT EXISTS idx_users_sessions_token_hash
    ON users_sessions (users_sessions_token_hash);
CREATE INDEX IF NOT EXISTS idx_users_sessions_expires_at
    ON users_sessions (users_sessions_expires_at);
CREATE INDEX IF NOT EXISTS idx_users_sessions_successor_hash
    ON users_sessions (users_sessions_successor_hash)
    WHERE users_sessions_successor_hash IS NOT NULL;

COMMIT;
