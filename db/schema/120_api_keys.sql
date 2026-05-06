-- API keys for programmatic access without user JWT session.
-- Key format: sam_live_<32-char-base62> (production) or sam_test_<32-char-base62> (test).
-- Hash stored; never store raw key.

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,

  -- Key identification
  prefix text NOT NULL UNIQUE,  -- First 8 chars of key (e.g. "sam_live")
  hash bytea NOT NULL UNIQUE,   -- Blake3 hash of full key; never store raw key

  -- Permissions and rate limiting
  scopes text[] NOT NULL DEFAULT '{}',       -- Space-separated scopes (e.g. ["read:portfolio", "write:work-items"])
  rate_limit_config jsonb,                   -- Custom rate limit config per key

  -- Lifecycle
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,                    -- Optional expiration; NULL = never expires
  revoked_at timestamptz,                    -- Set when revoked; soft-delete marker
  last_used_at timestamptz,                  -- Track usage for audit

  created_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_api_keys_subscription_id ON api_keys(subscription_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX idx_api_keys_revoked_at ON api_keys(revoked_at);
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at);
