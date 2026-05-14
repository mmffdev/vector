-- Migration 145: add rotation metadata to sessions for grace-window reuse detection.
--
-- When a refresh token is rotated, the old row gets:
--   rotated_at     = timestamp of rotation
--   successor_hash = SHA-256 of the new token
--
-- On reuse of a revoked token, the service checks:
--   1. Was it rotated recently (within REFRESH_GRACE_SECONDS, default 30s)?
--   2. Does a valid successor session exist?
-- If both true → return the successor instead of nuking all sessions.
-- This eliminates false-positive revocations from duplicate tabs and HMR.
--
-- Rows without rotation (direct revocations from logout/password-change)
-- have rotated_at = NULL and successor_hash = NULL → reuse still nukes all sessions.

ALTER TABLE sessions
  ADD COLUMN rotated_at     TIMESTAMPTZ,
  ADD COLUMN successor_hash TEXT;

CREATE INDEX idx_sessions_successor_hash ON sessions(successor_hash)
  WHERE successor_hash IS NOT NULL;
