-- ============================================================
-- 187_users_sessions_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (3 of N).
--
-- Applies the §2.3 column-prefix convention to users_sessions:
-- every column gains the table-name prefix, FK to users.id carries
-- the §2.4 FK shape <table>_id_<target>.
--
-- Indexes + constraint + FK constraint are renamed to match the
-- new column names. After this migration:
--   • `users` package: 1 → 0 findings → OFF the ledger.
--   • `auth` package: 9 → 1 findings (only users_password_resets
--     work was already done; users_sessions clears the rest).
-- ============================================================

BEGIN;

-- ---- Column renames (11 columns) ----

ALTER TABLE users_sessions RENAME COLUMN id             TO users_sessions_id;
ALTER TABLE users_sessions RENAME COLUMN user_id        TO users_sessions_id_user;
ALTER TABLE users_sessions RENAME COLUMN token_hash     TO users_sessions_token_hash;
ALTER TABLE users_sessions RENAME COLUMN created_at     TO users_sessions_created_at;
ALTER TABLE users_sessions RENAME COLUMN expires_at     TO users_sessions_expires_at;
ALTER TABLE users_sessions RENAME COLUMN last_used_at   TO users_sessions_last_used_at;
ALTER TABLE users_sessions RENAME COLUMN ip_address     TO users_sessions_ip_address;
ALTER TABLE users_sessions RENAME COLUMN user_agent     TO users_sessions_user_agent;
ALTER TABLE users_sessions RENAME COLUMN revoked        TO users_sessions_revoked;
ALTER TABLE users_sessions RENAME COLUMN rotated_at     TO users_sessions_rotated_at;
ALTER TABLE users_sessions RENAME COLUMN successor_hash TO users_sessions_successor_hash;

-- ---- Index + constraint renames ----

ALTER INDEX sessions_pkey                RENAME TO users_sessions_pkey;
ALTER INDEX sessions_token_hash_key      RENAME TO users_sessions_token_hash_key;
ALTER INDEX idx_sessions_expires_at      RENAME TO idx_users_sessions_expires_at;
ALTER INDEX idx_sessions_successor_hash  RENAME TO idx_users_sessions_successor_hash;
ALTER INDEX idx_sessions_token_hash      RENAME TO idx_users_sessions_token_hash;
ALTER INDEX idx_sessions_user_id         RENAME TO idx_users_sessions_id_user;

ALTER TABLE users_sessions
    RENAME CONSTRAINT sessions_user_id_fkey TO users_sessions_id_user_fkey;

COMMIT;
