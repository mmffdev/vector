-- ============================================================
-- MMFFDev - mmff_library: Roles (Phase 1)
-- Run against the `postgres` database (NOT mmff_library):
--   docker exec -i mmff-ops-postgres psql -U mmff_dev -d postgres < 002_roles.sql
--
-- Idempotent. Creates four roles per plan §9. Passwords are set
-- to placeholders; rotate via ALTER ROLE in the deployment env.
-- For local dev the placeholders are fine — the DB is bound to
-- localhost:5434 inside the dev Docker network.
--
-- IMPORTANT: this file does NOT grant any per-table privileges.
-- Grants live in 005_grants.sql (and Phase 3's release-tables
-- migration extends them). Roles created here have CONNECT on
-- the library DB and that's it.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmff_library_admin') THEN
        CREATE ROLE mmff_library_admin LOGIN PASSWORD 'change_me_admin'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmff_library_ro') THEN
        CREATE ROLE mmff_library_ro LOGIN PASSWORD 'change_me_ro'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmff_library_publish') THEN
        CREATE ROLE mmff_library_publish LOGIN PASSWORD 'change_me_publish'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmff_library_ack') THEN
        CREATE ROLE mmff_library_ack LOGIN PASSWORD 'change_me_ack'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

-- CONNECT only — table grants are explicit in 005_grants.sql.
GRANT CONNECT ON DATABASE mmff_library TO
    mmff_library_admin, mmff_library_ro, mmff_library_publish, mmff_library_ack;

COMMENT ON ROLE mmff_library_admin   IS 'mmff_library: ALL on every table (release artifacts via psql -f only).';
COMMENT ON ROLE mmff_library_ro      IS 'mmff_library: SELECT on every table (request-path read pool).';
COMMENT ON ROLE mmff_library_publish IS 'mmff_library: INSERT/UPDATE on bundle + shares; no DELETE; no releases/acks.';
COMMENT ON ROLE mmff_library_ack     IS 'mmff_library: INSERT acks + SELECT releases (Phase 3).';
