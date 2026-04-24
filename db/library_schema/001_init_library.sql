-- ============================================================
-- MMFFDev - mmff_library: Bootstrap database (Phase 1)
-- Run against the `postgres` database (NOT mmff_library):
--   docker exec -i mmff-ops-postgres psql -U mmff_dev -d postgres < 001_init_library.sql
--
-- Creates the mmff_library database. Idempotent via DO block —
-- repeating the apply is safe.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mmff_library') THEN
        CREATE DATABASE mmff_library
            ENCODING 'UTF8'
            LC_COLLATE 'en_US.UTF-8'
            LC_CTYPE   'en_US.UTF-8'
            TEMPLATE   template0;
    END IF;
END
$$;

COMMENT ON DATABASE mmff_library IS
    'MMFF-authored, shared content library. Read-only to request-path pool. '
    'Updated by release artifacts under mmff_library_admin. '
    'See dev/planning/feature_library_db_and_portfolio_presets_v3.md.';
