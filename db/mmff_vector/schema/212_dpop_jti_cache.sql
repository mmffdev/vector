-- 212_dpop_jti_cache.sql
-- TD-SEC-DPOP-BINDING Phase 1 — Postgres-backed replay cache for DPoP
-- proof JTIs (RFC 9449 §4.3 requirement 11: "the jti value has not been
-- used before in this context").
--
-- Why Postgres and not in-memory: chosen 2026-05-18 over a sync.Map
-- because (a) it survives Go restart so an attacker can't race a reuse
-- inside the rolling-restart window, (b) it's multi-instance-ready from
-- day 1 if Vector ever scales horizontally, (c) it slots into the same
-- ops/backup pattern as the rest of the auth substrate.
--
-- Why no FK to users / sessions: jti is per-proof, not per-session. A
-- single session generates thousands of jtis over its lifetime — they're
-- ephemeral signing nonces, not identity records. Cleaning them up is
-- the cron's job, not the foreign-key cascade's.
--
-- Cleanup: a goroutine in backend/cmd/server/main.go runs
-- `DELETE FROM dpop_jti_cache WHERE expires_at <= NOW()` every 10
-- minutes. expires_at is iat + iat-tolerance-window + buffer (default
-- 180 seconds — see backend/internal/auth/dpop.go). PK conflict on
-- INSERT is the replay signal — see jti_cache.go MarkAndCheck.

BEGIN;

CREATE TABLE dpop_jti_cache (
  jti        text         PRIMARY KEY,
  expires_at timestamptz  NOT NULL
);

-- Cleanup-cron range scan: "give me everything past expiry". Without
-- the index this is a seq scan every 10 minutes; with it, the cron is
-- an index range delete that never touches live entries.
CREATE INDEX idx_dpop_jti_cache_expires_at
  ON dpop_jti_cache (expires_at);

COMMENT ON TABLE dpop_jti_cache IS
  'RFC 9449 DPoP proof JTI replay cache. Each row records that a proof '
  'jti has been seen; INSERT ... ON CONFLICT DO NOTHING returning '
  'xmax=0 is the "first time seen" signal (any other result is a '
  'replay attempt → 401 invalid_dpop_proof). Cleaned by a 10-min '
  'background cron in backend/cmd/server/main.go. See '
  'TD-SEC-DPOP-BINDING in docs/c_tech_debt.md.';

INSERT INTO schema_migrations (filename) VALUES ('212_dpop_jti_cache.sql');

COMMIT;
