-- ============================================================
-- 174_artefact_dependency_edges.sql
--
-- The source-of-truth edge table for artefact dependency maps.
-- Each row links two artefacts within one map. Directed
-- `finish_to_start` edges encode both Requires First (related→target)
-- and Unlocks Next (target→related) from a single stored row.
-- Non-directional `parallel` edges represent associative relationships
-- that do NOT participate in DAG cycle detection or critical-path
-- computation.
--
-- WHY:
--   PLA074 / B23.1.2 — RES058 §4 ("Edge kinds") nails the shape:
--   reverse lookup falls out naturally if Story 5 requires Story 3 →
--   one stored edge `3 → 5`. Viewing Story 5 surfaces it as
--   "Requires First: Story 3"; viewing Story 3 surfaces it as
--   "Unlocks Next: Story 5". Canonical pair_low/pair_high (GENERATED
--   STORED from from/to) gives one expression to enforce both
--   "no duplicate per kind" and "no cross-kind duplicate" via partial
--   unique indexes.
--
-- IDEMPOTENCY:
--   CREATE TABLE / INDEX IF NOT EXISTS. Generated columns + CHECKs are
--   defined inline with the table, so re-running is a no-op.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/174_artefact_dependency_edges_DOWN.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS artefact_dependency_edges (
    artefact_dependency_edges_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The owning map. RESTRICT (not CASCADE): deleting a map with
    -- live edges is blocked — the service archives both the map and
    -- its edges together in one tx instead.
    artefact_dependency_edges_id_map              UUID NOT NULL
        REFERENCES artefact_dependency_maps (artefact_dependency_maps_id) ON DELETE RESTRICT,

    -- Edge endpoints. RESTRICT: archiving a load-bearing artefact is
    -- intercepted at the service layer via the dependency-impact
    -- preflight (B23.1.8) so the user is warned before the FK fires.
    artefact_dependency_edges_id_from_artefact    UUID NOT NULL
        REFERENCES artefacts (artefacts_id) ON DELETE RESTRICT,
    artefact_dependency_edges_id_to_artefact      UUID NOT NULL
        REFERENCES artefacts (artefacts_id) ON DELETE RESTRICT,

    -- Edge kind. Stored as TEXT + CHECK (not Postgres ENUM) so new
    -- kinds — start_to_start, finish_to_finish, lag, etc. — can be
    -- added later without an ALTER TYPE ceremony.
    artefact_dependency_edges_kind                TEXT NOT NULL
        CHECK (artefact_dependency_edges_kind IN ('finish_to_start', 'parallel')),

    -- Canonical ordered pair, derived. For uniqueness indexes that
    -- must treat (A,B) and (B,A) as the same pair (the parallel +
    -- cross-kind cases) we index on (pair_low, pair_high). For the
    -- directed-only index we use (from, to) directly.
    artefact_dependency_edges_pair_low            UUID GENERATED ALWAYS AS (
        LEAST(artefact_dependency_edges_id_from_artefact,
              artefact_dependency_edges_id_to_artefact)
    ) STORED,
    artefact_dependency_edges_pair_high           UUID GENERATED ALWAYS AS (
        GREATEST(artefact_dependency_edges_id_from_artefact,
                 artefact_dependency_edges_id_to_artefact)
    ) STORED,

    artefact_dependency_edges_created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    artefact_dependency_edges_updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    artefact_dependency_edges_archived_at         TIMESTAMPTZ,
    artefact_dependency_edges_created_by          UUID,

    -- Self-loop rejection. An artefact cannot depend on itself.
    CONSTRAINT artefact_dependency_edges_no_self_loop
        CHECK (artefact_dependency_edges_id_from_artefact
             <> artefact_dependency_edges_id_to_artefact),

    -- Canonical pair invariant. Defensive against any future change to
    -- the GENERATED expressions; given the self-loop CHECK above this
    -- is strictly < (never =).
    CONSTRAINT artefact_dependency_edges_pair_ordered
        CHECK (artefact_dependency_edges_pair_low
             < artefact_dependency_edges_pair_high)
);

-- Uniqueness rule 1 — directed pair per map.
-- For finish_to_start: (map, from, to) is unique among live edges.
-- This is the "no double-insert of the same directed dependency".
CREATE UNIQUE INDEX IF NOT EXISTS uq_artefact_dependency_edges_directed
    ON artefact_dependency_edges (
        artefact_dependency_edges_id_map,
        artefact_dependency_edges_id_from_artefact,
        artefact_dependency_edges_id_to_artefact
    )
    WHERE artefact_dependency_edges_archived_at IS NULL
      AND artefact_dependency_edges_kind = 'finish_to_start';

-- Uniqueness rule 2 — parallel pair per map.
-- For kind=parallel: (map, pair_low, pair_high) is unique among live
-- edges, so (A,B parallel) and (B,A parallel) collapse into one row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_artefact_dependency_edges_parallel
    ON artefact_dependency_edges (
        artefact_dependency_edges_id_map,
        artefact_dependency_edges_pair_low,
        artefact_dependency_edges_pair_high
    )
    WHERE artefact_dependency_edges_archived_at IS NULL
      AND artefact_dependency_edges_kind = 'parallel';

-- Uniqueness rule 3 — cross-kind canonical pair per map.
-- A pair holds ONE relationship per map regardless of kind:
-- (A f2s B) and (A parallel B) cannot coexist live in the same map.
CREATE UNIQUE INDEX IF NOT EXISTS uq_artefact_dependency_edges_cross_kind
    ON artefact_dependency_edges (
        artefact_dependency_edges_id_map,
        artefact_dependency_edges_pair_low,
        artefact_dependency_edges_pair_high
    )
    WHERE artefact_dependency_edges_archived_at IS NULL;

-- Read path 1: three-bucket projection for the focused artefact.
-- "Requires First" and "Unlocks Next" both filter by (map, kind=f2s)
-- with from_id or to_id pinned; an index on (map, kind, to_id) and
-- (map, kind, from_id) covers both directions.
CREATE INDEX IF NOT EXISTS idx_artefact_dependency_edges_map_kind_to
    ON artefact_dependency_edges (
        artefact_dependency_edges_id_map,
        artefact_dependency_edges_kind,
        artefact_dependency_edges_id_to_artefact
    )
    WHERE artefact_dependency_edges_archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_artefact_dependency_edges_map_kind_from
    ON artefact_dependency_edges (
        artefact_dependency_edges_id_map,
        artefact_dependency_edges_kind,
        artefact_dependency_edges_id_from_artefact
    )
    WHERE artefact_dependency_edges_archived_at IS NULL;

-- Read path 2: archive-impact preflight + transitive-reachability.
-- "Which edges across all maps involve this artefact?" needs from_id
-- and to_id indexes that are NOT scoped to a single map.
CREATE INDEX IF NOT EXISTS idx_artefact_dependency_edges_from
    ON artefact_dependency_edges (artefact_dependency_edges_id_from_artefact)
    WHERE artefact_dependency_edges_archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_artefact_dependency_edges_to
    ON artefact_dependency_edges (artefact_dependency_edges_id_to_artefact)
    WHERE artefact_dependency_edges_archived_at IS NULL;

COMMIT;
