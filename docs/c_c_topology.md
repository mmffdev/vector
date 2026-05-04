# Topology

Federated canvas-based organisational modelling. Plan: [`PLA-0006`](../dev/plans/PLA-0006.json). Evidence base: [`R028`](../dev/research/R028.json) §8 (Path C clarified, C.2) + [`R029`](../dev/research/R029.json) (build-vs-buy decision).

## What it is

`/topology` is a first-class product page where gadmin and a delegated padmin per top-level Office draw the organisation as a free-form tree of block diagrams. The page is named per tenant — e.g. **"MMFFDev: Topology"** — both as the browser title and the page heading. The default noun for a node is **Office**, overrideable per node. The canvas is the source of truth for the org model; nothing else is. The Topology tree powers Workspace scoping (Path C C.2), per-node clamp policy, rollups, audit boundaries, and cross-team move semantics across the rest of Vector.

## Schema (MVP)

| Table | Purpose |
|---|---|
| `workspaces` | Workspace tier above `org_nodes` (PLA-0006 / migration 098). A subscription holds 1..N workspaces; each owns its own `org_nodes` tree. Per-subscription `slug` is unique among live rows; archived rows release their slug. Soft-archive via `archived_at` + `archived_by`. |
| `workspace_roles` | Workspace-scoped role grants — admin / editor / viewer. Mirrors `org_node_roles`. `can_redelegate` ships as a column (Phase X) but is not exposed in MVP UI. MVP single-admin partial unique index `workspace_roles_single_admin`. |
| `org_nodes` | Self-referential tree (`parent_id` self-FK, nullable for root). Per-subscription, narrowed to a `workspace_id` (migration 099). Carries name, gadmin-named `label_override` (default "Office"), icon, colour, layout metadata, soft-archive. Unique `(subscription_id, parent_id, name)`. |
| `org_node_roles` | Node-scoped role grants — admin / editor / viewer. `can_redelegate` ships as a column (schema-ready for Phase X) but is not exposed in MVP UI. Auditable. MVP-only constraint: at most one active admin per node. |
| `org_node_view_state` | Per-user collapse/expand state. Keeps canvas state per-user without polluting shared layout. |
| `portfolio_items.org_node_id` | FK to `org_nodes`. Backfilled with per-subscription root node, then NOT NULL. |
| `user_stories.org_node_id` | Same. |

## Sole-writer boundary

`backend/orgdesign.Service` is the sole writer for `org_nodes`, `org_node_roles`, `org_node_view_state`. Direct INSERTs from outside the service are blocked at the lint/CI level (same trust-no-one pattern as PLA-0005).

Service methods: `CreateNode`, `RenameNode`, `MoveNode` (cycle-checked), `ArchiveNode`, `GrantRole`, `RevokeRole`, `SetViewState`, `BulkPosition` (debounced canvas writes), `Subtree` (recursive-CTE walk), `AncestorsOf`, `ClampPredicate(user_id)`.

## Workspaces (PLA-0006 / story 00376)

`backend/internal/workspaces.Service` is the sole writer for `workspaces` and `workspace_roles`. The boundary is enforced by `dev/scripts/lint_writer_boundary.py` — INSERT / UPDATE / DELETE on either table from outside `backend/internal/workspaces/` fails CI. Same trust-no-one pattern as `orgdesign.Service` and the PLA-0005 addressables service.

Service methods:

- **Commands** — `Create(ctx, CreateInput) (Workspace, error)`, `Rename(ctx, subscriptionID, workspaceID, newName, actorID)`, `Archive(ctx, subscriptionID, workspaceID, actorID)`, `Restore(ctx, subscriptionID, workspaceID, actorID)`.
- **Reads** — `Get(ctx, subscriptionID, workspaceID)`, `ListBySubscription(ctx, subscriptionID, includeArchived, actorID)`.
- **Role grants** — `GrantRole(ctx, subscriptionID, workspaceID, userID, role, actorID) (uuid.UUID, error)`, `RevokeRole(ctx, subscriptionID, workspaceID, userID, actorID)`, `ListRoles(ctx, subscriptionID, workspaceID)`.

Permission gates are sourced from migration 100 (catalogue parity-checked at boot via `permissions.VerifyParity`):

| Method | Permission code |
|---|---|
| `Create` | `workspace.create` |
| `Rename` | `workspace.rename` |
| `Archive` | `workspace.archive` |
| `Restore` | `workspace.restore` |
| `ListBySubscription(includeArchived=true)` | `workspace.view_archived` |
| `GrantRole` / `RevokeRole` | `workspace.rename` (treated as the "manage this workspace" perm in MVP; future story can split into `.grant` / `.revoke`) |

