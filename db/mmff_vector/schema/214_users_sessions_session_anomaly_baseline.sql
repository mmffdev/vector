-- 214_users_sessions_session_anomaly_baseline.sql
-- TD-SEC-SESSION-ANOMALY Stage 2 — drift detection needs a known
-- "where did this session start" baseline. Adding four columns to
-- users_sessions captures the IP/ASN/country/UA-fingerprint at login,
-- so subsequent refresh requests can compare against that origin
-- and trigger step-up auth when the difference crosses a threshold.
--
-- Why on users_sessions and not in audit_logs.metadata: drift checks
-- run on every refresh (hot path). A typed-column lookup on the
-- session row is one indexed read; pulling from audit_logs.metadata
-- JSON would require a separate query + jsonb path expression on
-- every refresh. The audit_logs row remains the forensic record;
-- these columns are the cheap runtime cache.
--
-- Nullable so a session predating the deploy still loads cleanly
-- (just no drift check until next login). Production already wiped
-- all sessions in TD-SEC-DPOP-BINDING Phase 6, so in practice
-- every live row WILL have these populated.

BEGIN;

ALTER TABLE users_sessions
  ADD COLUMN users_sessions_first_ip      inet,
  ADD COLUMN users_sessions_first_asn     text,
  ADD COLUMN users_sessions_first_country text,
  ADD COLUMN users_sessions_first_ua_fp   text;

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

INSERT INTO schema_migrations (filename) VALUES ('214_users_sessions_session_anomaly_baseline.sql');

COMMIT;
