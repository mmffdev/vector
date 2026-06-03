-- ============================================================
-- 175_artefact_dependency_edge_events.sql
--
-- Append-only audit log for artefact_dependency_edges mutations.
-- One row per edge create / archive / restore event, capturing the
-- actor, the Sentinel clamp snapshot at write time, and a free-form
-- payload jsonb for kind-specific detail.
--
-- WHY:
--   PLA074 / B23.1.3. Defence/finance buyer narrative (per
--   context/USER.md) requires per-edge mutation provenance: who added
--   which dependency, from which scope clamp, when. The audit is
--   load-bearing for the SOC 2 / defence procurement story and was
--   explicitly kept non-optional in the merged design.
--
--   The id_edge column carries NO foreign key. Events MUST outlive
--   their edge — if an edge is later hard-deleted as part of a future
--   cleanup, the audit log still names what was destroyed, who
--   destroyed it, and when. The dependencies service is the sole
--   writer for both tables and is responsible for application-level
--   referential integrity (always written in the same tx as the edge
--   mutation it audits).
--
-- IDEMPOTENCY:
--   CREATE TABLE / INDEX IF NOT EXISTS. Append-only by design.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/175_artefact_dependency_edge_events_DOWN.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS artefact_dependency_edge_events (
    artefact_dependency_edge_events_id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The edge this event refers to. NO FK — events outlive edges.
    -- The dependencies service is the sole writer for both tables and
    -- enforces same-tx integrity.
    artefact_dependency_edge_events_id_edge                  UUID NOT NULL,

    -- Event taxonomy. Stored as TEXT + CHECK so new event kinds can be
    -- added without an ALTER TYPE ceremony. Current vocabulary covers
    -- the v1 surface (create, archive, restore); more kinds will be
    -- added as the dependencies service grows.
    artefact_dependency_edge_events_event_kind               TEXT NOT NULL
        CHECK (artefact_dependency_edge_events_event_kind IN ('created', 'archived', 'restored')),

    -- The user that triggered the mutation. NULL when system-driven
    -- (e.g. archive cascade from a topology-node delete). NO FK to
    -- users so a deleted user does not orphan the audit trail.
    artefact_dependency_edge_events_id_actor_user            UUID,

    -- Sentinel clamp at write time. Frozen jsonb snapshot of the
    -- caller's resolved (subscription, workspace, focus_node_id,
    -- allowed_subtree_ids) at the moment of the write. Lets later
    -- forensic queries answer "from which scope did this edge land".
    artefact_dependency_edge_events_sentinel_scope_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Free-form payload for kind-specific detail (e.g. on 'created':
    -- the from/to/map_id; on 'archived': the reason).
    artefact_dependency_edge_events_payload                  JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- The mutation timestamp. now() at INSERT.
    artefact_dependency_edge_events_occurred_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-edge history scan, newest first. The primary read path for
-- "show me the audit trail of edge X".
CREATE INDEX IF NOT EXISTS idx_artefact_dependency_edge_events_edge_time
    ON artefact_dependency_edge_events (
        artefact_dependency_edge_events_id_edge,
        artefact_dependency_edge_events_occurred_at DESC
    );

-- Per-actor history scan. Used for forensic queries ("show me every
-- dependency edge user X has touched in the last 7 days").
CREATE INDEX IF NOT EXISTS idx_artefact_dependency_edge_events_actor_time
    ON artefact_dependency_edge_events (
        artefact_dependency_edge_events_id_actor_user,
        artefact_dependency_edge_events_occurred_at DESC
    )
    WHERE artefact_dependency_edge_events_id_actor_user IS NOT NULL;

COMMIT;
