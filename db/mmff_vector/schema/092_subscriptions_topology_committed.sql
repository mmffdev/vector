-- ============================================================
-- 092 — subscriptions.topology_committed_* (PLA-0006 / 00322)
--
-- A tenant's Topology working model is editable freely until a
-- gadmin "commits" it. Commit stamps the moment + actor on the
-- subscription row. After first commit, any subsequent edit
-- raises a "dirty since commit" banner in the canvas header
-- until the gadmin re-commits.
--
-- MVP scope: a single commit checkpoint per subscription (the
-- two _at / _by columns). Versioned commit history (multiple
-- snapshots) is Phase X — see docs/c_c_topology.md.
--
-- Sole writer: backend/internal/orgdesign/service.go.Commit().
-- ============================================================

BEGIN;

ALTER TABLE subscriptions
    ADD COLUMN topology_committed_at  TIMESTAMPTZ,
    ADD COLUMN topology_committed_by  UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN subscriptions.topology_committed_at IS
    'Last gadmin commit of the Topology working model (PLA-0006 / 00322). NULL = never committed. Compare against MAX(org_nodes.updated_at) to detect "dirty since commit".';

COMMIT;
