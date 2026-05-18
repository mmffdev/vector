-- 210_users_reauth_nonces.sql
-- Single-use, action-bound reauth proof nonces for B16.8.10 (step-up
-- reauth on sensitive in-session actions). The user re-presents their
-- password (+ TOTP if enrolled) at POST /_site/auth/reauth, which
-- inserts a row here and returns an HMAC-signed action_proof that the
-- user's frontend submits with the sensitive request. The middleware
-- (RequireStepUpReauth) atomically marks _consumed_at=NOW() inside an
-- UPDATE ... WHERE _consumed_at IS NULL — so the proof is genuinely
-- single-use even under a race.
--
-- Schema follows the post-RF1.4.2 column-prefix convention (every
-- column starts with users_reauth_nonces_). FK to users so a user
-- delete cascades.
--
-- See docs/c_security.md "Session model" + the B16.8.10 commit
-- message for the threat model (in-realm extension can capture the
-- password during the modal but cannot pre-stage a proof for a
-- different action, and the proof it does capture is consumed by the
-- user's own legitimate request).

BEGIN;

CREATE TABLE IF NOT EXISTS users_reauth_nonces (
    users_reauth_nonces_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    users_reauth_nonces_id_user     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    users_reauth_nonces_action_key  TEXT NOT NULL,
    users_reauth_nonces_consumed_at TIMESTAMPTZ,
    users_reauth_nonces_expires_at  TIMESTAMPTZ NOT NULL,
    users_reauth_nonces_created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup pattern: WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW()
-- so a partial-index covering the common case keeps the table tiny in practice
-- (rows are short-lived; periodic cleanup sweeps the table to its working set).
CREATE INDEX IF NOT EXISTS idx_users_reauth_nonces_id_user_expires
  ON users_reauth_nonces (users_reauth_nonces_id_user, users_reauth_nonces_expires_at);

COMMENT ON TABLE users_reauth_nonces IS
  'B16.8.10 — single-use, action-bound nonces backing per-action step-up reauth. '
  'Insert on /_site/auth/reauth; atomically consume in RequireStepUpReauth(actionKey). '
  'Rows are short-lived (60s expiry); periodic cleanup sweep keeps working set small.';

COMMENT ON COLUMN users_reauth_nonces.users_reauth_nonces_action_key IS
  'Lower-kebab string naming the sensitive action this nonce was minted for '
  '(e.g. "delete-workspace"). RequireStepUpReauth(actionKey) rejects nonces '
  'whose action_key does not match the route''s declared actionKey.';

INSERT INTO schema_migrations (filename) VALUES ('210_users_reauth_nonces.sql');

COMMIT;
