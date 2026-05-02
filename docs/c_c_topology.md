# Topology

Federated canvas-based organisational modelling. Plan: [`PLA-0006`](../dev/plans/PLA-0006.json). Evidence base: [`R028`](../dev/research/R028.json) §8 (Path C clarified, C.2) + [`R029`](../dev/research/R029.json) (build-vs-buy decision).

## What it is

`/topology` is a first-class product page where gadmin and a delegated padmin per top-level Office draw the organisation as a free-form tree of block diagrams. The page is named per tenant — e.g. **"MMFFDev: Topology"** — both as the browser title and the page heading. The default noun for a node is **Office**, overrideable per node. The canvas is the source of truth for the org model; nothing else is. The Topology tree powers Workspace scoping (Path C C.2), per-node clamp policy, rollups, audit boundaries, and cross-team move semantics across the rest of Vector.

## Schema (MVP)

| Table | Purpose |
|---|---|
| `org_nodes` | Self-referential tree (`parent_id` self-FK, nullable for root). Per-subscription. Carries name, gadmin-named `label_override` (default "Office"), icon, colour, layout metadata, soft-archive. Unique `(subscription_id, parent_id, name)`. |
| `org_node_roles` | Node-scoped role grants — admin / editor / viewer. `can_redelegate` ships as a column (schema-ready for Phase X) but is not exposed in MVP UI. Auditable. MVP-only constraint: at most one active admin per node. |
| `org_node_view_state` | Per-user collapse/expand state. Keeps canvas state per-user without polluting shared layout. |
| `portfolio_items.org_node_id` | FK to `org_nodes`. Backfilled with per-subscription root node, then NOT NULL. |
| `user_stories.org_node_id` | Same. |

## Sole-writer boundary

`backend/orgdesign.Service` is the sole writer for `org_nodes`, `org_node_roles`, `org_node_view_state`. Direct INSERTs from outside the service are blocked at the lint/CI level (same trust-no-one pattern as PLA-0005).

Service methods: `CreateNode`, `RenameNode`, `MoveNode` (cycle-checked), `ArchiveNode`, `GrantRole`, `RevokeRole`, `SetViewState`, `BulkPosition` (debounced canvas writes), `Subtree` (recursive-CTE walk), `AncestorsOf`, `ClampPredicate(user_id)`.

## Clamp predicate

`ClampPredicate(user_id)` returns the subtree of the user's lowest admin/editor/viewer node. It runs as **cross-cutting middleware** on every list endpoint touching `portfolio_items` or `user_stories` — feature teams don't re-implement it. A `lint:clamp-middleware` rule flags any new list endpoint that bypasses it.

UI clamp is convenience only; the server is authoritative.

## Federated handoff (MVP: single-level)

Single-author org-design doesn't scale to Lloyds-class trees (1,000–3,000 nodes). The MVP handoff flow:

1. Gadmin draws the top-level skeleton — root Office plus first-level Offices.
2. For each top-level Office, gadmin grants `admin` role to a padmin.
3. Padmin receives a notification, deep-link lands them on `/topology?focus=:nodeId` clamped to their subtree, with empty-state CTA: "Define this *<label_override>*'s structure".
4. Padmin builds the subtree to whatever depth they need.

**Phase X:** padmin re-delegation to leads (a `can_redelegate=true` flag on the grant). Schema is ready; UI doesn't expose it.

Every grant/revoke is audited. Gadmin retains override at any node.

## Diagram primitive

The canvas is `app/components/diagram-canvas/` — Vector-built, **not** React Flow / GoJS / Cytoscape. See [`c_c_diagram_canvas.md`](c_c_diagram_canvas.md) for API and performance contract. Includes 10px snap-to-grid by default. Primitive is also exposed via Samantha API (`samantha.diagram.canvas`) so custom-app authors can mount it.

## Performance contract

- 3,000-node Lloyds-shape stress fixture loads in <1.5s.
- Drag sustains 30 FPS.
- Rendered set capped at <500 via collapse-by-default + lazy expand.
- Layout (dagre in Web Worker) finishes <1s for any single subtree expansion.

CI gate: `dev/tests/diagram-canvas-stress.spec.ts` (gates the primitive) and `dev/tests/topology-stress.spec.ts` (gates the page).

## Resolved naming + scope decisions (MVP)

Locked 2026-05-02 to unblock storification. Decisions reflected in story titles, schema, and UI copy.

| Question | Decision |
|---|---|
| Page name | **Topology**, prefixed with the tenant's company name. Example: "MMFFDev: Topology". Browser title `<tenant-name>: Topology`. Page heading shows the same. |
| Node noun (default) | **Office**. Default `label_override` for the root and any node a tenant doesn't rename is "Office". Tenants can still override per-node. |
| Delegation depth cap | **Phase X.** MVP allows a single level of delegation (gadmin → padmin); padmin re-delegation to leads is deferred. `can_redelegate` column ships in schema (so we don't migrate later) but the UI doesn't expose it in MVP. |
| Multi-admin per node | **Phase X.** MVP enforces at most one active admin grant per node. Schema's existing `UNIQUE (node_id, user_id) WHERE revoked_at IS NULL` plus an MVP-only `UNIQUE (node_id) WHERE role='admin' AND revoked_at IS NULL` keep the door open for multi-admin later — drop the second constraint to enable Phase X. |
| Archive semantics | **Full access preserved; archived nodes go to limbo.** Archiving a node greys it (and its entire subtree) out on the canvas, leaves all role grants and FK relationships intact, and excludes the subtree from default queries (clamp predicate filters `soft_archive=true` unless the caller asks for archived). Children-of-archived-node deep-worm-hole semantics (cascade vs reparent vs orphan) are deferred to **Phase X**. MVP behaviour: archived = greyed-out, kept in place, kept reachable, kept revertable. |
| Snap-to-grid | **10px dotted grid, on by default.** Drag commits and auto-layout outputs both snap to grid intersections. `manual_x` / `manual_y` always persisted as multiples of `gridSize`. |

## Phase X (deferred)

These ship after MVP — schema is ready, UI is not:

- Padmin re-delegation to leads (`can_redelegate` UI exposure).
- Multi-admin per node (drop the MVP-only admin uniqueness constraint).
- Cascade rules for archiving a node with children (the "deep worm hole").
- Matrix orgs (one node, multiple parents).
- Org versioning / what-if branching.
- EA-grade overlays (capability maps, application portfolios, dependency views).
- Drop-on-canvas detach-to-root (gadmin-only).

## What this doc does NOT cover

- The diagram primitive itself — see [`c_c_diagram_canvas.md`](c_c_diagram_canvas.md).
- The Samantha API surface — see SDK reference once written.
