-- ============================================================
-- MMFFDev - vector_artefacts: topology_view_state
-- Migration 033 — Per-user canvas viewport state (PLA-0006 / M6.2.6)
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 033_topology_view_state.sql
--
-- Stores per-user canvas viewport (pan + zoom) for the Topology
-- canvas. This is presentation state only — a reset on cutover is
-- acceptable (see M6.3.4 in Vector_Scope.md and the ETL decision doc).
--
-- Difference from org_node_view_state (mmff_vector):
--   org_node_view_state stored per-node collapsed/expanded state.
--   topology_view_state stores the canvas-level viewport (x, y, zoom)
--   — i.e. where the user has panned/zoomed the canvas to, not which
--   individual nodes they have expanded.
--
--   The per-node collapse state (collapsed_default on topology_nodes
--   already covers the gadmin-authored default; per-user overrides are
--   deferred to Phase X when the canvas sees heavy multi-user usage).
--
-- Reset decision: org_node_view_state rows will NOT be ETL'd.
--   Rationale: viewport coordinates are in pixel-space relative to
--   canvas dimensions that will change at cutover. Copying stale
--   (x, y, zoom) values would put users at a random canvas position
--   with no relation to the new layout. A fresh canvas on first load
--   (viewport_x=0, viewport_y=0, viewport_zoom=1.0) is the correct
--   "reset" UX. See dev/scripts/etl_topology_view_state.sql for the
--   formal decision document.
--
-- One row per (workspace, user). ON CONFLICT upserts on every
-- canvas pan/zoom commit (debounced 250ms in the frontend).
--
-- Sole writer once migrated: backend/internal/orgdesign (post-M6.2.7).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS topology_view_state (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenancy (soft cross-DB references — no FK constraints)
    workspace_id        UUID            NOT NULL,
    subscription_id     UUID            NOT NULL,

    -- User (soft reference to mmff_vector.users — cross-DB, no FK)
    user_id             UUID            NOT NULL,

    -- Canvas viewport — where the user has the canvas panned and zoomed.
    -- viewport_x/y: canvas translate in logical pixels (can be negative).
    -- viewport_zoom: d3-zoom scale factor (1.0 = 100%, 0.5 = zoomed out).
    viewport_x          DOUBLE PRECISION NOT NULL DEFAULT 0,
    viewport_y          DOUBLE PRECISION NOT NULL DEFAULT 0,
    viewport_zoom       DOUBLE PRECISION NOT NULL DEFAULT 1.0
                            CHECK (viewport_zoom > 0),

    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- One row per (workspace, user). Upserted on every viewport commit.
    CONSTRAINT topology_view_state_workspace_user_unique
        UNIQUE (workspace_id, user_id)
);

-- ── Indexes ────────────────────────────────────────────────────────────────

-- Hot path: load viewport when user mounts /topology, scoped by workspace.
CREATE INDEX IF NOT EXISTS idx_topology_view_state_workspace_user
    ON topology_view_state (workspace_id, user_id);

-- ── Updated-at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION topology_view_state_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_topology_view_state_updated_at
    BEFORE UPDATE ON topology_view_state
    FOR EACH ROW EXECUTE FUNCTION topology_view_state_set_updated_at();

-- ── Table comment ───────────────────────────────────────────────────────────

COMMENT ON TABLE topology_view_state IS
    'Per-user canvas viewport (pan + zoom) for the Topology canvas (PLA-0006 / M6.2.6). '
    'One row per (workspace, user); upserted on every debounced viewport commit. '
    'NOT migrated from org_node_view_state — a reset on cutover is the correct UX '
    'because pixel-space coordinates are not transferable across canvas revisions. '
    'See dev/scripts/etl_topology_view_state.sql for the reset decision rationale. '
    'Soft cross-DB references (workspace_id, user_id) — no FK constraints.';

COMMIT;
