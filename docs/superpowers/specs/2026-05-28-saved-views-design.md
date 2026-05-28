# Saved Views — design spec

**Status:** Draft for review.
**Authored:** 2026-05-28
**Branch:** `feat/objecttree-fields-picker` (will be renamed to `feat/saved-views` once approved)
**Predecessors on this branch:** `0b656858` (ColumnPicker Rally-parity UI), `f2cfb2b2` (ColumnSpec enrichment + useColumnCatalogue hook), `970728c3` (TD-COLUMNSTORE-ANALYTICAL-TABLES)
**Origin:** Brainstorm session 2026-05-28. Rally's pattern reviewed (community thread + techdocs). User's columnstore + Oracle-era scale anxieties surfaced and reconciled.

---

## 1. North star

**A "saved view" is a named, persisted, scope-aware configuration of an interactive UI surface.** Today the only consumer is `<ObjectTree>` (grid views over work-items / portfolio-items / sprints / risks / strategy). Tomorrow the same table serves saved page layouts (`/value-flow` with N components arranged a certain way) and any future "users-can-save-how-they-set-this-up" feature.

One table. One mechanism. Many consumers, distinguished by a `kind` discriminator.

This document specifies the substrate. Per-consumer integration (e.g. wiring saved views into `<ObjectTree>`) is a separate spec.

---

## 2. What lives in a view

Per Rally's contract (verbatim from their modal copy, validated against their screenshots):

> Filters, column settings, selected fields, sort order, page size, and group by options will be saved in this view.

For `kind='objecttree'` the body carries seven fields:

1. `visible_columns: string[]` — column keys (built-in names + future `field:<uuid>` for custom fields)
2. `column_widths: { [key]: number }` — per-column pixel widths if user-resized
3. `column_order: string[]` — explicit ordering when reorderable (today equal to `visible_columns`)
4. `filters: object` — filter chip state (which chip + which value, keyed by chip ID)
5. `sort: { key: string, direction: 'asc' | 'desc' }[]` — multi-column sort
6. `page_size: number` — items per page
7. `group_by: string | null` — grouping column when grouping is enabled

For `kind='page_layout'` (future, designed forward):

1. `component_order: string[]` — addressable IDs of mounted components, in render order
2. `component_visibility: { [id]: boolean }` — hide/show per component
3. `component_overrides: { [id]: object }` — per-component prop overrides

The JSONB column is **schema-less per kind**. Adding a field is a code change in the consumer; no migration.

---

## 3. Scope semantics

Three sharing states, matching Rally:

| Scope value | User-facing label | Who can see it |
|---|---|---|
| `'user'` | Not Shared | Owner only |
| `'node'` | Shared With Team | Any member of the topology node |
| `'workspace'` | Shared With Workspace | Any member of the workspace |

A view in any scope is always implicitly bounded by `subscription_id` (tenant clamp). Cross-tenant visibility is impossible by construction — the row carries the subscription on its face and every read filters on it first.

### Promotion / demotion

Sharing state is **mutable on the same row**. A user creates a personal view, later promotes it to team — same row, UPDATE on `scope` and the relevant ID column. The view body stays put; nothing copies.