Sentinel errors (handlers map to HTTP shape — story 00377 owns the REST surface): `ErrNotFound`, `ErrSlugTaken`, `ErrAlreadyArchived`, `ErrNotArchived`, `ErrInvalidName`, `ErrInvalidSlug`, `ErrInvalidRole`, `ErrPermissionDenied`, `ErrSingleAdminViolation`, `ErrCannotArchiveLastLive`, `ErrGrantNotFound`.

Invariants enforced at the service layer (defence-in-depth on top of DB constraints):

- **Per-subscription unique slug among live rows** — partial unique index `workspaces_subscription_slug_live`. Archived rows release their slug; `Restore` re-checks against live siblings before lifting the archive flag.
- **Last-live-workspace guard** — `Archive` refuses if the workspace is the only live one for its subscription (returns `ErrCannotArchiveLastLive`). A tenant must always own ≥1 live workspace.
- **Single-admin per workspace (MVP)** — `GrantRole(role=admin)` checks for an existing active admin grant before INSERT; partial unique index `workspace_roles_single_admin` is the DB safety net (translated to `ErrSingleAdminViolation` on 23505).
- **Idempotent grants** — re-granting the same `(workspaceID, userID)` with an active grant returns the existing grant id; the role is NOT mutated (a role change requires explicit revoke + re-grant).

Audit logging happens at the service layer (mirrors `roles.Service`, not `orgdesign.Service` which audits in the handler). Actions emitted: `workspace.created`, `workspace.renamed`, `workspace.archived`, `workspace.restored`, `workspace.role_granted`, `workspace.role_revoked`. The `Audit *audit.Logger` field on `Service` is nil-safe so unit tests don't need a logger.

Reads are NOT permission-gated — the route layer's clamp predicate decides what the actor sees. This matches the orgdesign read surface.

## Clamp predicate

`ClampPredicate(user_id)` returns the subtree of the user's lowest admin/editor/viewer node. It runs as **cross-cutting middleware** on every list endpoint touching `portfolio_items` or `user_stories` — feature teams don't re-implement it. A `lint:clamp-middleware` rule flags any new list endpoint that bypasses it.

UI clamp is convenience only; the server is authoritative.

## Federated handoff (MVP: single-level)

Single-author org-design doesn't scale to Lloyds-class trees (1,000–3,000 nodes). The MVP handoff flow:

1. Gadmin draws the top-level skeleton — root Office plus first-level Offices.
2. For each top-level Office, gadmin grants `admin` role to a padmin.
3. Padmin receives a notification (story 00283) — inbox row plus toast — with a deep-link to `/topology?focus=:nodeId`. Landing on that URL clamps the canvas to their subtree and shows the empty-state CTA "Define this *<label_override>*'s structure".
4. Padmin builds the subtree to whatever depth they need.

### Governance gate (story 00288)

The Service refuses any grant whose `granterRole` is not `gadmin` and any grant whose `can_redelegate=true`. Two sentinel errors carry the gate:

- `ErrDelegationDepth` — only gadmin may issue grants in MVP. Handler maps to **403**.
- `ErrRedelegationDisabled` — `can_redelegate` is reserved for Phase X and must be `false`. Handler maps to **403**.

Empty `granterRole` is treated as gadmin so service-layer test fixtures and tooling that pre-authorise outside the HTTP path keep working. The handler always passes the live caller's role, so production traffic is gated.

### Audit (story 00287)

Every Service mutation is logged via `audit.Logger` at the handler layer (best-effort, never blocks the response). Actions emitted:

- `topology.node.created`, `topology.node.renamed`, `topology.node.moved`, `topology.node.archived`, `topology.node.bulk_position`
- `topology.role.granted`, `topology.role.revoked`

`org_node_view_state` is **not** audited — it's a per-user UI preference, not a topology change. Audit wiring lives in `handler.go` (`logAudit` helper + `clientIP` extraction); the Service signature is left clean so the sole-writer boundary doesn't need to know about actors or IPs.

Gadmin retains override at any node.

## Diagram primitive

The canvas is `app/components/diagram-canvas/` — Vector-built, **not** React Flow / GoJS / Cytoscape. See [`c_c_diagram_canvas.md`](c_c_diagram_canvas.md) for API and performance contract. Includes 10px snap-to-grid by default. Primitive is also exposed via Samantha API (`samantha.diagram.canvas`, frozen at v1 — story 00285) so custom-app authors can mount it. The frozen v1 surface is enforced at compile time by [`app/lib/samantha.contract.ts`](../app/lib/samantha.contract.ts).

