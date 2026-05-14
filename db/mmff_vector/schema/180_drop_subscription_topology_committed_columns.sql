-- ============================================================
-- 180 — drop subscriptions.topology_committed_at / topology_committed_by
--
-- PLA-0023 P6 — final mmff_vector touchpoint inside backend/internal/orgdesign.
-- Migration 053 in vector_artefacts created topology_commits as the new home
-- for the working-model commit checkpoint; the Go service is updated in the
-- same commit to read/write that table via vaPool instead of these two
-- columns via the legacy pool.
--
-- Backfill: zero rows on dev (verified 2026-05-13: 0 of 33 subscriptions
-- carry a non-NULL topology_committed_at). Staging/prod migration MUST copy
-- any non-NULL rows into vector_artefacts.topology_commits BEFORE applying
-- this migration. On dev there is nothing to migrate.
--
-- After this migration the orgdesign package no longer reads or writes
-- mmff_vector — every topology operation goes through vaPool only.
-- The pool struct field is retained for membership/auth checks
-- (PoolWorkspaceLookup adapter) which are unrelated to topology I/O.
-- ============================================================

BEGIN;

ALTER TABLE subscriptions
    DROP COLUMN IF EXISTS topology_committed_at,
    DROP COLUMN IF EXISTS topology_committed_by;

COMMIT;
