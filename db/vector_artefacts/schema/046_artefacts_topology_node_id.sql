-- ============================================================
-- PLA-0043 / FE-POR-0003.1 — Topology scope clamp on artefact reads
--
-- Adds a nullable topology_node_id FK to vector_artefacts.artefacts so
-- artefact list reads can be clamped to "this node + every descendant".
--
-- NULL = un-assigned: visible in unscoped reads, excluded from scoped
-- reads. The FK uses ON DELETE SET NULL so a deleted node clears the
-- pointer rather than cascading the artefact away.
--
-- A partial index covers the common case (scoped read of live work)
-- without bloating the index for un-assigned or archived rows.
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 046_artefacts_topology_node_id.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN topology_node_id UUID NULL
        REFERENCES topology_nodes(id) ON DELETE SET NULL;

COMMENT ON COLUMN artefacts.topology_node_id IS
    'Optional ownership in the topology tree. NULL = un-assigned '
    '(visible unscoped, hidden when ?scope=<id> is set). FK uses '
    'ON DELETE SET NULL so node deletion does not cascade artefacts.';

CREATE INDEX artefacts_topology_node_id_live_idx
    ON artefacts (topology_node_id)
    WHERE topology_node_id IS NOT NULL
      AND archived_at IS NULL;

COMMIT;
