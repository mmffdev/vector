-- ============================================================
-- 173_artefact_dependency_maps.sql
--
-- New container table for user-authored artefact dependency maps.
-- Multiple maps may overlap and share artefacts; each map is owned by
-- one topology node and serves a specific (subscription, workspace).
-- Edge rows live in artefact_dependency_edges (mig 174).
--
-- WHY:
--   PLA074 / B23.1.1 — replace the prototype React-only composer at
--   app/components/DependencyMap/DependencyMapOverlay.tsx with durable,
--   edge-first persistence. RES058 argues for edge rows as the source
--   of truth with critical-path computation as a projection; the maps
--   table is the named container that lets the same artefact pair
--   participate in multiple overlapping dependency views (e.g. "Q3
--   release plan" and "Auth rewrite" can both contain Story 5).
--
-- IDEMPOTENCY:
--   CREATE TABLE / INDEX IF NOT EXISTS throughout. Re-running is a
--   no-op. The PK is a generated UUID, so seed retries do not collide.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/173_artefact_dependency_maps_DOWN.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS artefact_dependency_maps (
    artefact_dependency_maps_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant scope. Workspace carries a FK for referential integrity
    -- (B23.1.1 AC); subscription is denormalised without a FK to match
    -- the pattern used by other vector_artefacts tables and to keep
    -- the sentinel clamp predicate a single-column lookup.
    artefact_dependency_maps_id_subscription      UUID NOT NULL,
    artefact_dependency_maps_id_workspace         UUID NOT NULL
        REFERENCES master_record_workspaces (master_record_workspaces_id) ON DELETE CASCADE,

    -- The topology node that owns this map. CASCADE so dropping a node
    -- drops its dependency containers; in practice nodes are archived
    -- (soft-delete) so this is a defensive cleanup, not the hot path.
    artefact_dependency_maps_id_topology_node     UUID NOT NULL
        REFERENCES topology_nodes (topology_nodes_id) ON DELETE CASCADE,

    -- Optional anchor artefact. The frame-of-reference target the map
    -- was created around (see RES058 §3 "Frame of reference"). Nullable
    -- because maps can be free-floating across many artefacts. SET NULL
    -- if the anchor is deleted — the map remains usable, just
    -- unanchored.
    artefact_dependency_maps_id_root_artefact     UUID
        REFERENCES artefacts (artefacts_id) ON DELETE SET NULL,

    -- User-visible map name. 1..200 chars, leading/trailing whitespace
    -- the service's responsibility to trim before write.
    artefact_dependency_maps_name                 TEXT NOT NULL
        CHECK (char_length(artefact_dependency_maps_name) BETWEEN 1 AND 200),

    artefact_dependency_maps_created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    artefact_dependency_maps_updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    artefact_dependency_maps_archived_at          TIMESTAMPTZ,
    artefact_dependency_maps_created_by           UUID
);

-- Primary read path: list maps for a workspace + topology node, live
-- entries only. The dependency composer enters via this index.
CREATE INDEX IF NOT EXISTS idx_artefact_dependency_maps_workspace_node
    ON artefact_dependency_maps (
        artefact_dependency_maps_id_workspace,
        artefact_dependency_maps_id_topology_node
    )
    WHERE artefact_dependency_maps_archived_at IS NULL;

-- Subscription-scope counter / audit query.
CREATE INDEX IF NOT EXISTS idx_artefact_dependency_maps_subscription
    ON artefact_dependency_maps (artefact_dependency_maps_id_subscription)
    WHERE artefact_dependency_maps_archived_at IS NULL;

-- Reverse lookup: "which maps anchor on this artefact" — used by the
-- archive-impact preflight to enumerate affected maps when a root
-- artefact is archived.
CREATE INDEX IF NOT EXISTS idx_artefact_dependency_maps_root_artefact
    ON artefact_dependency_maps (artefact_dependency_maps_id_root_artefact)
    WHERE artefact_dependency_maps_id_root_artefact IS NOT NULL
      AND artefact_dependency_maps_archived_at IS NULL;

COMMIT;
