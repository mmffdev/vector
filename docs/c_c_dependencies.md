# Dependencies — artefact dependency map substrate (PLA074)

System note for the artefact dependency map feature (theme **B23** in [`Vector_Scope.md`](../Vector_Scope.md)). Edge-first persistence replaces the prototype React-only composer at [`app/components/DependencyMap/DependencyMapOverlay.tsx`](../app/components/DependencyMap/DependencyMapOverlay.tsx). Research paper [`dev/research/R058.json`](../dev/research/R058.json); implementation plan PLA074 (filed in `dev_reports`).

## Synopsis

Users compose dependency maps over artefacts in three buckets — **Requires First**, **In Parallel**, **Unlocks Next** — viewed relative to a focused target artefact. Edges are the source of truth in `vector_artefacts`; the canvas reads buckets as a projection. A single stored edge `Story 3 → Story 5` surfaces as *"Requires First: Story 3"* when viewing Story 5 and as *"Unlocks Next: Story 5"* when viewing Story 3 — reverse lookup is structural, not computed. Critical-path (CPM) is intentionally deferred until duration semantics are agreed (`TD-DEP-CPM-DURATION`); transitive reachability ships now as the honest substitute.

## Schema

Three tables under `vector_artefacts`, all column-prefix compliant (HARD RULE — every column is `<table_name>_<column>`):

| Table | Purpose | Migration |
|---|---|---|
| `artefact_dependency_maps` | Named container owned by one topology node. Multiple maps can overlap; the same artefact can appear in many. | [`173`](../db/vector_artefacts/schema/173_artefact_dependency_maps.sql) |
| `artefact_dependency_edges` | One row per relationship. Directed `finish_to_start` encodes Requires/Unlocks from a single perspective. Non-directional `parallel` uses canonical `pair_low`/`pair_high` for uniqueness. | [`174`](../db/vector_artefacts/schema/174_artefact_dependency_edges.sql) |
| `artefact_dependency_edge_events` | Append-only audit. `id_edge` carries **no FK** — events outlive their edge. Frozen Sentinel clamp snapshot per event. | [`175`](../db/vector_artefacts/schema/175_artefact_dependency_edge_events.sql) |

### Uniqueness rules (partial indexes, all `WHERE archived_at IS NULL`)

1. `uq_artefact_dependency_edges_directed` — `(map_id, from_id, to_id)` where `kind='finish_to_start'`. No double-add of the same directed dependency.
2. `uq_artefact_dependency_edges_parallel` — `(map_id, pair_low, pair_high)` where `kind='parallel'`. `(A,B,par)` and `(B,A,par)` collapse to one row.
3. `uq_artefact_dependency_edges_cross_kind` — `(map_id, pair_low, pair_high)` regardless of kind. A pair holds **one** relationship per map: `(A f2s B)` and `(A par B)` cannot coexist live.

`pair_low`/`pair_high` are `GENERATED ALWAYS AS (LEAST/GREATEST(from, to)) STORED` so the canonical pair is computed by the DB, not by the application.

### Cycle guard

CHECK constraints reject self-loops (`from <> to`) and enforce `pair_low < pair_high`. Cycle detection on directed inserts is a recursive CTE (`sqlCycleWouldFormFromTo`) run inside the same tx that locks the parent map row `FOR UPDATE` — concurrent edge writes per map serialise behind the lock so the cycle check sees a stable snapshot.

## Sentinel discipline

`backend/internal/dependencies/` is the **sole writer** for all three tables. No other package writes; no other read path bypasses the workspace clamp. Every method reads the clamp from `sentinel.FromCtx(ctx)`:

- **Topology scope** — every map operation checks the map's `topology_node_id` is in `c.AllowedSubtreeIDs` via `nodeInScope(c, …)`. A nil `AllowedSubtreeIDs` **fails closed** — no "absent means open" surprise.
- **Endpoint visibility** — edge insert validates both `from_artefact` and `to_artefact` are visible: SQL `COUNT(*)` over the artefacts table filtered by `id IN (from, to) AND subscription = c.TenantID AND topology_node = ANY(c.AllowedSubtreeIDs)`. Count < 2 → 403.
- **Workspace clamp on reads** — Map CRUD predicates on `id_workspace = c.WorkspaceID`; the edge JOIN and dependency-impact preflight inherit it transitively. A forged map id from another tenant 404s, never leaks existence.
- **Cross-clamp redaction** — transitive reachability returns the visibility flag from the SQL JOIN; out-of-scope nodes are dropped from the wire arrays and folded into `redacted_count`. The frontend can render "+ N more outside your scope" without ever holding the ids.

`?meg=` is **never** passed at a dependencies call site — the JWT-resolved clamp is the authority per the HARD RULE in [`.claude/CLAUDE.md`](../.claude/CLAUDE.md).

## Audit narrative (defence / finance procurement)

Every edge mutation (create / archive / restore — extensible) writes to `artefact_dependency_edge_events` in the SAME tx as the mutation itself. The audit row captures:

- `id_actor_user` — the user that triggered the change (NULL on system-driven archive cascades).
- `sentinel_scope_snapshot` (jsonb) — the resolved clamp at write time: `subscription_id`, `workspace_id`, `focus_node_id`, `role`. Forensic queries can answer "from which scope did this edge land".
- `payload` (jsonb) — kind-specific facets: `map_id`, `from_artefact_id`, `to_artefact_id`, `kind` for `created`/`archived`.
- `occurred_at` — wall-clock at INSERT.

