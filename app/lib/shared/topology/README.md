# `app/lib/shared/topology` — unified topology walker

PLA-0044. Single generic engine that every topology consumer composes:
canvas dagre layout, tree-state hook, topology flyout, scope rail, BFF
`/_site/topology/tree`, gadmin UserNodeAssignment picker. Replaces four
independent recursive walks with one tested primitive and adds a fifth
consumer on the same engine.

## Catalogue

This module is row 1 of [`docs/c_shared_methods.md`](../../../../docs/c_shared_methods.md).

- TS: `app/lib/shared/topology/walker.ts`
- Go: `backend/internal/shared/topology/walker.go`
- Fixtures: `dev/fixtures/shared/topology/*.json`

## Contract

```ts
walkTopology<T extends TopologyNode>(
  nodes: T[],
  opts: {
    collapsed: Set<string>;
    sort: (a: T, b: T) => number;
    filter?: (n: T) => boolean;
    maxDepth?: number; // default 12
  },
): {
  rows: FlattenedRow<T>[];
  visibleIds: Set<string>;
  visibleEdges: Array<{ source: string; target: string }>;
  childrenOf: Map<string | null, T[]>;
};
```

`TopologyNode` is the minimum required shape: `{ id, parent_id }`. The
generic `T` parameter lets callers pass any richer node type
(`OrgNode`, `MyGrant`, BFF DTOs) without an adapter layer.

## Invariants

- **Orphan policy = drop.** A node whose `parent_id` is set but whose
  parent is missing or filtered is excluded entirely — it does NOT get
  re-rooted under `null`. (This was the ScopeRail phantom-orphan bug
  the walker is replacing.)
- **Filter applies to subtree.** Dropping a node also drops everything
  beneath it.
- **Sort is caller-injected.** `byPosition` and `byLabel` are exported
  for convenience; pass any comparator with the same signature.
- **`ancestorMoreChildren` is uniform.** Length always equals `depth`.
  Index `d` records "the ancestor at depth `d` has a later sibling
  subtree below this row." Renderers that suppress the depth-0 spine
  ignore index 0; the walker emits it consistently either way.
- **`visibleEdges` are abstract.** Each is `{ source, target }` — no
  coordinates. Dagre / d3-zoom attach geometry downstream.
- **Cycle guard = depth cap.** Default 12 (matches DescendantNodeIDs).
  Recursion halts; no synthetic row is emitted.

## Parity

`dev/fixtures/shared/topology/*.json` are golden fixtures consumed by
both `walker.test.ts` (Vitest) and `backend/internal/shared/topology/walker_test.go`.
Both runtimes must produce byte-identical row projections per
`projectRow` in the TS test (and its Go counterpart). If you change the
walker, regenerate the expected payloads in BOTH suites and verify the
fixture files match — that is the cross-runtime contract.

## Consumers (post-cutover)

| Caller | Replaces |
|---|---|
| `app/components/topology/layoutWithDagre.ts` | inline visibleIds + visibleEdges walk |
| `app/components/topology/useTopologyTreeState.ts` | inline `childrenOf` Map build |
| `app/components/TopologyTreeFlyout.tsx` | local `flatten()` recursion |
| `app/components/ScopeRail.tsx` | local `flattenTree()` (and fixes the orphan re-root bug) |
| `app/components/topology/UserNodeAssignment.tsx` | (new) — gadmin picker for `roles_org_nodes` |
| `backend/internal/orgdesign/handler.go` `GET /_site/topology/tree` | inline scope-clamped flatten (mirrors TS) |
