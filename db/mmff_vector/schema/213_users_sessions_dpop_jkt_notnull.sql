-- 213_users_sessions_dpop_jkt_notnull.sql
-- TD-SEC-DPOP-BINDING Phase 6 — cutover.
--
-- Closes the six-phase initiative: every session from this moment on
-- MUST be DPoP-bound. Phases 1-5 made cnf.jkt optional so existing
-- sessions kept working through the rollout; this migration deletes
-- every users_sessions row (forces one re-login for everyone) and
-- flips users_sessions_dpop_jkt to NOT NULL so the row shape itself
-- prevents a regression where an unbound session could ever exist
-- again.
--
-- Why force re-login is the right cutover for Vector:
--   - Pre-launch, no real users. Confirmed sole-stakeholder context
--     2026-05-18 (Rick).
--   - Defence + finance procurement narrative is cleaner with "DPoP
--     required from day 1" than with a dual-mode grace window.
--   - Saves ~150 lines of "is the token bound or not?" branching
--     code in middleware and Service.Refresh.
--   - The standards-evidence story: NIST 800-63B AAL2/AAL3 (phishing-
--     resistant authenticators), RFC 9449 (DPoP), FFIEC 2021 §III.B
--     (layered defence) — all answered the same way.
--
-- Pair with the middleware change in the same commit
-- (auth/middleware.go) that removes the "claims.Confirmation == nil"
-- escape hatch — tokens without cnf.jkt now 401 unconditionally.

BEGIN;

-- Force everyone to re-login. Pre-DPoP-Phase-6 sessions had no
-- users_sessions_dpop_jkt stamped; rather than leave them as a
-- migration foot-gun (NOT NULL would fail), wipe the slate clean.
DELETE FROM users_sessions;

-- Now every future row MUST carry a thumbprint. The column was
-- added nullable in migration 211 so Phases 1-5 could ship without
-- breaking existing sessions; with the table empty, the NOT NULL
-- constraint is safe to add.
ALTER TABLE users_sessions
  ALTER COLUMN users_sessions_dpop_jkt SET NOT NULL;

COMMENT ON COLUMN users_sessions.users_sessions_dpop_jkt IS
  'RFC 7638 base64url SHA-256 thumbprint of the DPoP public key that '
  'bound this session at login. NOT NULL — every session is DPoP-bound. '
  'See TD-SEC-DPOP-BINDING in docs/c_tech_debt.md.';

INSERT INTO schema_migrations (filename) VALUES ('213_users_sessions_dpop_jkt_notnull.sql');

COMMIT;
