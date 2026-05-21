-- 091_timebox_scope_propagation.sql
--
-- Slice 5 of the ObjectTree refactor (docs/c_c_objecttree_refactor_plan.md).
-- "Global cadence" / heartbeat feature substrate.
--
-- Adds a scope_propagation column to timeboxes_sprints and timeboxes_releases.
-- The column declares whether a timebox is local to its pinned topology
-- node (the default, current behaviour) or propagates to every descendant.
--
-- Semantics — IMPORTANT:
--
--   'this_node_only'           Sprint/release is visible only on the
--                              topology node it was pinned to. This is the
--                              current behaviour for every existing row;
--                              the backfill below sets every existing row
--                              to this value.
--
--   'this_node_and_descendants' Sprint/release is visible on its pinned
--                              node AND every live descendant of that
--                              node — discovered at READ time via the
--                              same ancestor-walk pattern the topology
--                              grants use (sqlAncestorsHasGrantOnTarget…
--                              in backend/internal/topology/sql.go).
--                              NO fan-out: ONE row stays at the pin point,
--                              children see it via the walk. Atomic
--                              edits — change once, every inheritor
--                              sees the change immediately.
--
-- Behaviour for existing rows: backfill to 'this_node_only', no UI
-- change. The propagation column is opt-in on Create / Update via a
-- new request field (Slice 5 frontend wiring) + a UI toggle landing
-- in Slice 7. Slice 6 page swap is unaffected — the column exists,
-- defaults safely, no flow breaks.
--
-- Rollback (091_timebox_scope_propagation_DOWN.sql): drops the column
-- on both tables. Idempotent — IF EXISTS guard.

BEGIN;

-- timeboxes_sprints
ALTER TABLE timeboxes_sprints
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_scope_propagation TEXT
        NOT NULL DEFAULT 'this_node_only'
        CHECK (timeboxes_sprints_scope_propagation IN ('this_node_only', 'this_node_and_descendants'));

-- timeboxes_releases
ALTER TABLE timeboxes_releases
    ADD COLUMN IF NOT EXISTS timeboxes_releases_scope_propagation TEXT
        NOT NULL DEFAULT 'this_node_only'
        CHECK (timeboxes_releases_scope_propagation IN ('this_node_only', 'this_node_and_descendants'));

-- Index on the propagation column scoped by topology_node — the
-- ancestor-walk read will need to find rows with propagation =
-- 'this_node_and_descendants' on each ancestor of a queried node.
-- Partial index on the propagation = descendants subset keeps the
-- index small (vast majority of rows are 'this_node_only').
CREATE INDEX IF NOT EXISTS idx_timeboxes_sprints_propagating
    ON timeboxes_sprints (timeboxes_sprints_id_topology_node)
    WHERE timeboxes_sprints_scope_propagation = 'this_node_and_descendants'
      AND timeboxes_sprints_archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_timeboxes_releases_propagating
    ON timeboxes_releases (timeboxes_releases_id_topology_node)
    WHERE timeboxes_releases_scope_propagation = 'this_node_and_descendants'
      AND timeboxes_releases_archived_at IS NULL;

COMMIT;
