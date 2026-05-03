# Diagram canvas primitive — `<DiagramCanvas>`

Vector-built canvas substrate for tree/graph visualisations. Used by Org Design (PLA-0006) and exposed to custom-app authors via Samantha API. Plan: [`PLA-0006`](../dev/plans/PLA-0006.json). Evidence base: [`R029`](../dev/research/R029.json).

## Why we built it

R029 evaluated React Flow, GoJS, Cytoscape.js. None hit all three constraints (3,000-node performance, MIT-class licence, HTML-in-nodes). We need ~5% of what a general-purpose graph library provides — most of GoJS is bloat for our use case. Year-one GoJS cost (£15k–£40k) ≈ engineering effort to build it ourselves; commercial licence forbids derivative works. Decision: build it.

## Stack

- **Canvas2D** — single `<canvas>` element, off-screen layer for static, on-screen layer for hover/drag affordances.
- **dagre** (MIT) — layout engine, runs in a Web Worker.
- **d3-zoom** (BSD) — pan/zoom transforms.
- **No third-party graph library.**

## API (Phase 1)

```tsx
<DiagramCanvas
  addressableId="samantha._viewport.app._kind.topology.canvas"
  nodes={...}
  edges={...}
  renderNode={(node, ctx) => /* user-supplied draw fn */}
  edgeStyle="orthogonal"
  layoutMode="auto-horizontal"
  gridSize={10}              // dotted-grid spacing in px
  showGrid                   // dotted background visible (default true)
  onNodeDragStop={(nodeId, x, y) => /* debounced position commit (snapped) */}
  onNodeSelect={...}
  onDropTarget={(sourceId, targetId) => /* return false to reject */}
  miniMap
  controls
/>
```

Pluggable. Consumer supplies the node renderer (so a Topology Office draws block-diagram cards; a process-flow app draws activity boxes; a dependency map draws boxes-with-ports). Edge style is selectable.

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
| Initial load (2,500-node Lloyds-class fixture) | <1.5s |
| Drag FPS | 30 sustained |
| Rendered-set cap (collapse + virtualisation) | <500 |
| Subtree layout (dagre worker) | <1s |

Test: [`dev/tests/diagram-canvas-stress.spec.ts`](../dev/tests/diagram-canvas-stress.spec.ts). Gates the primitive independently of any consuming page.

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

Registered as `samantha.diagram.canvas` (versioned v1). Custom-app and custom-page authors mount it from their app manifest, supply a `renderNode` callback, and bind to their own data source. Reference example app ships with PLA-0006 ("My team's process flow" or equivalent).

The reference app is a **contract test**: if it breaks in CI, the primitive's prop or event surface changed and we either revert or bump the version.

## Stopgap

If Phase 1 slips beyond 6 weeks, fall back to **Cytoscape.js** (MIT, canvas-rendered, scales to 10k+ nodes) behind the same `<DiagramCanvas>` facade — Samantha API contract unchanged.

## What this doc does NOT cover

- Org Design specifics (schema, clamp predicate, federated handoff) — see [`c_c_org_design.md`](c_c_org_design.md).
- The Samantha SDK reference — separate doc once SDK lands.
