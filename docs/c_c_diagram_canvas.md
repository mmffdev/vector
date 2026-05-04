# Diagram canvas primitive — `<DiagramCanvas>`

Vector-built canvas substrate for tree/graph visualisations. Used by Org Design (PLA-0006) and exposed to custom-app authors via Samantha API. Plan: [`PLA-0006`](../dev/plans/PLA-0006.json). Evidence base: [`R029`](../dev/research/R029.json).

## Why we built it

R029 evaluated React Flow, GoJS, Cytoscape.js. None hit all three constraints (3,000-node performance, MIT-class licence, HTML-in-nodes). We need ~5% of what a general-purpose graph library provides — most of GoJS is bloat for our use case. Year-one GoJS cost (£15k–£40k) ≈ engineering effort to build it ourselves; commercial licence forbids derivative works. Decision: build it.

## Stack

- **Canvas2D** — single `<canvas>` element, off-screen layer for static, on-screen layer for hover/drag affordances.
- **dagre** (MIT) — layout engine, runs in a Web Worker.
- **d3-zoom** (BSD) — pan/zoom transforms.
- **No third-party graph library.**

## API (Phase 1, frozen at v1)

```tsx
<DiagramCanvas
  name="topology_canvas"        // registers as samantha._viewport.<slot>._kind.diagram_canvas.<name>
  nodes={...}
  edges={...}
  renderNode={(node, ctx) => /* user-supplied draw fn */}
  edgeStyle="orthogonal"
  layoutMode="auto-horizontal"
  gridSize={10}                  // dotted-grid spacing in px
  showGrid                       // dotted background visible (default true)
  onNodeDragStop={(nodeId, x, y) => /* debounced position commit (snapped) */}
  onNodeSelect={...}
  onDropTarget={(sourceId, targetId) => /* return false to reject */}
  miniMap
  controls
/>
```

The component takes a `name` (not a fully-qualified `addressableId`) and self-registers via `useRegisterAddressable` against the surrounding `<ViewportSlot>`. The fully-qualified address is resolved automatically — consumers never assemble it by hand.

Pluggable. Consumer supplies the node renderer (so a Topology Office draws block-diagram cards; a process-flow app draws activity boxes; a dependency map draws boxes-with-ports). Edge style is selectable.

The complete v1 prop surface is locked by a compile-time contract test at [`app/lib/samantha.contract.ts`](../app/lib/samantha.contract.ts). Removing or narrowing a frozen field fails the Next build, forcing either a v2 bump or a documented migration.

## Snap-to-grid

Built into the primitive:

- Background renders a dotted grid at `gridSize` pixels (default **10px**).
- All node drag commits snap to the nearest grid intersection.
- Auto-layout (dagre) outputs are rounded to the grid before render — keeps manual and auto layouts visually consistent.
- `manual_x` / `manual_y` persisted in the schema are always multiples of `gridSize`.
- `showGrid={false}` hides the visual grid but snapping still happens (snap is a behaviour, grid is a guide).

## Performance contract (CI gate)

| Metric | Target |
|---|---|
| Initial load (3,000-node Lloyds-class fixture) | <1.5s |
| Drag FPS | 30 sustained |
| Rendered-set cap (collapse + virtualisation) | <500 |
| Subtree layout (dagre worker) | <1s |

Test: [`dev/tests/diagram-canvas-stress.spec.ts`](../dev/tests/diagram-canvas-stress.spec.ts). Gates the primitive independently of any consuming page; matches the topology-stress page-level fixture in [`c_c_topology.md`](c_c_topology.md).

### Web Worker policy

Layout runs in a Web Worker so dagre never blocks the main thread under stress. The CSP allows `worker-src 'self' blob:` for this. If the worker fails to spawn (older browser, restrictive CSP override) the primitive falls back to running dagre inline on the main thread — correct behaviour, slower under load. The fallback path is exercised by stress tests so regressions surface in CI.

## Phase 1 scope

- Rectangles
- Parent-child orthogonal edges
- Drag-drop with cycle hooks
- Minimap
- fitView
- Debounced position commits
- Pluggable node renderer

## Phase 2 (deferred)

- Bezier edges
- Multi-select
- Keyboard shortcuts beyond fit/zoom
- Edge labels
- Custom edge styles

## Samantha API exposure

Registered as `samantha.diagram.canvas`, frozen at **v1.0.0** (story 00285). Custom-app and custom-page authors mount it from their app manifest, supply a `renderNode` callback, and bind to their own data source. Reference example app: [`ui_app_team_flow`](../app/store/ui_apps/ui_app_team_flow/) — "My Team's Process Flow", a 5-node intake → triage → build → review → ship pipeline that exercises every frozen prop.

The reference app is a **contract test**: if it breaks in CI, the primitive's prop or event surface changed and we either revert or bump the version. The compile-time contract at [`app/lib/samantha.contract.ts`](../app/lib/samantha.contract.ts) is the second line of defence — it catches narrowing changes the reference app might miss.

### Addressables registration

The component calls `useRegisterAddressable({ kind: "diagram_canvas", name })` on mount, so every canvas is reachable through the same Samantha addressing scheme as panels and tables. See [`c_c_addressables.md`](c_c_addressables.md) for the substrate.

## Stopgap

If Phase 1 slips beyond 6 weeks, fall back to **Cytoscape.js** (MIT, canvas-rendered, scales to 10k+ nodes) behind the same `<DiagramCanvas>` facade — Samantha API contract unchanged.

## What this doc does NOT cover

- Topology specifics (schema, clamp predicate, federated handoff, governance gate, audit) — see [`c_c_topology.md`](c_c_topology.md).
- The PLA-0005 addressables substrate — see [`c_c_addressables.md`](c_c_addressables.md).
- The Samantha SDK reference — separate doc once SDK lands; v1 contract is at [`app/lib/samantha.contract.ts`](../app/lib/samantha.contract.ts).
