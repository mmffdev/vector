-- ============================================================
-- MMFFDev - mmff_library: Bootstrap database (Phase 1)
-- Run against the `postgres` database (NOT mmff_library):
--   psql -U mmff_dev -d postgres -f 001_init_library.sql
--
-- Creates the mmff_library database. Idempotent via SELECT + \gexec —
-- CREATE DATABASE cannot run inside a function or transaction block,
-- so the conditional is built as a meta-command that emits the CREATE
-- statement only when the database is missing.
-- ============================================================

SELECT format(
    'CREATE DATABASE mmff_library ENCODING ''UTF8'' LC_COLLATE ''en_US.UTF-8'' LC_CTYPE ''en_US.UTF-8'' TEMPLATE template0'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mmff_library')
\gexec

COMMENT ON DATABASE mmff_library IS
    'MMFF-authored, shared content library. Read-only to request-path pool. '
    'Updated by release artifacts under mmff_library_admin. '
    'See dev/planning/feature_library_db_and_portfolio_presets_v3.md.';
