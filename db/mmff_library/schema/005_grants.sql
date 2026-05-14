-- ============================================================
-- MMFFDev - mmff_library: Per-table grants for the four roles (Phase 1)
-- Run against the mmff_library database:
--   docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 005_grants.sql
--
-- Implements plan §9 grant matrix for the tables that exist in Phase 1
-- (bundle + shares). Phase 3 ships a sibling grants migration that
-- extends the matrix for library_releases / _actions / _acknowledgements.
--
-- The CI canary (backend/internal/librarydb/grants_test.go) asserts
-- the live grants exactly match the canonical map. Drift = test fail.
--
-- Idempotent: GRANT/REVOKE on existing privileges is a no-op.
-- ============================================================

BEGIN;

-- USAGE on schema for everyone who needs to touch tables.
GRANT USAGE ON SCHEMA public TO
    mmff_library_admin, mmff_library_ro, mmff_library_publish, mmff_library_ack;

-- ─── mmff_library_admin: ALL on every table ─────────────────────────
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO mmff_library_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mmff_library_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON TABLES TO mmff_library_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON SEQUENCES TO mmff_library_admin;

-- ─── mmff_library_ro: SELECT on every table ─────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mmff_library_ro;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO mmff_library_ro;

-- ─── mmff_library_publish: INSERT/UPDATE on bundle + shares ─────────
-- No DELETE — soft-archive only. No access to releases/acks (those don't exist yet).
GRANT INSERT, UPDATE, SELECT ON
    portfolio_models,
    portfolio_model_layers,
    portfolio_model_workflows,
    portfolio_model_workflow_transitions,
    portfolio_model_artifacts,
    portfolio_model_terminology,
    portfolio_model_shares
TO mmff_library_publish;

-- Sequences referenced by SERIAL/IDENTITY (none currently — gen_random_uuid() doesn't use a sequence)
-- but keep the grant so adding an IDENTITY column later doesn't silently break the publish path.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mmff_library_publish;

-- ─── mmff_library_ack: nothing in Phase 1 ───────────────────────────
-- The ack role gets its grants in Phase 3 when library_releases and
-- library_acknowledgements ship. Until then it has CONNECT + USAGE
-- and no table privileges, which is correct.

COMMIT;