## Addressables (story 00286)

`/topology` is fully wired into the PLA-0005 substrate:

- The user route group's layout supplies `<ViewportSlot kind="app">` so every Panel under `/topology` registers under `samantha._viewport.app.…`.
- Each named region — `topology_focus_cta`, `topology_error`, `topology_empty`, `topology_canvas`, `topology_side_panel` — is a `<Panel name="…">`.
- `<DiagramCanvas name="topology_canvas">` registers itself as a `diagram_canvas`-kind addressable via `useRegisterAddressable`, so Samantha can resolve and pilot the canvas the same way it resolves panels and tables.

`npm run lint:addressables` is the CI gate.

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

## Canvas-management UX (PLA-0006 stories 00310–00322)

Built on top of the MVP foundation. Every UI surface below mounts inside `app/(user)/topology/page.tsx` unless noted; backend writes go through `orgdesign.Service` (sole writer).

- **Slide-in edit flyout (`<Panel name="topology_edit_flyout">`)** — right-side overlay over the canvas pane only; transforms `translateX(100%) → 0` over 300ms cubic-bezier; selecting a node animates the d3-zoom viewport so the node centres in the visible canvas to the LEFT of the flyout (`offsetX = -FLYOUT_WIDTH/2`); ESC closes and restores prior focus; Tab cycles inside.
- **Write-through field edits** — name, description, label_override each have their own 250ms-debounced trailing-edge PATCH carrying exactly one field. Backend emits field-specific audit actions: `topology.node.renamed | described | relabelled`. Migration `093_org_nodes_description_not_null.sql` makes `description TEXT NOT NULL DEFAULT ''` so client + server agree '' means "no description".
- **Mini parent/children tree (`MiniTreeView`)** — header of the flyout; shows parent (one hop up), self, and direct children as clickable rows; sourced from the in-memory `tree` (no extra fetch); each click swaps `selectedId` and the centring effect re-animates.
- **Disconnect-not-delete** — `service.DisconnectNode` sets `parent_id = NULL` (no DELETE, no archive); idempotent on already-detached roots; the subtree stays live and reachable via the disconnected tray.
- **Disconnected nodes tray (`<Panel name="topology_disconnected_tray">`)** — left-side slide-in mirroring the flyout pattern; toolbar toggle is shown only when at least one orphan exists. Each row offers a re-attach `<select>` populated from every live node EXCEPT self and descendants (cycle filter). Re-attach calls `topologyApi.move(rootId, parentId)`.
- **Reset canvas (gadmin-only)** — toolbar button → confirm modal requires typing `RESET`; `POST /api/topology/reset` mass-archives every live node (role grants + view-state preserved). Backend re-checks `actorRole == "gadmin"` independently of the UI gate.
- **Commit working model (gadmin-only)** — `subscriptions.topology_committed_at|by` checkpoint; `GetCommitStatus` returns `{committed_at, committed_by, last_node_update, dirty_since_commit}`; UI banner shown when dirty (any node `updated_at > committed_at`). Migration `092_subscriptions_topology_committed.sql`.

### Endpoints (added on top of the MVP `/api/topology` surface)

- `PATCH /api/topology/nodes/:id` — sparse field patch; one field per call to drive field-specific audit action.
- `POST /api/topology/nodes/:id/disconnect` — parent_id → NULL.
- `GET /api/topology/disconnected` — orphan list excluding canonical root.
- `GET /api/topology/levels`, `POST /api/topology/levels`, `PATCH /api/topology/levels/:id` — first-class `org_levels`.
- `GET /api/topology/commit`, `POST /api/topology/commit` — commit status and stamp.
- `POST /api/topology/reset` — gadmin-only mass-archive.

### Sentinel errors (sole-writer boundary)

`ErrInvalidName` (empty patch / blank name), `ErrCommitForbidden`, `ErrResetForbidden` (non-gadmin), `ErrCycleDetected` (existing). Handlers map to 400 / 403 respectively.

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
- The Samantha API surface — see [`app/lib/samantha.contract.ts`](../app/lib/samantha.contract.ts) for the v1 frozen contract and the wider SDK reference once written.
- The PLA-0005 addressables substrate it adopts — see [`c_c_addressables.md`](c_c_addressables.md).
