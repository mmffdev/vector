-- ============================================================
-- ETL decision: org_node_view_state (mmff_vector) → topology_view_state (vector_artefacts)
-- PLA-0006 / M6.3.4
--
-- DECISION: NO DATA MIGRATION — RESET ON CUTOVER.
--
-- Rationale:
--
--   org_node_view_state (mmff_vector) stores per-node collapsed/expanded
--   state for individual topology tree nodes. It captures whether user U
--   had node N collapsed or expanded on the canvas.
--
--   topology_view_state (vector_artefacts, migration 029) stores the
--   canvas-level viewport: the pan position (x, y) and zoom level.
--   This is a different data shape — there is no column-for-column
--   mapping possible.
--
--   Even if we were carrying over collapsed/expanded state (a per-node
--   row shape), it would not be worth migrating for these reasons:
--
--   1. Pixel-space mismatch: canvas coordinates (x, y, zoom) are
--      relative to canvas rendering dimensions. The new canvas renderer
--      (DiagramCanvas / d3-zoom) has different default dimensions than
--      the legacy canvas, so any copied (x, y) values would place the
--      user at a random position unrelated to their nodes.
--
--   2. Stale state: collapsed/expanded state that was meaningful in
--      the old canvas is not meaningful in the new canvas layout.
--      The new topology_nodes.collapsed_default field captures the
--      gadmin-authored default, which is the right starting state for
--      all users on first load.
--
--   3. Low value: viewport state is cheap to re-derive. A user panning
--      the canvas re-creates their personal state within seconds.
--      The cost of a wrong starting position exceeds the cost of
--      starting fresh.
--
--   4. Per-node collapse overrides: deferred to Phase X per the
--      topology MVP decisions in docs/c_c_topology.md. No table for
--      that data shape exists in vector_artefacts yet.
--
-- Action:
--   topology_view_state starts EMPTY at cutover.
--   The canvas renders with default viewport (x=0, y=0, zoom=1.0)
--   for all users on first load after cutover. This is handled by the
--   frontend returning a default when no row exists — no server-side
--   seeding needed.
--
-- If per-node collapse state migration becomes a requirement in Phase X,
-- a new ETL (etl_topology_node_collapse_state.sql) should be written at
-- that time against the Phase X table, not against topology_view_state.
-- ============================================================

-- This file is intentionally a decision document, not an executable ETL.
-- No SQL to run. The table was created empty by migration 029 and stays
-- empty until users create rows via the canvas UI post-cutover.
--
-- To confirm the table is empty after cutover:
--   SELECT COUNT(*) FROM topology_view_state;   -- expect 0

SELECT
    'topology_view_state reset decision'    AS etl_status,
    'no migration — see etl_topology_view_state.sql for rationale'
                                            AS note,
    COUNT(*)                                AS current_row_count
FROM topology_view_state;