The audit table has **no FK** on `id_edge` so a future hard-delete cleanup (none planned) cannot orphan the trail. SOC 2 / defence / finance buyer narrative per [`context/USER.md`](../context/USER.md).

## Archive preflight + 409 contract

`GET /_site/work-items/{id}/dependency-impact` returns

```json
{
  "impacted_maps": [
    { "map_id": "...", "map_name": "Q3 release", "edges": 4 },
    { "map_id": "...", "map_name": "Auth rewrite", "edges": 1 }
  ],
  "total_edges": 5
}
```

`artefactitems.Handler.Archive` (DELETE `/work-items/{id}`) runs the same preflight before delegating to `ArchiveWorkItem`. If `len(impacted_maps) > 0` the response is

```
409 Conflict
{
  "code": "dependency_impact",
  "impacted_maps": [...],
  "total_edges": 5
}
```

The seam is wired in [`backend/cmd/server/main.go`](../backend/cmd/server/main.go) via the small `depsArchivePreflight` adapter that implements `artefactitems.DependencyImpactQuerier` over `dependencies.Service.ImpactForArtefact`. This keeps the import direction one-way (artefactitems → its own interface; dependencies stays independent) — no cycle risk.

Preflight errors **fail closed** (500 to the caller, never silent fall-through to the archive path). A flaky preflight cannot allow archive of a load-bearing artefact.

## HTTP surface

All routes mounted in [`backend/cmd/server/main.go`](../backend/cmd/server/main.go) under the canonical auth + sentinel middleware chain (`RequireAuth → RequireFreshPassword → sentinelMW`).

| Method | Path | Service method | Story |
|---|---|---|---|
| `POST` | `/_site/dependencies/maps` | `CreateMap` | B23.1.5 |
| `GET` | `/_site/dependencies/maps` | `ListMaps` (workspace + optional topology filter) | B23.2.1 |
| `GET` | `/_site/dependencies/maps/{id}` | `GetMapDetail` (with `edge_count`) | B23.2.1 |
| `PATCH` | `/_site/dependencies/maps/{id}` | `RenameMap` | B23.1.5 |
| `POST` | `/_site/dependencies/maps/{id}/archive` | `ArchiveMap` (idempotent) | B23.1.5 |
| `POST` | `/_site/dependencies/edges` | `CreateEdge` (tx + cycle guard + audit) | B23.1.6 |
| `GET` | `/_site/dependencies/edges` | `EdgesForFocusedArtefact` (three-bucket projection) | B23.2.1 |
| `POST` | `/_site/dependencies/edges/{id}/archive` | `ArchiveEdge` (idempotent) | B23.1.7 |
| `GET` | `/_site/dependencies/candidates` | `SearchCandidates` (server-side exclusion) | B23.2.2 |
| `GET` | `/_site/dependencies/{id}/transitive-impact` | `TransitiveImpact` (with `redacted_count`) | B23.3.1 |
| `GET` | `/_site/work-items/{id}/dependency-impact` | `ImpactForArtefact` (preflight) | B23.1.8 |
| `GET` | `/_site/portfolio-items/{id}/dependency-impact` | `ImpactForArtefact` (preflight) | B23.1.8 |

Frontend client: [`app/lib/apiSite/dependencies.ts`](../app/lib/apiSite/dependencies.ts), re-exported from [`app/lib/apiSite`](../app/lib/apiSite/index.ts).

## What's NOT here (explicit out-of-scope)

- **CPM forward/backward pass** — deferred via `TD-DEP-CPM-DURATION`. Reachability is the honest substrate until duration semantics are agreed.
- **Derived `is_blocked` rollup** — explicitly rejected. `artefacts.artefacts_is_blocked` remains the user-set manual flag, fully decoupled from dependency state. The BlockedToggle button at [`app/components/ArtefactInlineForm/BlockedToggle.tsx`](../app/components/ArtefactInlineForm/BlockedToggle.tsx) is the only writer.
- **Flow-state coupling** — no PATCH-state event triggers any dependency recompute. The graph is structural; flow-state lifecycle is separate.
- **Outbox / projection sidecar table** — descoped. Reachability is computed at read-time via CTE.
- **Composer's full render integration** — `usePersistedDependencyMap` hook is wired into the overlay (B23.2.4 substrate complete) but the existing ephemeral bucket-rendering path remains the source of truth until a map-picker UX lands. Tracked as `TD-DEP-COMPOSER-PERSISTENCE-RENDER`.

## Test surface

Unit + integration tests in [`backend/internal/dependencies/`](../backend/internal/dependencies/):

- `handler_test.go` — handler-level error mapping, allow/deny matrix per role, idempotency.
- `service_integration_test.go` — Tier-B against dev `vector_artefacts` (skipped when no tunnel). Notably:
  - `TestEdgeInsert_CycleRejected` — cycle CTE on a 3-node chain + 2-cycle + shortcut.
  - `TestEdgeInsert_UniquenessAndAudit` — three partial unique indexes + audit row shape.
  - `TestEdgesList_ProjectsThreeBuckets` — Story 2→3→5 + Story 3→8 from Story 3's focus.
  - `TestCandidateSearch_ExcludesAlreadyLinked` — cross-bucket exclusion.
  - `TestTransitiveImpact_RedactsAcrossClamp` — cross-clamp redaction.
- `backend/internal/artefactitems/dependency_preflight_test.go` — 409 + payload + summed `total_edges`; fail-closed on preflight error.

All Tier-B tests wrap their writes in a tx with `ROLLBACK` at the end — dev DB stays clean across runs.
