-- ============================================================
-- MMFFDev - mmff_library: Grants for the release-channel tables (Phase 3)
-- Run against the mmff_library database:
--   docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 007_grants_release_channel.sql
--
-- Extends the Phase-1 grant matrix in 005_grants.sql for the three
-- release-channel tables shipped in 006_release_channel.sql.
--
-- Per plan §9 (with Phase 3 extension):
--   admin   — ALL on every table
--   ro      — SELECT on every table
--   publish — INSERT/UPDATE/SELECT on releases + actions
--             INSERT-only on release_log (no SELECT/UPDATE/DELETE)
--   ack     — SELECT on releases + actions; no access to release_log
--
-- Idempotent: GRANT/REVOKE on existing privileges is a no-op.
-- The CI canary (backend/internal/librarydb/grants_test.go) asserts
-- the live grants match the canonical map exactly.
-- ============================================================

BEGIN;

-- ─── mmff_library_admin: ALL on the new tables ──────────────────────
GRANT ALL PRIVILEGES ON
    library_releases,
    library_release_actions,
    library_release_log
TO mmff_library_admin;

-- ─── mmff_library_ro: SELECT on the new tables ──────────────────────
GRANT SELECT ON
    library_releases,
    library_release_actions,
    library_release_log
TO mmff_library_ro;

-- ─── mmff_library_publish: write releases + actions, append-only log ─
GRANT INSERT, UPDATE, SELECT ON
    library_releases,
    library_release_actions
TO mmff_library_publish;

-- INSERT-only on release_log: no SELECT/UPDATE/DELETE for publish.
-- Reads of release_log go through admin (release artifact paths)
-- or ro (operator queries via the dev DB user).
GRANT INSERT ON library_release_log TO mmff_library_publish;

-- ─── mmff_library_ack: SELECT releases + actions; no log access ─────
-- Phase-1 left ack with zero table grants; Phase 3 enables the
-- list+ack workflow. Acks themselves are stored in mmff_vector
-- (cross-DB; see db/schema/021_library_acknowledgements.sql).
GRANT SELECT ON
    library_releases,
    library_release_actions
TO mmff_library_ack;

COMMIT;
