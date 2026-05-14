-- ============================================================
-- 186_users_password_resets_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (1 of N).
--
-- Applies the §2.3 column-prefix convention to users_password_resets.
-- Every column gains the table-name prefix; the FK to users keeps
-- §2.4 PK/FK shape (PK = <table>_id, FK = <table>_id_<target>_<role>;
-- role omitted when there's only one FK to the target).
--
-- Index + constraint names are also normalised to the new column
-- naming so future readers don't trip over "idx_password_resets_*"
-- pointing at users_password_resets.
--
-- Targeted by the warn-only lint:column-prefix-convention scanner
-- (dev/scripts/lint_column_prefix_convention.py). After this migration
-- ships, `users` package's 5 findings drop to 0 and the package is
-- removed from dev/registries/column_prefix_exempt.json.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE users_password_resets RENAME COLUMN id           TO users_password_resets_id;
ALTER TABLE users_password_resets RENAME COLUMN user_id      TO users_password_resets_id_user;
ALTER TABLE users_password_resets RENAME COLUMN token_hash   TO users_password_resets_token_hash;
ALTER TABLE users_password_resets RENAME COLUMN expires_at   TO users_password_resets_expires_at;
ALTER TABLE users_password_resets RENAME COLUMN used_at      TO users_password_resets_used_at;
ALTER TABLE users_password_resets RENAME COLUMN requested_ip TO users_password_resets_requested_ip;
ALTER TABLE users_password_resets RENAME COLUMN created_at   TO users_password_resets_created_at;

-- ---- Index + constraint renames (legacy `password_resets_*` → table-prefixed) ----

ALTER INDEX password_resets_pkey                RENAME TO users_password_resets_pkey;
ALTER INDEX password_resets_token_hash_key      RENAME TO users_password_resets_token_hash_key;
ALTER INDEX idx_password_resets_expires_at      RENAME TO idx_users_password_resets_expires_at;
ALTER INDEX idx_password_resets_user_id         RENAME TO idx_users_password_resets_id_user;

-- FK constraint is auto-named "password_resets_user_id_fkey" — rename to match new column.
ALTER TABLE users_password_resets
    RENAME CONSTRAINT password_resets_user_id_fkey TO users_password_resets_id_user_fkey;

COMMIT;
