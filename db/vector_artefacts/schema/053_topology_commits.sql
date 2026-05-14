-- ============================================================
-- MMFFDev - vector_artefacts: topology_commits
-- Migration 053 — Topology working-model commit checkpoint
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 053_topology_commits.sql
--
-- Finishes the PLA-0006 topology cutover. The last cross-DB read in
-- backend/internal/orgdesign was GetCommitStatus()/Commit() against
-- subscriptions.topology_committed_at/_by in mmff_vector. Moving those
-- two columns into a dedicated VA table eliminates the cross-DB hop;
-- orgdesign becomes pool-only (vaPool).
--
-- Cardinality: exactly one row per subscription (the most recent commit
-- checkpoint). The PLA-0006 MVP scope is a single checkpoint; versioned
-- commit history is Phase X per docs/c_c_topology.md.
--
-- Backfill: zero rows on dev (verified 2026-05-13: 0 of 33 subscriptions
-- carry a committed checkpoint). Staging/prod migration will need to
-- copy any non-NULL rows out-of-band before mmff_vector mig 180 drops
-- the legacy columns; on dev there is nothing to migrate.
--
-- Sole writer: backend/internal/orgdesign/commands.go.Commit().
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS topology_commits (
    -- Tenancy (soft cross-DB reference — no FK constraint).
    -- subscription_id is the PK because exactly one checkpoint per tenant.
    subscription_id     UUID            PRIMARY KEY,

    -- When and by whom the gadmin last committed the topology working model.
    -- committed_by is a soft reference to mmff_vector.users (no FK).
    committed_at        TIMESTAMPTZ     NOT NULL,
    committed_by        UUID            NOT NULL,

    -- Row bookkeeping.
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE topology_commits IS
    'Per-subscription topology working-model commit checkpoint (PLA-0006). '
    'Single-row-per-subscription. Compare committed_at against MAX(topology_nodes.updated_at) '
    'to detect "dirty since commit". Replaces subscriptions.topology_committed_at/_by '
    '(mmff_vector schema 092) as part of PLA-0023 P6 cutover.';

COMMENT ON COLUMN topology_commits.subscription_id IS
    'Subscription this checkpoint belongs to. Soft cross-DB reference to '
    'mmff_vector.subscriptions(id) — no FK constraint (Postgres cannot enforce cross-DB FKs).';

COMMENT ON COLUMN topology_commits.committed_at IS
    'Timestamp of the gadmin Commit action. NULL = never committed (row absent rather than NULL).';

COMMENT ON COLUMN topology_commits.committed_by IS
    'User who executed the Commit. Soft reference to mmff_vector.users(id) — no FK.';

COMMIT;
