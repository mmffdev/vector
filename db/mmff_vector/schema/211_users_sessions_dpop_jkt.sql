-- 211_users_sessions_dpop_jkt.sql
-- TD-SEC-DPOP-BINDING Phase 1 — add the DPoP key-thumbprint column on
-- users_sessions, nullable for now. Phase 6 (cutover migration) flips
-- it to NOT NULL and DELETE FROMs the table to force re-login; until
-- then any existing or new session can be unbound.
--
-- Stamped at session insert time with base64url(SHA-256(<canonical
-- public JWK>)) per RFC 7638. The stored value is the same string that
-- appears as `cnf.jkt` on every access token minted from this session,
-- and that every DPoP proof's `jwk` thumbprint must match on refresh.
--
-- Nullable in Phase 1 so the column can ship before middleware
-- enforcement and frontend keypair generation are wired — see the
-- six-phase plan in /Users/rick/.claude/plans/recursive-weaving-pascal.md.

BEGIN;

ALTER TABLE users_sessions
  ADD COLUMN users_sessions_dpop_jkt text;

COMMENT ON COLUMN users_sessions.users_sessions_dpop_jkt IS
  'RFC 7638 base64url SHA-256 thumbprint of the DPoP public key that '
  'bound this session at login. NULL during Phase 1 (substrate-add); '
  'becomes NOT NULL in the Phase 6 cutover when DPoP enforcement '
  'goes live. See TD-SEC-DPOP-BINDING in docs/c_tech_debt.md.';

INSERT INTO schema_migrations (filename) VALUES ('211_users_sessions_dpop_jkt.sql');

COMMIT;