**Save As New View** is the explicit copy affordance: takes the current view body (whether the loaded view, or just the page's transient state), creates a new row, lets the user choose name + scope.

Two distinct verbs:
- **Save Changes** → UPDATE existing row in place
- **Save As New View** → INSERT new row

---

## 4. Permission rule

Rally's admin-only sharing rule has been generating customer complaints since 2014 (community thread, referenced in brainstorm). Vector takes the permissive path at the team level and the strict path at the workspace level:

| Action | Required permission |
|---|---|
| Create personal view (`scope='user'`) | Authenticated user |
| Create / promote to node view (`scope='node'`) | Must be a member of the target topology node (`topology_nodes_members` join exists) |
| Create / promote to workspace view (`scope='workspace'`) | Workspace admin permission (`workspace.admin` or higher) |
| Edit view body of personal view | Owner only |
| Edit view body of node view | Owner, OR any node admin |
| Edit view body of workspace view | Owner, OR any workspace admin |
| Delete personal view | Owner only |
| Delete node view | Owner, OR any node admin |
| Delete workspace view | Owner, OR any workspace admin |
| Rename view | Same rule as edit |

`id_user_created_by` is **immutable** — promoting a view doesn't change who owns it.

### Server is the gate

Per the project HARD RULE on server-side enforcement: all permission checks live in `savedviews.Service`. The frontend filters the dropdown UX to "what you can do" but is never authoritative — every write API call re-verifies. A user constructing a raw POST to promote someone else's view receives 403.

---

## 5. Substrate decision — Postgres + JSONB

### Why Postgres

- Subscription clamp + workspace clamp + node clamp + user clamp are all relational joins. Sentinel's authorisation surface already lives here.
- View bodies are small JSON documents (well under 5KB each). Postgres + JSONB is exactly built for this.
- Procurement narrative (SOC 2 / defence-finance buyers per `context/USER.md`) is mature for Postgres + the existing tenant-isolation discipline. Adding a second store doubles the audit surface.
- Read pattern is point lookup + small range scan (1–20 rows per fetch). This is canonical row-store territory. Columnstore explicitly rejected — see TD-COLUMNSTORE-ANALYTICAL-TABLES for the workloads where columnstore would win (audit_logs / error_events / future history tables — not saved_views).

### Why not <other stores>

- **Mongo / document DB** — Postgres JSONB already does what Mongo does for this shape; second backup story, second auth surface, second SOC 2 questionnaire. Rejected.
- **Valkey as source of truth** — ephemeral by design; views need durability. Valkey IS used as a read-side cache (§9).
- **S3 / blob store** — overkill for 5KB documents.
- **Event sourcing (Kafka / NATS JetStream)** — wrong shape; views are state, not log.

### Scale envelope

| Phase | Row count | What we do |
|---|---|---|
| Today → ~200K users | <10M rows | Default Postgres settings; B-tree indexes per §7 |
| Mid-scale (~2M users) | 10M–100M rows | Tune autovacuum cost limits; enable Valkey read-side cache (§9); add partial indexes if EXPLAIN ANALYZE shows hot reads |
| High-scale (~10M users) | 100M–500M rows | Partition `saved_views` by `id_subscription` HASH (PARTITION BY HASH (id_subscription)); declarative partitioning, single ALTER from current shape |
| Beyond | 500M+ rows | At this point a platform team makes the substrate call; the `ViewStore` interface (§8) keeps the swap reversible |

### Future-proofing artefact

The `ViewStore` Go interface (§8) is the **boundary that makes the substrate decision reversible.** Every handler and resolver depends on the interface, never on `pgxpool.Pool` directly. If a future scale curve makes Postgres the wrong answer for this one table, we swap the interface implementation without touching consumers.

---

## 6. Table: `saved_views`

In `vector_artefacts`. Full-table-name column prefix per the project HARD RULE.

```sql
CREATE TABLE saved_views (
    -- Identity
    saved_views_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant clamp (always populated; every read filters here first)
    saved_views_id_subscription UUID NOT NULL,

    -- Discriminators
    saved_views_kind            TEXT NOT NULL,
    saved_views_scope           TEXT NOT NULL,

    -- Scope keys — exactly one of (id_user, id_node, id_workspace) populated,
    -- matching scope value. Enforced by CHECK + sole-writer service.
    saved_views_id_user         UUID,
    saved_views_id_node         UUID,
    saved_views_id_workspace    UUID,

    -- What this view applies to. OPAQUE INTERNAL IDENTIFIER following the
    -- convention `<kind>:<stable-id>`. Examples:
    --   objecttree:work_items
    --   objecttree:portfolio_items
    --   objecttree:timeboxes_sprints
    --   objecttree:risks
    --   chart:burndown                      (future)
    --   custom_page:<page_uuid>             (future)
    --   objecttree:custom:<page_uuid>:<instance_uuid>   (future grid inside a custom page)
    --
    -- The ID portion (after the colon) is the STABLE identifier of the resource
    -- the view applies to — NEVER the user-visible name. This is what gives us
    -- rename propagation for free: when a custom page is renamed, its `page_uuid`
    -- doesn't change, so every saved-view row pointing at it still resolves;
    -- the new name is resolved at render time via a JOIN against the underlying
    -- resource table (custom_pages, topology_nodes, etc.), never stored here.
    --
    -- ANTI-PATTERN: do NOT add a denormalised `target_label` column. The "save a
    -- JOIN" instinct is the trap — it makes renames non-propagating, requires a
    -- backfill on every rename, and re-introduces the data-drift class of bug
    -- the opaque-ID convention exists to prevent.
    saved_views_target          TEXT NOT NULL,

    -- Human-readable
    saved_views_name            TEXT NOT NULL,

    -- The actual config — schema-less per kind. See §2.
    saved_views_body            JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Audit / lifecycle
    saved_views_id_user_created_by UUID NOT NULL,
    saved_views_created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    saved_views_updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    saved_views_archived_at     TIMESTAMPTZ,

    -- Kind allow-list — additive via ALTER as new kinds land
    CONSTRAINT saved_views_kind_check
        CHECK (saved_views_kind IN ('objecttree', 'page_layout')),

    -- Scope allow-list
    CONSTRAINT saved_views_scope_check
        CHECK (saved_views_scope IN ('user', 'node', 'workspace')),

    -- Exactly one scope ID populated, matching scope value
    CONSTRAINT saved_views_one_scope_id
        CHECK (
            (saved_views_scope = 'user'      AND saved_views_id_user      IS NOT NULL AND saved_views_id_node IS NULL     AND saved_views_id_workspace IS NULL)
         OR (saved_views_scope = 'node'      AND saved_views_id_user      IS NULL     AND saved_views_id_node IS NOT NULL AND saved_views_id_workspace IS NULL)
         OR (saved_views_scope = 'workspace' AND saved_views_id_user      IS NULL     AND saved_views_id_node IS NULL     AND saved_views_id_workspace IS NOT NULL)
        ),

    -- Tenant integrity — the scope owner must live in the same subscription.
    -- Enforced by trigger on INSERT/UPDATE; see migration (§10).
    -- Cannot be a CHECK constraint because it requires cross-table lookups.

    -- Soft delete
    CONSTRAINT saved_views_archived_after_created
        CHECK (saved_views_archived_at IS NULL OR saved_views_archived_at >= saved_views_created_at)
);

COMMENT ON TABLE saved_views IS
    'Saved view configurations — Rally-style "Save As New View" / "Manage Saved Views". '
    'One table serves multiple consumers via kind discriminator (objecttree, page_layout). '
    'Scope discriminator (user/node/workspace) controls sharing. '
    'Permission rules enforced in backend/internal/savedviews/service.go.';
```

---

## 7. Indexes

All partial on `saved_views_archived_at IS NULL` — never scan archived rows for active reads.

```sql
-- The dominant read: "what views can this user see right now for this target?"
-- Three separate partial indexes per scope. Postgres can union via Bitmap-Or
-- when the picker needs all three simultaneously.

CREATE INDEX saved_views_by_user
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_user,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'user';

CREATE INDEX saved_views_by_node
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_node,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'node';

CREATE INDEX saved_views_by_workspace
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_workspace,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'workspace';

-- Audit / manage modal: "all views I created"
CREATE INDEX saved_views_by_creator
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_user_created_by,
        saved_views_kind
    )
    WHERE saved_views_archived_at IS NULL;
```

Why three partial indexes vs one composite: each scope read is point-lookup-shaped on a different column. A single composite index on `(scope, id_user, id_node, id_workspace, ...)` would be larger and forces the planner to access columns it can ignore. Three smaller partial indexes pin the planner choice.

Decision deferred: a GIN index on `saved_views_body` for body-content search. Not built today — adoption first, observe the access pattern, add only if `WHERE body @> '{...}'` becomes a real read. The body is small enough that B-tree-key reads + Go-side filter handle the early adoption phase.

---

## 8. Backend — `savedviews` Go package

New package: `backend/internal/savedviews/`. Files match the project's standard layout (`doc.go`, `service.go`, `handler.go`, `sql.go`, `types.go`).

### `ViewStore` interface

The future-proofing artefact. Every handler / resolver depends on this, not on `pgxpool.Pool`. Today's `PostgresViewStore` implements it; tomorrow's `CachedViewStore` wraps it; a possible future `OtherStoreViewStore` implements the same surface and slots in by main.go wire change.

```go
package savedviews

type ViewStore interface {
    // Reads
    GetByID(ctx context.Context, subID, viewID uuid.UUID) (*View, error)
    ListVisibleToUser(ctx context.Context, q ListVisibleQuery) ([]View, error)
    ListByCreator(ctx context.Context, subID, userID uuid.UUID, kind string) ([]View, error)

    // Writes — all sole-writer-enforced
    Create(ctx context.Context, in CreateInput) (*View, error)
    UpdateBody(ctx context.Context, subID, viewID, actorUserID uuid.UUID, body json.RawMessage, name *string) (*View, error)
    UpdateScope(ctx context.Context, in UpdateScopeInput) (*View, error)
    Archive(ctx context.Context, subID, viewID, actorUserID uuid.UUID) error
}
```

`UpdateBody` and `UpdateScope` are separate methods because they encode different permission rules. Body-edit reuses ownership/admin; scope-change reuses share-permission. Separating them keeps the permission check at the boundary, not in the body.

### `Service` — the sole writer + permission enforcement

`savedviews.Service` wraps a `ViewStore` and adds:

- **Permission gate per method** — each write method takes an `actor uuid.UUID`, looks up the actor's permissions against the target view, raises a typed sentinel error (`ErrForbidden`, `ErrNotFound`) on rejection. Per the SERVER-IS-THE-GATE HARD RULE.
- **Cross-table tenant integrity** — on Create, verifies (`scope='user'` → user lives in `id_subscription`) / (`scope='node'` → node belongs to a workspace in `id_subscription`) / (`scope='workspace'` → workspace belongs to `id_subscription`). On scope change, re-verifies for the new scope.
- **Audit log emission** — every Create / UpdateScope / Archive writes one row to `audit_logs` (existing project surface). Body edits are logged but the body itself is not, per the policy already in audit_logs (writes are noted, payloads are not).

### Permission resolution

The service depends on three existing surfaces:

- `topology.Service.IsNodeMember(ctx, userID, nodeID) (bool, error)` — for node-scope share + edit
- `auth.Service.HasPermission(ctx, userID, "workspace.admin", workspaceID) (bool, error)` — for workspace-scope share + edit
- `sentinel.FromCtx(ctx)` — for the actor identity + subscription clamp on every read

No new permission code. We compose three existing surfaces.

### Handler — `/_site/saved-views`

```
GET    /_site/saved-views?kind={kind}&target={target}
       → list views visible to caller for the given kind+target
       → returns user-scope ∪ node-scope (for nodes user is member of) ∪ workspace-scope

POST   /_site/saved-views
       → create new view; body: { kind, target, name, scope, scope_id, body }
       → 201 with the created view; 400 on validation; 403 on permission

GET    /_site/saved-views/{view_id}
       → fetch one view; 404 if not visible (cross-tenant probes get same shape)

PATCH  /_site/saved-views/{view_id}
       → body-only update (Save Changes); { name?, body? }
       → 200 with updated view; 403 if not owner/admin; 404 if not visible

PATCH  /_site/saved-views/{view_id}/scope
       → scope change (promote/demote); { scope, scope_id }
       → 200 with updated view; 403 if no share permission to new scope; 404 if not visible

DELETE /_site/saved-views/{view_id}
       → soft-archive; 204; 403 if not owner/admin
```

Six endpoints, plus the kind discriminator on the list — same surface serves both `kind='objecttree'` and `kind='page_layout'`.

---

## 9. Valkey caching — opt-in, evidence-led

Not built day one. Reserved for when evidence justifies it.

The pattern is already in tree from the overnight sentinel cache work (`cache.Client` wrapper, namespaced keys, breaker-on-down, write-through invalidation). Adopting the same pattern for `saved_views` reads:

```
Key shape: savedviews:list:{sub_id}:{user_id}:{node_ids_hash}:{workspace_id}:{kind}:{target}
TTL: 60s
Invalidation: on any Create / UpdateBody / UpdateScope / Archive for the affected subscription,
              wipe the namespace prefix `savedviews:list:{sub_id}:*`.
```

The namespace-wide wipe pattern matches what sentinel does for grants (`topology:mygrants:{tenant}:*`). Reuse the same invalidation pattern, not bespoke logic.

**Decision trigger to enable:** `EXPLAIN ANALYZE` of the dominant list query exceeds 5ms at production seed scale, OR P95 latency on `/saved-views?kind=objecttree&target=/work-items` exceeds 50ms in observability dashboards.

---

## 10. Migration

Migration number TBD at apply time (per the `<migration>` skill — next available NNN against `vector_artefacts`).

Single migration shipping:

1. `CREATE TABLE saved_views` (per §6)
2. Four partial indexes (per §7)
3. Tenant-integrity trigger function `saved_views_check_tenant_integrity()` + BEFORE INSERT/UPDATE trigger
4. `updated_at` touch trigger (project convention)
5. `COMMENT ON` statements per HARD RULE on schema documentation

Down script reverses cleanly. Single transaction.

No seed data — every row is user-generated.

---

## 11. Frontend — reusable component family

This spec defines the substrate. The first consumer (`<ObjectTree>` saved-views dropdown + manage modal) is its own integration spec, written next, after this one is approved. What this section pins is the **reusable contract** — the substrate's frontend surface must be designed so that **any** future consumer (charts, custom-pages, dashboards) plugs in by mounting the component with the right props, never by extending the component itself.

### Layer separation

**Layer 1 — `useSavedViews` headless hook**

`app/components/SavedViews/useSavedViews.ts` — pure state machine + apiSite calls. Takes `(kind, target)`, returns the contract every consumer needs:

```ts
const {
  views,           // View[] — visible-to-me list for this (kind, target)
  activeView,      // View | null — loaded view, or null = transient state
  isDirty,         // boolean — current consumer state diverges from active view body
  loading, error,  // standard async state
  actions: {
    loadView,      // (id) → activate that view; consumer reads view.body and applies
    clearView,     // unload active view; consumer returns to transient state
    saveChanges,   // patch active view body with consumer's current state
    saveAsNew,     // (name, scope) → create new row; becomes active
    deleteView,    // (id) → archive
    renameView,    // (id, name)
    updateScope,   // (id, scope, scope_id) → promote/demote
  },
} = useSavedViews({ kind, target });
```

The hook is **schema-agnostic about body**. It loads bytes; the consumer interprets. The consumer is responsible for diffing its current state against `activeView.body` to compute `isDirty`, and for serialising its current state to JSON when `saveChanges` or `saveAsNew` is called. The hook treats body as opaque.

**Layer 2 — `<SavedViewsControl>` component family**

`app/components/SavedViews/` ships:

- `<SavedViewsDropdown>` — the header dropdown (matches Rally screenshot 5: search + list + Clear / Save As New / Manage)
- `<SaveAsNewViewModal>` — name + sharing scope picker (matches Rally screenshot 3/4)
- `<ManageSavedViewsModal>` — table, multi-select delete, inline rename, sharing change, search, pagination (matches Rally screenshot 1/2)
- `<SaveChangesIndicator>` — modified-state badge + button visible when `isDirty`

Each component takes its data from the hook (or accepts it via props for testability). The component family contains all the UI; the hook contains all the logic.

### The component contract — context-free

`<SavedViewsControl>` (the umbrella mount, internally composing dropdown + modals + indicator) takes ONLY these props:

```tsx
<SavedViewsControl
  kind={kind}           // string — what kind of view this consumer saves
  target={target}       // string — opaque internal ID (see §6 convention)
  isDirty={isDirty}     // boolean — computed by the consumer
  onLoad={(view) => …}  // consumer applies the loaded body
  onSerialise={() => …} // consumer returns current state as JSON for save
/>
```

The component **reads no globals related to identity**. No `useRouter`. No `window.location`. No route constants. No implicit page context. Everything that identifies *which views to load and save* arrives as props, period. This is the load-bearing rule that makes future consumers (custom-pages, dashboards) plug in without refactoring the component.

### Per-consumer adoption — 1-line wire-up

For each of today's six fixed OTV2 pages, adoption is one constant + one prop:

```tsx
// app/(user)/work-items/page.tsx
const SAVED_VIEW_TARGET = "objecttree:work_items";

<ObjectTree
  ...existingProps
  savedViews={{ kind: "objecttree", target: SAVED_VIEW_TARGET }}
/>
```

`<ObjectTree>` internally mounts `<SavedViewsControl>` in its header, wires the dropdown to its own state (columns, filters, sort, etc.), and the loop closes.

When custom pages land later, the layout engine generates `target` dynamically per component instance and passes it the same way — same component, same code path, zero refactor.

### What `<ColumnPicker>` becomes

The `<ColumnPicker>` shipped on `0b656858` becomes one of several controls whose state contributes to the active view. When the user changes column visibility / order / filters / sort / page size / group by, the consumer (the `<ObjectTree>` page) recomputes `isDirty` and the Save Changes button appears. Picker localStorage prefs still work for the transient state — they're orthogonal to saved views.

---

## 12. Out of scope (deferred)

Captured here so they're not lost, not built.

1. **URL-based view sharing** — Rally allows "copy URL, send, recipient loads that view." Vector defers — addressable surface (`samantha._viewport.<slot>._kind.name` per PLA-0005) is the eventual home for deep-link state, not a per-view URL parameter. File as follow-up.
2. **View versioning / history** — "show me what this view looked like last Tuesday." Useful, not load-bearing. Add `saved_views_history` (append-only) if a user requests it.
3. **Parent-child lineage** — "this team view was forked from my personal view." Discussed in brainstorm (Option D), rejected for v1 as premature. Add `saved_views_id_parent` column (nullable) later if needed; zero-downtime ALTER.
4. **Live-shared views (grant model)** — discussed as Option C, rejected as premature permission surface. Revisit if customer feedback demands it.
5. **`kind='page_layout'` actual implementation** — the table is shaped to accept it, but no page-layout consumer ships in the substrate PR. Lands as its own spec when a page needs it.
6. **Custom-field columns in views** — orthogonal feature. `TD-OBJECTTREE-PICKER-CUSTOM-FIELDS` already files the path. When that lands, custom-field keys (`field:<uuid>`) just appear in the `visible_columns` array of an `objecttree` view body — no schema change here.
7. **Custom Pages — multi-component user-authored compositions.** When Custom Pages land, they're a new consumer category where users compose multiple components (grids, charts, panels) onto a single page. The saved-views substrate supports this *additively*, no schema change required:
   - Each component instance inside a custom page mounts its own `<SavedViewsControl>` with `target='objecttree:custom:<page_uuid>:<instance_uuid>'` (or analogous `chart:`, `panel:` prefix per component type).
   - The custom page itself gets `kind='custom_page'` (new value, added via additive `ALTER TABLE saved_views ADD CONSTRAINT … CHECK (kind IN (…))`) with `target='custom_page:<page_uuid>'`. Its body describes which apps are registered on the page and their arrangement.
   - Page renames propagate automatically because `<page_uuid>` is stable — the user-visible name lives in the `custom_pages` table and is resolved at render time. **ANTI-PATTERN: do NOT denormalise the page name onto `saved_views`.** Same rule as §6.
   - Per-component views inside a custom page work with the same `<SavedViewsControl>` mount — the layout engine generates the `target` value at runtime and passes it as a prop. The component takes no other context. Same code path as today's fixed-page mounts.
   - Result: when Custom Pages ship, zero refactor of the substrate, zero refactor of the component family. Wire-up only.

---

## 13. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tenant integrity trigger fails to catch cross-subscription scope IDs because a deeply-nested topology graph admits the wrong node | Low | High (cross-tenant leak — SOC 2 blocker) | Trigger uses an explicit subscription join, NOT topology traversal. Belt-and-braces: handler-level sentinel clamp before service call. |
| Sole-writer drift — someone bypasses `savedviews.Service` and writes the table directly | Medium | High (permission bypass) | Add `lint:savedviews-writer-only` to the project lint suite, matching the existing `lint:writer-boundary` pattern. CI-blocking. |
| Body grows unbounded (user pastes a 10MB JSON into a future field) | Low | Medium (DB bloat, response weight) | CHECK constraint capping `octet_length(saved_views_body::text) <= 65536` (64KB). Generous for legitimate use, kills accidental bloat. |
| Cache invalidation misses on UpdateScope cross-namespace (promoting from user to workspace must wipe both keys) | Medium (when cache lands) | Medium (stale list for ~60s) | Service-layer invalidation explicit per scope; integration test verifies both old and new namespaces wipe. |
| Workspace admin deletes a view that's load-bearing for a team — no warning | Low | Low (view is recreatable) | Rally accepts this risk; Vector mirrors. Per §4 only admins can delete workspace views; the audit log captures who deleted what. |
| Scale beyond 100M rows arrives before partitioning lands | Low (years away at current adoption) | Medium (slower reads) | `ViewStore` interface + documented partitioning playbook in `doc.go` of the package + this spec. Pre-decision = fast execution when trigger fires. |
| Denormalisation of a mutable resource name onto `saved_views` row — e.g. someone adds a `target_label` column "to save a JOIN" | Medium (real instinct under perf pressure) | Medium (rename propagation breaks; views show stale names after the underlying resource is renamed) | The `target` column comment in §6 names this as an explicit ANTI-PATTERN. All names (workspace, topology node, custom page, user) are resolved at render time via JOIN against the source-of-truth table, never stored on `saved_views`. The opaque-ID convention is what makes this safe. Same rule that the project already follows for `id_user → users.name`, `id_node → topology_nodes.name`, etc. — bringing future Custom Pages under the same discipline. |
| Component contract drift — a future maintainer adds `useRouter()` or `window.location` into `<SavedViewsControl>` "for convenience" | Medium (the temptation is real under deadline) | High (custom pages and any dynamic-target consumer breaks — the whole future-proofing promise unwinds) | §11 names the rule as load-bearing. Acceptance criterion (§14) verifies it by code-review check: zero references to `useRouter`, `window.location`, route constants, or any source of identity other than props inside `app/components/SavedViews/**`. Wire as a lint check (`lint:savedviews-context-free`) once the file exists. |

---

## 14. Acceptance criteria

The substrate is complete when:

1. Migration applied to dev, `\d saved_views` shows the table per §6.
2. `savedviews.Service` exists with all six write/read methods, sole-writer-enforced.
3. Handler mounts at `/_site/saved-views`; all six endpoints respond.
4. Server-side permission rules verified by integration test:
   - Non-member tries to share to node → 403
   - Non-admin tries to share to workspace → 403
   - Cross-tenant view ID lookup → 404 (not 403, no existence leak)
   - Cross-subscription scope ID on Create → 400 with named field
5. Tenant-integrity trigger fires on a hand-crafted bad INSERT — verified via raw SQL test.
6. `lint:savedviews-writer-only` shipped with empty ledger; CI fails on any future raw write outside the service.
7. ViewStore interface + PostgresViewStore implementation; `main.go` wires `savedviews.NewService(NewPostgresViewStore(vaPool))`.
8. Doc updates: `docs/c_c_db_routing.md` adds the new table; `docs/c_schema.md` adds the catalogue entry; CLAUDE.md gains a one-line pointer.
9. SY003 regenerated (per HARD RULE — substrate changed).
10. `go test ./backend/internal/savedviews/...` green, `npx tsc --noEmit` green, `go build ./...` green.

---

## 15. Open questions for review

All structural decisions are pinned. These are the cosmetic / late-binding decisions that don't block writing the implementation plan:

1. **Endpoint path: `/_site/saved-views` or `/_site/views`?** Spec uses `/_site/saved-views` to match Rally's user-facing language. `/_site/views` is shorter. Either works.
2. **`maxColumns` cap from `<ColumnPicker>` — does the saved view body remember it, or is it a UI-only thing?** Spec assumes UI-only (the picker shows a cap of N built into the catalogue, but the saved view stores actual `visible_columns` — the cap is a per-tenant policy, not a per-view policy).
3. **Should `Save Changes` require an explicit click, or auto-save on dirty-and-blur?** Rally is click. Spec mirrors. Confirm.

---

End of spec.
