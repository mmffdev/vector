# ObjectTree Refactor Plan — Generic Hierarchical Tree Surface

**Status:** Draft for review — not yet a PLA, not yet committed-to.
**Authored:** 2026-05-20
**Origin:** Sprints/Releases need the same chrome as Work Items. Investigation found `<ObjectTree>` is 60–70% work-item-coupled despite a registry file ([p_ObjectTreeRegistry.tsx](../app/components/ObjectTree/p_ObjectTreeRegistry.tsx)) that documents the data-agnostic intent. The chrome can't be borrowed without forking the whole component. Resolution: realise the registry vision.

---

## North star

**One `<ObjectTree>` component, many data types.** All work-item, sprint, release, milestone, topology, custom-artefact, and future "list-like hierarchical thing" surfaces consume the same primitive. Props (or a registered config) define:

- **What rows look like** (column defs, row stripe, badges, pills)
- **Where rows come from** (read endpoint, sort/filter/page model)
- **What you can do to a row** (patch, archive, duplicate, reparent, scope-propagate)
- **What the row detail flyout is** (per-domain editor, not hardcoded to ArtefactInlineForm)
- **What chrome elements show** (title, sunken header, action bar slots, filter chips)

Touching the visual or behavioural surface = one file edited, every consumer benefits. This is what the registry file ([p_ObjectTreeRegistry.tsx:1-11](../app/components/ObjectTree/p_ObjectTreeRegistry.tsx#L1-L11)) was meant to deliver but didn't.

---

## UX consistency contract (★ non-negotiable)

Every grid built on `<ObjectTree>` honours the same interaction pattern so the user learns it once and uses it everywhere. The pattern is fixed by the shell — domains cannot opt out, only fill in the body.

| Interaction | Behaviour | Fixed where |
|---|---|---|
| Click the ID cell (first column, monospace) | Opens the row-detail flyout inline beneath the row | `<ObjectTree>` shell |
| Click the same ID again | Closes the flyout (toggle) | `<ObjectTree>` shell |
| Click a different ID | Closes current, opens new (same mount, animated height) | `<ObjectTree>` shell |
| Press Enter on focused ID | Same as click | `<ObjectTree>` shell |
| Press Esc | Closes the flyout | `<ObjectTree>` shell |
| Click outside the flyout/row | Closes the flyout | `<ObjectTree>` shell |
| Flyout position | Inline, pushes subsequent rows down, full-width | `<ObjectTree>` shell |
| Flyout count | Exactly one open at a time per grid | `<ObjectTree>` shell |
| Flyout body | Domain-supplied component (form, detail panel, custom UI) | Domain config |
| Loading shimmer while detail fetches | Identical skeleton across all grids | `<ObjectTree>` shell |
| Row click anywhere ELSE | Selects the row (does not open flyout) | `<ObjectTree>` shell |

**The rule:** the ID is the affordance, the flyout is the result, the experience is identical. Once a user knows "click an ID, get a form below it" on Work Items, they know it on Sprints, Releases, Milestones, Custom Artefacts, and anything else we build on this primitive. They don't have to relearn per surface.

**Anti-patterns we are explicitly NOT supporting:**
- Modals overlaying the grid — break the spatial continuity that makes the ID→form link feel natural.
- Side-drawers — wrong shape for the data; force the user to look elsewhere from where they clicked.
- Hover-cards — too easy to trigger accidentally; bad for content with forms inside.
- Multiple flyouts open simultaneously — cognitive load explosion.
- Full-row click triggers open — kills scroll/scan; accidental opens during selection.

The cost of consistency is that the ID cell becomes a load-bearing affordance — it MUST look clickable (it does already on Work Items, with the underline/button styling shown in your screenshot). That styling is mandatory for every column flagged as `isPrimaryId: true` in the config.

---

## What's wrong today (the audit)

The current [p_ObjectTree.tsx](../app/components/ObjectTree/p_ObjectTree.tsx) (1044 lines) couples the supposedly-generic shell to work-item internals at every layer:

| Coupling site | Lines | Problem |
|---|---|---|
| `import { workItems, portfolioItems } from "@/app/lib/apiSite"` | [:9](../app/components/ObjectTree/p_ObjectTree.tsx#L9) | API bundle hardcoded; can't swap to `/timeboxes/sprints` |
| `import ArtefactInlineForm` | [:11](../app/components/ObjectTree/p_ObjectTree.tsx#L11) | Detail flyout is fixed; sprints need a different one |
| `import { PARENT_PREFIX_MAP, type ArtefactDetail }` | [:12](../app/components/ObjectTree/p_ObjectTree.tsx#L12) | Reparent rule reads artefact `type_prefix` |
| `useWorkItemFlowStates`, `useFlowStatesByType`, `useArtefactTypeColours` | [:16-21](../app/components/ObjectTree/p_ObjectTree.tsx#L16-L21) | Flow-state machinery sprints don't have |
| `useArtefactItemsWindow` | [:20](../app/components/ObjectTree/p_ObjectTree.tsx#L20) | Pagination/fetch hook is artefact-shaped |
| `useWorkItemsFilters`, `useWorkItemsSort` | [:22-25](../app/components/ObjectTree/p_ObjectTree.tsx#L22-L25) | Filter/sort state is artefact-shaped |
| `useChipTypeOptions("work")` | [:144](../app/components/ObjectTree/p_ObjectTree.tsx#L144) | "Create New" dropdown is artefact-type catalogue |
| `duplicateArtefact` PATCHes artefact columns | [:279-352](../app/components/ObjectTree/p_ObjectTree.tsx#L279-L352) | `description_doc`, `colour`, `blocked_reason`, `milestone_id`, `release_id`, `priority_id`, `topology_node_id` |
| `mode: "work_items" \| "portfolio_items"` | [:82,93](../app/components/ObjectTree/p_ObjectTree.tsx#L82) | Closed type union; can't add `"sprints"` without surgery |

The component does the right tree work (lazy expand, cascade refresh, drag-reparent, multi-select, inline editing) — but every per-row decision routes through a work-item-specific helper. Sprints need: tree-mode for nested timeboxes under a parent, NO flow-state pills, NO type badges, a date-range column, a "propagate to children" toggle, a different create modal.

### What's NOT broken
- `<ResourceTree>` ([app/components/ResourceTree.tsx](../app/components/ResourceTree.tsx), 1954 lines) is genuinely generic. Five well-defined prop sets. Already consumed directly by `artefact-types/page.tsx` and `permissions/page.tsx`. **No refactor needed here.**
- The chrome CSS classes (`tree_accordion-dense__panel-head*`, `__actionbar`, `__filterbar-*`) are stable.

### Where the registry hints at the right shape
The aspirational `ObjectTreeConfig<T>` in [p_ObjectTreeRegistry.tsx:20-74](../app/components/ObjectTree/p_ObjectTreeRegistry.tsx#L20-L74) names the right slots: dataType, label, columns, dnd, sort, selection, hierarchy, search, pagination, filterChips. The example configs at lines 105–169 show how `work_items` and `strategy_items` would each provide their own. **The plan is essentially: replace the inside of `p_ObjectTree.tsx` with code that ACTUALLY consumes this config.**

---

## The global heartbeat angle (sprints/releases later)

You flagged: a sprint created on Insurance should be able to propagate to every child node, syncing organisational cadence. This is **first-class to the refactor**, not bolt-on, because it shapes:

1. **Data model.** Each timebox row needs a `scope_propagation` enum: `"this_node_only"` (default), `"this_node_and_descendants"`, or future `"global_in_subscription"`. The read side has to UNION (rows pinned to this node) with (rows pinned to any ancestor whose `scope_propagation = this_node_and_descendants`). Same ancestor-walk pattern the topology grants use ([backend/internal/topology/sql.go:26-49](../backend/internal/topology/sql.go#L26-L49)), but for timeboxes.

2. **Read endpoint.** `/timeboxes/sprints?org_node_id=X` needs to return:
   - Rows directly pinned to X (own cadence)
   - Rows pinned to any ancestor of X with propagation = descendants (inherited heartbeat)
   - Each row tagged `origin: "local" | "inherited_from:<node_id>"` so the UI can render inherited rows with a "inherited from Insurance" badge and disable edit on them.

3. **Write semantics.** Creating a sprint at Insurance with `scope_propagation = descendants` doesn't fan out to N rows; it stays as ONE row at Insurance. Children read it via the ancestor-walk. This keeps the cadence atomic — edit once, every child sees the change immediately. Deleting/closing the parent sprint closes it for every inheritor in the same tick.

4. **UI prop.** `<ObjectTree>` needs to know how to render the `origin` badge and disable inline edits on inherited rows. That's `columns[].render` for the badge, and a generic `isRowReadOnly?: (row: T) => boolean` prop on ResourceTree (NEW — small addition). Inherited rows still appear in the list, just with a distinct visual treatment.

5. **Migration.** Adds two columns to `timeboxes_sprints` + `timeboxes_releases`: `scope_propagation TEXT NOT NULL DEFAULT 'this_node_only'` and a CHECK constraint on the enum values. Backfill: every existing row → `'this_node_only'`. Zero behavioural change on apply.

This isn't extra work bolted on later — designing the read endpoint, column model, and `isRowReadOnly` slot for inheritance **now** is what keeps us from a second refactor in 3 months when you want to ship the heartbeat feature.

---

## Target architecture

### Three layers, clean separation

```
┌──────────────────────────────────────────────────────────────┐
│ Page (e.g. /sprints, /work-items, /releases)                │
│   <ObjectTree dataType="sprints" workspaceId={…} … />       │
└──────────────────────────────────────────────────────────────┘
                              │ (looks up config from registry)
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ <ObjectTree> — generic shell                                 │
│   • Renders chrome (title / sunken head / action bar)        │
│   • Hosts the detail flyout via config.DetailFlyout slot     │
│   • Threads config-supplied hooks into <ResourceTree>        │
│   • NO work-item imports, NO sprint imports, no domain code  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ <ResourceTree> — already-generic tree primitive              │
│   (untouched except for one new prop: isRowReadOnly)         │
└──────────────────────────────────────────────────────────────┘

Configs live in:
  app/components/ObjectTree/configs/work-items.tsx     ← extracted from current monolith
  app/components/ObjectTree/configs/portfolio-items.tsx ← extracted
  app/components/ObjectTree/configs/sprints.tsx        ← NEW
  app/components/ObjectTree/configs/releases.tsx       ← NEW
  app/components/ObjectTree/configs/milestones.tsx     ← NEW (drops the bespoke MilestoneManager)

Each config exports:
  export const config: ObjectTreeConfig<RowType> = { … }
  registered in registry at module load.
```

### Expanded `ObjectTreeConfig<T>` (full prop catalogue)

```ts
interface ObjectTreeConfig<T> {
  // ── Identity ──
  dataType: string;              // "work_items" | "sprints" | "releases" | …
  label: string;                 // "Work items" | "Sprints" | …
  ariaLabel: string;             // a11y label for the table
  treeName: string;              // namespacing for URL + localStorage prefs
  addressableName: string;       // samantha.<page>._tree.<this> registry name

  // ── Chrome (the three-row header you screenshotted) ──
  chrome: {
    title: string;               // panel title
    subtitleBadge?: ReactNode;   // "05" badge in screenshot
    subtitle?: ReactNode;        // "Dense grid"
    description?: ReactNode;     // "Spreadsheet-fast. 28px rows…"
    // Action bar — fully data-driven. No hardcoded "Create New" button.
    createAction?: {
      mode: "single" | "type-picker";
      // single = one button → opens create flyout
      // type-picker = dropdown of types → opens create flyout for picked type
      label: string;
      getTypeOptions?: () => Array<{ value: string; label: string }>;
    };
    // Extra slot for kind-specific bulk-actions (e.g. "Start all planned sprints")
    extraActions?: ReactNode;
  };

  // ── Data I/O ──
  data: {
    // Generic windowed-fetch contract. Each domain provides its own implementation.
    useWindow: (opts: WindowOpts) => WindowResult<T>;
    // CRUD operations. ObjectTree calls these; domain decides routing.
    patch: (id: string, body: Partial<T>) => Promise<T>;
    create?: (body: Partial<T>) => Promise<T>;
    archive?: (id: string) => Promise<void>;
    duplicate?: (id: string) => Promise<T>;
  };

  // ── Row shape ──
  row: {
    getId: (row: T) => string;
    getParentId: (row: T) => string | null;       // null for flat lists
    getChildrenCount: (row: T) => number;         // 0 for flat lists
    getStripeColour?: (row: T) => string | null;  // 10px left rail
    getRowClass?: (row: T) => string | undefined;
    isReadOnly?: (row: T) => boolean;             // ★ inherited timeboxes
    searchAccessor: (row: T) => string;
  };

  // ── Columns ──
  columns: ColumnDef<T>[];

  // ── Sort / filter / page ──
  sort: { defaultKey: string | null; defaultDir: "asc" | "desc"; };
  filterChips?: ReactNode;
  pagination: { options: number[]; defaultPageSize: number; };

  // ── Drag and drop (optional, per data type) ──
  dnd?: {
    enabled: boolean;
    resourceType: string;
    canReparent?: (mover: T, target: T) => boolean;
    onReparent?: (moverID: string, targetID: string, intent: "onto"|"above"|"below") => Promise<void>;
  };

  // ── Row-detail flyout (THE big change — was hardcoded to ArtefactInlineForm) ──
  //
  // Every grid renders a row-detail flyout. The trigger, position, open/close
  // behaviour, and keyboard handling are FIXED by <ObjectTree> so the UX is
  // identical across every consumer (work-items, sprints, releases, milestones,
  // future surfaces). Only the BODY content differs per domain.
  //
  // Trigger contract:
  //   - User clicks the row's ID cell (always the first column, monospace,
  //     visually a button-affordance). NOT the whole row — clicking elsewhere
  //     in the row selects but does not open. This stops accidental opens
  //     during scroll/scan and keeps the explicit-affordance pattern.
  //   - Keyboard: Enter on a focused ID cell opens. Esc closes.
  //   - Re-clicking the same ID closes the flyout (toggle).
  //   - Clicking a different ID swaps to the new row (no flicker — same mount,
  //     new content). Animated height transition on body swap.
  //
  // Position contract:
  //   - Flyout renders INLINE, expanded immediately beneath the clicked row,
  //     pushing subsequent rows down. NOT a modal, NOT a side-drawer, NOT a
  //     hover-card. The clicked row stays visible above the flyout as anchor.
  //   - Only ONE flyout open at a time. Opening on row B closes row A's first.
  //   - Flyout width matches the table width (full-bleed). Internal layout is
  //     domain-owned (the Component's job).
  //
  // Close contract:
  //   - Esc key (when flyout has focus).
  //   - Click outside the flyout AND outside the row.
  //   - Programmatic close after destructive actions (Delete) or navigation.
  //
  // The shared shell <ObjectTreeDetailFlyout> handles all of the above. The
  // domain's `Component` only renders the inner content. This means every
  // consumer gets identical interaction without re-implementing.
  detailFlyout?: {
    Component: React.ComponentType<DetailFlyoutProps<T>>;
    // Optional async hydration — if the row in the window doesn't carry every
    // field the form needs (likely, given the lazy column-fetch above), the
    // shell calls this on open with the row id and passes the result to the
    // Component. Shows a loading skeleton inside the flyout while pending.
    getRowDetail?: (id: string) => Promise<unknown>;
  };

  // ── Selection ──
  selection?: { mode: "multi" | "none"; };

  // ── Columns: catalogue + selector (★ lazy add-column feature) ──
  // The `columns` array above is the DEFAULT visible set on first load.
  // `columnCatalogue` is the FULL set the user can add via the column-
  // picker dropdown. Hidden columns are NOT fetched from the backend
  // until the user adds them — at which point the hook re-fetches the
  // current window with the expanded `fields` set, and ObjectTree
  // back-fills every visible row's new column without a full reload.
  //
  // The wire shape is row-as-bag: a row is `{ id, ...selectedFields }`,
  // never the full ORM object. This keeps payloads small (a 100-row
  // window with 5 columns ≈ 8 KB; with all 24 columns ≈ 60 KB) and
  // makes the "add column" feature feel instant — only the delta
  // (the new column) comes down the wire on add.
  columnCatalogue?: {
    // Every column the user could possibly add. ColumnDef as before,
    // plus a `wireKey` that identifies the field name in the backend
    // payload + the field name passed in the `fields` query param.
    columns: (ColumnDef<T> & {
      wireKey: string;                 // e.g. "description", "owner.display_name"
      group?: string;                  // optional grouping in the picker: "Dates", "People", "Custom fields"
      addable: boolean;                // false = always-on (id, title); true = user-toggleable
      defaultVisible: boolean;         // initial visibility on first ever load
    })[];

    // localStorage key for persisting the user's visible-column set
    // per-tree. Namespaced by `treeName` so /sprints and /work-items
    // don't share state.
    prefsKey: string;

    // OPTIONAL: per-user server-side persistence so visibility survives
    // device switches. Falls back to localStorage when omitted.
    serverPrefs?: {
      get: () => Promise<string[]>;        // returns array of wireKeys
      set: (wireKeys: string[]) => Promise<void>;
    };
  };

  // ── Scope propagation (★ the heartbeat feature) ──
  scopePropagation?: {
    enabled: boolean;             // sprints/releases: true; work-items: false
    // If enabled, ObjectTree renders an "inherited from <node>" badge on
    // rows where row.origin !== "local", and disables inline editing.
    getOrigin: (row: T) => { kind: "local" } | { kind: "inherited"; fromNodeId: string; fromNodeName: string };
    // The create-flyout gets a propagation picker
    // ("This node only" | "This node + all descendants").
  };
}
```

---

## Performance approach — patterns we adopt, patterns we defer

This is the cockpit of the platform. "Works correctly" is the floor; "feels instant" is the bar. The budget table below is the actual acceptance contract — pattern choices are how we hit it, not the point in themselves.

### Performance budgets (enforced via `performance.mark()` + CI perf assertions)

P95 on dev hardware, no network/CPU throttle, default Work Items page with 25 rows visible + 1 expanded sub-tree:

| Action | Budget | Why this number |
|---|---|---|
| Initial render after data ready → first paint | < 100ms | Above this feels janky on click-through |
| Sort or filter chip change → visual update (optimistic) | < 50ms | Sort feels instant or feels broken |
| Sort or filter chip change → server-confirmed data | < 300ms | Above this users second-guess the action |
| Click ID → flyout shell opens | < 50ms | Shell must beat the eye |
| Click ID → flyout detail hydrated | < 250ms | Hydration is forgivable if shell is instant |
| Add column → backfill complete on visible rows | < 350ms | Below the "did it work?" doubt threshold |
| Drag-reparent → optimistic move | < 16ms (one frame) | Drag must feel solid; any jank = "app's broken" |
| Drag-reparent → server-confirmed + cascade settled | < 800ms | Above this row visibly settles late |
| Page-flip (page 1 → page 2) | < 200ms | Same rule as sort |
| Scope-clamp change (Insurance → Banking) | < 400ms | Compound action, allow more |
| Memory ceiling — all sub-trees expanded, all columns added | < 50MB heap for grid + cache | Above this we compete with the browser |

If a slice's PR regresses any of these, it doesn't merge. Numbers are starting points; tune after Slice 0.5 baseline.

### Patterns IN SCOPE for this refactor

Adopted because they're cheap relative to the win and known to be needed at our data volumes:

1. **Cell-level memoisation.** Every cell renderer is `React.memo` with a custom `arePropsEqual` checking only the values that cell reads. Parent state changes that don't affect a cell don't re-render that cell. Boring discipline; biggest single perf win.
2. **Flat row store as source of truth.** `Map<rowId, Row>`. Visible tree is derived. Patches hit one Map entry → only subscribed components re-render. Replaces today's `roots: T[]` + `childMap: Map<parentId, T[]>` dual-structure walk-everything model. Lands in Slice 1.
3. **Optimistic UI for every user action.** Inline edits, drag-reparent, status pill clicks all paint immediately and reconcile in the background. Already present today for some actions — preserve and extend, don't lose during refactor.
4. **Lazy field hydration via `?fields=`.** Narrow default columns; expand on demand. Slices 2.5 + 4.5.
5. **Request coalescing and debouncing.** Rapid actions (two columns added in 200ms, three filter toggles, sort then sort again) collapse to ONE outgoing request via 150ms debounce window. Per-hook concern in Slice 1.
6. **Server pagination, server sort, server filter.** Already true; preserve. No client-side "load everything and filter."
7. **Cascade-scope reduction.** When the backend's cascade-PATCH response says "I touched these IDs," frontend re-fetches only those rows, not every expanded sub-tree. Slice 4.6.

### Patterns CONTINGENCY — gated on profiling

Spec'd here so they're not "novel ideas" later — they're pre-considered fallbacks we reach for if budgets are missed:

1. **Row virtualisation via `react-window`.** Trigger condition: P95 initial render > 100ms at 100 rows + 10 expanded sub-trees (~500 DOM rows). Drops in around the existing `<tbody>` with manageable disruption — but breaks sticky headers, complicates keyboard nav and drag-and-drop. NOT shipped speculatively; ship only if measured.
2. **Hover-prefetch on Epic rows.** When user hovers an unexpanded parent for >200ms, prefetch its children so the click-expand is zero-latency. Easy add, polish item, ship if click-expand feels slow.
3. **Connection-aware fallback.** On slow connections (`navigator.connection.effectiveType === "slow-2g"`), reduce default page size + disable hover-prefetch.

### Patterns OUT OF SCOPE — named so we don't reinvent

1. **Column virtualisation.** Our column counts (default 8, max ~20 with all picker columns added) don't justify the implementation cost.
2. **Web Workers for sort/filter.** No CPU-bound op in scope justifies the architecture cost. Revisit if pivot tables or computed columns ship.
3. **Local-first + IndexedDB mirror.** Linear-style local store gives the best UX in the space, but is a 6-month standalone project. Out of scope for this refactor. Worth a separate PLA later if we want Linear-tier feel.
4. **WebSocket-driven cell re-render.** We already have push channels for rank/cascade events. Extending those to drive cell-level reactivity is a follow-up, not part of this refactor.

### How this changes the slice list

- **NEW Slice 0.5 — Perf baseline.** Instrument current Work Items page with `performance.mark()` around every named action above. Capture P95s. Treat the budget table as starting numbers; adjust based on what we measure. ~half a day.
- **Slice 1 absorbs the flat-row-store decision.** It's the right slice for it — smaller change inside one hook than as a cross-cutting refactor later.
- **NEW Slice 4.6 — Memoisation pass + cascade-scope reduction.** Audit every cell renderer for `React.memo` coverage. Add request coalescing in the data hook. Backend cascade PATCH responses gain a `touched_ids: string[]` field; frontend re-fetches only those. ~1 day.
- **Every subsequent slice's acceptance gains one line:** "does not regress the perf baseline." Same regression net as Slice 0's contract tests.

---

## The work, broken into shippable slices

Each slice is independently mergeable and leaves the app green. No "12 PRs, all needed before anything works." Slices ship in this order:

### Slice 0 — Boundary tests (1 day)
**Touches:** frontend tests only · **Backend:** none · **main.go:** no
**Goal:** Pin the current Work Items behaviour with a test contract BEFORE refactoring.

- Snapshot the rendered chrome for `/work-items` (title, sunken head, action bar) — Playwright or RTL.
- Behaviour tests: click row → flyout opens; create flow; duplicate; delete; drag-reparent within Epic; cascade refresh after status change.
- Tests live in `app/components/ObjectTree/__tests__/contract.work-items.test.tsx`.

**Acceptance:** Tests pass against current code. They'll be the regression net for every subsequent slice.

**Risk:** Low. Pure-add. No production change.

### Slice 0.5 — Perf baseline (~0.5 day) ★ NEW
**Touches:** frontend instrumentation only · **Backend:** none · **main.go:** no
**Goal:** Know the starting line before changing anything. Numbers in the budget table above become measurable, not hypothetical.

- Instrument current `/work-items` with `performance.mark()` + `measure()` around every named action in the budget table.
- Record P95s over 50 runs of each action on dev hardware (chromium, no throttle).
- Write the actual measured numbers next to each budget in the table. If a budget is ALREADY missed today, flag it — fixing or accepting it becomes a Slice 4.6 task.
- Output: a small `dev/perf/objecttree-baseline.json` snapshot + a one-screen `/dev/perf` page that re-runs measurements on demand.

**Acceptance:** Baseline numbers captured; any pre-existing budget misses called out explicitly so we don't blame the refactor for them later.

**Risk:** None. Read-only instrumentation.

### Slice 1 — Carve out `useArtefactItemsWindow` → `useObjectTreeWindow<T>` + flat row store (2 days)
**Touches:** `app/components/ObjectTreeV2/hooks/` (new), `work-items-tree-config.tsx` · **Backend:** none · **main.go:** no
**Goal:** Generic data-fetch hook that domains plug into. Today's hook is artefact-only and hardcoded to `/work-items` | `/portfolio-items`.

- Create `app/components/ObjectTree/hooks/useObjectTreeWindow.ts` — generic over `<T>`, takes `{ endpoint, sortKey, sortDir, filters, pageSize, pageIndex, onPatched, onLocalPatch, onCascadeRefresh }`.
- Move artefact-specific logic (filter shape, sort key union) INTO the work-items config; the hook itself only knows about pagination + the wire shape `{ items: T[]; total: number }`.
- Refactor work-items-tree-config to call the new hook with its own filter/sort types.

**Acceptance:** Slice 0 tests still pass. `useArtefactItemsWindow` becomes a thin wrapper over `useObjectTreeWindow` for back-compat (deletable next slice).

**Risk:** Medium. Touches the hot path. Boundary tests catch regressions.

### Slice 1.5 — Plugin architecture, registry, capability flags, context registry (1.5 days) ★ NEW
**Touches:** `app/components/ObjectTreeV2/{ObjectTree,registry,context,loader,kinds/,plugins/,cells/,flyouts/}.{ts,tsx}` · **Backend:** none · **main.go:** no
**Goal:** Lock in the JSON-driven architecture so every subsequent slice plugs into a stable pattern. The shell becomes a kind-walker; everything else is a registered handler the JSON references by name.

**Directory + module structure:**
```
app/components/ObjectTree/
├── ObjectTree.tsx              ← shell: ~200 lines, walks layout, mounts kinds
├── registry.ts                 ← single name → handler/component/hook map
├── loader.ts                   ← resolves JSON refs against registry at mount
├── context.ts                  ← context registry: name → hook accessor
│
├── kinds/                      ← one renderer per layout `kind`
├── plugins/                    ← heavy capabilities, dynamic-imported
├── flyouts/                    ← re-export from existing locations
└── cells/                      ← cell renderers registered by name
```

**Three registries, one file:**
- `componentRegistry` — flyouts, cell renderers, chrome components. Lazy-imported.
- `pluginRegistry` — drag engine, cascade engine, scope-propagation overlay. Lazy-imported gated on capability flags.
- `contextRegistry` — maps JSON strings like `"auth.user.subscription_id"` and `"scope.activeNodeId"` to hook accessors. NOT lazy; resolved at shell mount.

**Capability flags drive both load AND render:**
- The shell reads `capabilities` from JSON and dynamic-imports only the plugins the JSON enables.
- Sprints' bundle does NOT contain DragEngine, CascadeEngine, ArtefactInlineForm — those live in plugin/flyout modules the sprints JSON never references.
- Work-items' bundle DOES, because its JSON references them.
- Bundle-size CI check: per-grid bundle stays under a per-grid budget (work-items ~150kB, sprints ~80kB target — actual numbers from Slice 0.5 baseline).

**Context registry — the third dimension of the JSON contract.** Every grid runs against three pieces of runtime state: who's logged in, which workspace, what topology scope they've clamped to. The JSON declares which it needs; the shell resolves each name against a small accessor hook.

```ts
// context.ts
export const contextRegistry = {
  "auth.user.id":              () => useAuth().user?.id ?? null,
  "auth.user.subscription_id": () => useAuth().user?.subscription_id ?? null,
  "auth.user.role":            () => useAuth().user?.role ?? null,
  "scope.activeNodeId":        () => useScope().activeNodeId,
  "scope.direction":           () => useScope().direction,
  // Future: feature flags, theme, tenant prefs — added here, referenced by JSON.
};
```

The shell's resolution loop:
```ts
function useResolveContext(contextDecl: ContextDecl) {
  const values: Record<string, unknown> = {};
  for (const [key, decl] of Object.entries(contextDecl)) {
    if (key === "remountOnChange") continue;
    const accessor = contextRegistry[decl.from];
    const value = accessor() ?? decl.default ?? null;
    if (value == null && decl.required) return { isReady: false, missing: key };
    values[key] = value;
  }
  return { isReady: true, values };
}
```

The data hook receives `context.values` as a flat object. It uses `context.workspaceId`, `context.scopeNodeId` directly. No in-hook `useAuth()` / `useScope()` calls. Pure-prop data hook = easier to test, memoise, reason about.

**`passToFetchAs` / `passToFetchOn` rules in the context block are honoured by the shell.** Today's "?meg= forwards on GET but not POST" (buried in apiSite.withForwardedMeg) becomes declarative — the JSON says when each context value is appended to which methods, and the shell builds the request accordingly.

**`remountOnChange` is the JSON form of the `key={activeNodeId ?? "root"}` trick.** The shell wraps its render in a `<Fragment key={…}>` whose key is composed from the named context values; when those change, React unmounts + remounts the whole grid (clean state, fresh fetch).

**Deliverables:**
- `registry.ts` populated with current work-items components/plugins/cells.
- `context.ts` with the three context accessors (user, workspace, scope).
- `loader.ts` that takes raw JSON + registries and produces a resolved config.
- `ObjectTree.tsx` rewritten as the kind-walker shell (~200 lines).
- One end-to-end test: load `p_wizard_workitems_v2.json`, mount the shell, verify the page renders identically to today (uses Slice 0 contract tests as the verification surface).

**Acceptance:** Slice 0 contract tests pass against the new JSON-driven shell. The shell file contains zero domain imports — only registry + kinds. Bundle-size for /work-items unchanged or smaller.

**Risk:** Medium-high. This is the architectural pivot. All subsequent slices ride on it. Slice 0 contract tests are non-negotiable.

### Slice 2 — Extract `<ObjectTreeDetailFlyout>` shell + pin the interaction contract (1.5 days)
**Touches:** `app/components/ObjectTreeV2/flyouts/`, `ArtefactInlineForm/*` (props refactor only, no logic change) · **Backend:** none · **main.go:** no
**Goal:** `ArtefactInlineForm` stops being imported by `<ObjectTree>`. The interaction contract from the UX section above becomes a shared shell that EVERY consumer inherits identically.

- New component `<ObjectTreeDetailFlyout>` owns: trigger detection (ID-cell click + Enter), open/close state, single-open enforcement, Esc + outside-click handlers, the inline-expand animation, the loading skeleton during `getRowDetail` hydration.
- New prop on `<ObjectTree>`: `detailFlyout?: { Component, getRowDetail }`. Body content only.
- Work-items page passes `{ Component: ArtefactInlineForm, getRowDetail: (id) => workItems.get(id) }`.
- Duplicate/Delete/Archive callbacks move into the flyout's domain wiring (already partly there).
- New `isPrimaryId: true` flag on `ColumnDef<T>` — that column gets the button-affordance styling AND is the click target the shell listens for. Exactly one column per grid carries this.

**Pin the contract with tests** (these become regression net for every future consumer):
- Click ID → flyout opens beneath that row, pushes others down.
- Click same ID → flyout closes.
- Click different ID → swap (one mount, no flicker).
- Esc → close.
- Outside click → close.
- Click row body (not ID) → row selects, flyout does not open.
- Enter on focused ID → opens.
- Open while another grid on the same page is open → unaffected (per-tree, not global).

**Acceptance:** Slice 0 tests still pass. New contract tests pass. `<ObjectTree>` no longer imports `ArtefactInlineForm`. Work-items page imports it explicitly. The behaviour from your screenshot — click `EP-11884` → form pops out below — works identically.

**Risk:** Medium-high. The flyout has cascade-refresh, child-patch back-channels, drag-handle refs threaded through. Each side-channel needs to thread through the slot cleanly. The interaction-contract tests are the safety net.

### Slice 2.5 — Backend `?fields=` contract (1.5 days) ★ NEW
**Touches:** `backend/internal/{artefactitems,portfolioitems,timeboxsprints,timeboxreleases}/handler.go` + new `columns.go` per package · **Backend:** YES — handler edits + new catalogue files · **main.go:** likely NO (handlers already mounted; only new if we add `GET /<resource>/columns` route — TBD) · **Migration:** none
**Goal:** Every list endpoint accepts a `?fields=a,b,c` parameter and returns only those columns (plus `id`, always). This is the substrate the column-selector rides on.

**Why first:** The column-selector UI (Slice 4.5) is dead without it. Adding `?fields=` to one endpoint as a proof, then propagating, lets us land the contract before any frontend depends on it.

- Convention: every list handler reads `r.URL.Query()["fields"]`, validates each name against a per-resource allow-list (catalogue), and projects only those columns in the SELECT. Unknown field names → 400 with the offending name.
- Default behaviour: when `?fields=` is absent, return the current default set (back-compat). When present, return `{id, ...requested}`.
- Catalogue lives next to the handler: `backend/internal/<resource>/columns.go` exports `var ColumnCatalogue = map[string]ColumnSpec{...}` (wire name → SQL column + maybe a join hint).
- Implement on **one** resource first (`/timeboxes/sprints`) as the reference impl. Other resources adopt in their own slice (work-items in 4.5, releases trivially after that).
- Tests: `?fields=id,name` returns exactly those; `?fields=bogus` returns 400; absent `?fields=` returns default set unchanged.

**Acceptance:** `curl /_site/timeboxes/sprints?workspace_id=…&fields=id,timeboxes_sprints_name,timeboxes_sprints_status` returns a 3-key payload per row. Default GET unchanged.

**Risk:** Low-medium. New convention but bounded scope (one resource first). Cookbook entry mandatory.

### Slice 3 — Extract chrome to a registered config (1 day)
**Touches:** `app/components/ObjectTreeV2/kinds/{ActionBar,DenseGridHeader,Panel}.tsx`, work-items config JSON · **Backend:** none · **main.go:** no
**Goal:** Action bar's "Create New" / type-picker / search / filter-chip slots stop hardcoding work-item concerns.

- `config.chrome.createAction` drives the action bar shape.
- `config.chrome.subtitleBadge / subtitle / description` drives the sunken header.
- `<ObjectTree>` reads only from config; no `useChipTypeOptions("work")` import.
- Work-items config supplies its own `chrome` block; portfolio-items same.

**Acceptance:** Slice 0 tests pass. `<ObjectTree>` JSX has no work-item-specific strings.

**Risk:** Low. Mostly mechanical.

### Slice 4 — Extract drag/reparent rules into config (1.5 days)
**Touches:** `app/components/ObjectTreeV2/plugins/DragEngine.tsx`, work-items config (declares its `PARENT_PREFIX_MAP` rule) · **Backend:** none · **main.go:** no
**Goal:** `PARENT_PREFIX_MAP` and the reparent legality check stop being hardcoded.

- `config.dnd.canReparent: (mover, target) => boolean` — domain provides the rule.
- Work-items config implements the existing `PARENT_PREFIX_MAP` rule.
- `<ObjectTree>` is data-type-agnostic; the candidate pre-pass walks visible rows and calls `config.dnd.canReparent` on each.

**Acceptance:** Slice 0 tests still pass. Drag-reparent works identically on Work Items. `<ObjectTree>` has no import from `app/components/ArtefactInlineForm/types`.

**Risk:** Low. Single-method swap.

### Slice 4.5 — Column selector + lazy back-fill (2.5 days) ★ NEW
**Touches:** `app/components/ObjectTreeV2/plugins/ColumnPicker.tsx` + cache-merge logic in `useObjectTreeWindow` · **Backend:** none (rides on 2.5's `?fields=` contract) · **main.go:** no
**Goal:** A built-in column-picker on every `<ObjectTree>`. User adds "Description" → tree re-fetches the current window with `?fields=…,description`, back-fills the new column on every visible row WITHOUT a full reload. Remove a column → frontend just stops rendering it (no refetch needed; we don't trim previously-fetched data, that'd thrash).

**Where it lives:** In `<ObjectTree>` itself, gated by presence of `config.columnCatalogue`. No domain needs to implement it — they only declare which columns exist.

**Behaviour spec:**

1. **First load.** Read visible column set from `localStorage[prefsKey]` (or `serverPrefs.get()` if configured). Fall back to `defaultVisible: true` columns. Fetch window with `?fields=` listing the resolved set.

2. **Column-picker button** lives in the chrome's action bar (top-right of the table, sibling to Search). Click → dropdown grouped by `column.group`. Each row: checkbox + label + optional description. "Reset to defaults" link at the bottom.

3. **Add column.** User checks "Description":
   - Optimistically render the column header (empty cells, skeleton shimmer).
   - Fire `useObjectTreeWindow.refetchWithFields([...current, "description"])`. Hook adds the new wireKey to its in-flight `?fields=` query and re-runs the CURRENT window (same page, same sort, same filters).
   - On response, merge new field into every cached row (root window + expanded children). Headers de-skeleton.
   - Persist updated set to localStorage (and serverPrefs if configured) — fire-and-forget.

4. **Remove column.** User unchecks "Description":
   - Frontend stops rendering it. No backend call.
   - Data stays in memory for the session (cheap; avoids re-fetching if they re-add it).
   - Persist updated set.

5. **Sort/filter on a hidden column.** Disallowed at the UI level — sort/filter chips only offer currently-visible columns. (Future: auto-add the column when the user filters by it.)

6. **The pagination contract is unchanged.** Page-flips don't reset visible columns. The visible-column set is page-orthogonal.

**Wire contract** (matches Slice 2.5):
- Frontend always passes `?fields=` (explicit, never absent — gives stable expectations).
- Always includes the always-on columns (`id`, the primary identity column).
- Backend's allow-list defends against typos and prevents arbitrary field fishing.

**Edge cases worth pinning in tests:**
- Add column WHILE a window is loading → coalesce: the new fetch supersedes the in-flight one.
- Two columns added in rapid succession → debounce 250ms; one request goes out with both.
- Add a column WHILE expanded children are visible → re-fetch the root window AND every expanded sub-tree's children with the new field. (Same back-channel as today's cascade refresh.)
- localStorage prefs from another tree's column set → namespaced by `prefsKey`, no bleed.

**Acceptance:** On /work-items, open column picker, add "Description". The Description column appears across all 25 visible rows within ~300ms of the API response. No full grid reload (the user's expanded sub-trees stay expanded, scroll position preserved). Page-flip still works.

**Risk:** Medium. The merge-into-cached-rows logic is non-trivial (root window + childMap + in-flight coalescing). Boundary tests in Slice 0 don't cover this — write new ones for the picker behaviour itself.

### Slice 4.6 — Memoisation pass + cascade-scope reduction (1 day) ★ NEW
**Touches:** all cell renderers (`React.memo` audit), `useObjectTreeWindow` (coalescing), `backend/internal/artefactitems/handler.go` (PATCH responses carry `touched_ids`), possibly new `GET /<resource>/by-ids` endpoint · **Backend:** YES — handler response shape change + maybe new route · **main.go:** maybe 1–2 new chi routes for by-ids · **Migration:** none
**Goal:** Close the gap between "all the right architecture" and "actually feels fast." Eliminates the death-by-thousand-re-renders that creeps in once the surface is generic.

**Frontend work:**
- Audit every cell renderer in the work-items columns (and the new chrome components). Wrap each in `React.memo` with explicit `arePropsEqual` checking only the fields that cell reads. The default `memo` (referential prop equality) is not enough when row objects get spread/recreated on patch.
- Confirm the flat row store from Slice 1 is feeding components via narrow selector hooks (`useRow(id)`, `useRowField(id, field)`) so a patch to row B doesn't notify components rendering row A.
- Verify request coalescing in the data hook: rapid sort/filter/column-add changes within 150ms collapse to one outgoing request.

**Backend work:**
- Every PATCH that triggers a cascade (currently flow-state changes, drag-reparent) extends its response with `{ touched_ids: string[] }`.
- Frontend cascade-refresh logic stops calling `refetchExpandedChildren()` (re-pulls every sub-tree); instead re-fetches only the rows in `touched_ids` via a new `GET /<resource>/by-ids?ids=…&fields=…`.
- Endpoint already exists for some resources (work-items has a `?ids=` pattern); audit and standardise.

**Acceptance:**
- Perf-baseline (Slice 0.5) is matched or beaten on every named action.
- Drag-reparent → cascade settled drops from current measured P95 to budget (< 800ms).
- React DevTools profiler: changing one cell's value re-renders only that cell, not its row, not its neighbours, not the whole table body.

**Risk:** Low-medium. Memoisation discipline is mechanical but easy to leave a hole in. Cascade-scope-reduction is contained to the data hook + one new backend response field. Profiling tells the truth.

### Slice 5 — Backend: timebox scope_propagation column (1.5 days)
**Touches:** `backend/internal/{timeboxsprints,timeboxreleases}/{handler,service,sql}.go`, `db/vector_artefacts/schema/0NN_*.sql` (new migration) · **Backend:** YES — biggest backend slice in the plan so far · **main.go:** no (services wired the same way) · **Migration:** YES — column + check constraint on `timeboxes_sprints` + `timeboxes_releases`
**Goal:** Add the inheritance substrate before any UI uses it.

- Migration: `timeboxes_sprints.timeboxes_sprints_scope_propagation TEXT NOT NULL DEFAULT 'this_node_only'` + CHECK (`'this_node_only'` | `'this_node_and_descendants'`). Same on `timeboxes_releases`.
- Service: extend `List(workspaceID, filters)` to accept `org_node_id` AND apply ancestor-walk UNION when descendant rows have `scope_propagation = 'this_node_and_descendants'`.
- Wire response shape: each row gains `{ origin: "local" } | { origin: "inherited", from_node_id, from_node_name }`.
- Handler: accept `scope_propagation` on Create. PATCH it on Update. Reject for inherited rows (return 409 with usermessages.Conflict).
- Tests: pin the ancestor-walk inclusion + the inherited-row read-only behaviour at the service layer.

**Acceptance:** Backend tests pass. Existing /sprints page (still on TimeboxManager) shows no behavioural change because all existing rows are `this_node_only`.

**Risk:** Medium. New migration + non-trivial SQL change. But fully testable in isolation.

### Slice 6 — Sprint + Release configs, page swap (2 days)
**Touches:** new `ObjectTreeV2/configs/p_wizard_{sprints,releases}.json`, new `TimeboxInlineForm` flyout, `/app/(user)/sprints/page.tsx`, `/app/(user)/releases/page.tsx`, delete `TimeboxManager.tsx` + `useTimebox.ts` · **Backend:** none (rides on 2.5 + 5's substrate) · **main.go:** no
**Goal:** /sprints and /releases use `<ObjectTree>`. TimeboxManager deleted.

- Write `configs/sprints.tsx` and `configs/releases.tsx` against the now-generic `<ObjectTree>`.
- New detail flyout: `<TimeboxInlineForm>` (mirrors ArtefactInlineForm's shape: edit, Start/Close, Duplicate, Delete, the scope-propagation picker).
- Pages reduce to `<ObjectTree dataType="sprints" workspaceId={…} orgNodeId={activeNodeId} />`.
- Delete `<TimeboxManager>` and `useTimebox` (replaced by `useObjectTreeWindow`).

**Acceptance:** /sprints renders with identical chrome to /work-items (the screenshot you showed). Create / Start / Close / Delete works. Scope-clamp from earlier still applies. The "propagate to descendants" toggle is in the create modal but feature-flagged OFF (Slice 7 turns it on).

**Risk:** Medium. New flyout component is the biggest unknown. Lift heavily from ArtefactInlineForm's structure.

### Slice 7 — Heartbeat: scope_propagation in UI (1 day)
**Touches:** `TimeboxInlineForm` (propagation radio), inherited-row styling, "edit at source" link · **Backend:** none (Slice 5 already shipped the column + ancestor-walk) · **main.go:** no
**Goal:** Turn on the inherited-timebox UX.

- Inherited rows render with a "↑ Insurance" badge in the Name column and `is-readonly` class (grey, no inline edit).
- Create-flyout exposes "This node only" vs "This node + descendants" radio.
- Edit-flyout on a propagating row updates the source; every inheritor repaints next tick.

**Acceptance:** Manual: create a sprint at Insurance with propagation = descendants → flip scope clamp to a child node → the sprint appears there with the inherited badge → edit attempt is blocked at the row level.

**Risk:** Low. Backend already does the heavy lifting in Slice 5.

### Slice 8 — Milestones consolidation (1 day, optional)
**Touches:** new `ObjectTreeV2/configs/p_wizard_milestones.json`, milestones page rewrite, possibly `backend/internal/timeboxmilestones/handler.go` if it lacks `?fields=` (catch-up from Slice 2.5) · **Backend:** maybe yes (parity catch-up) · **main.go:** no
**Goal:** /milestones uses `<ObjectTree>` too. Drops the bespoke `MilestoneManager` (if one exists similar to TimeboxManager).

**Acceptance:** Three pages (sprints, releases, milestones) all render through `<ObjectTree>`.

---

## Total estimate

**~19 days** of focused work, shippable in 13 slices over ~3.5 weeks of solo-dev pace. Each slice keeps the app green. No long-lived branch.

(Original 8-slice plan was ~12 days. Added: +4 days for the column-selector substrate (Slices 2.5 + 4.5), +0.5 day for perf baseline (Slice 0.5), +1 day for the memoisation + cascade-reduction pass (Slice 4.6), +1.5 days for the plugin architecture + registries + context registry (Slice 1.5). Total ~19. Worth it: the JSON-driven plugin architecture is what makes "one component, many data types, agent-introspectable, lazy-loaded" actually work — without it we just have today's monolith dressed in nicer types.)

The Work Items contract (Slice 0 tests) AND the perf baseline (Slice 0.5) are the safety harnesses — every slice has to pass both. If a slice regresses either, it doesn't ship.

Slice numbers are labels, not ordering. **Order of execution is exactly as written:** 0 → 0.5 → 1 → 1.5 → 2 → 2.5 → 3 → 4 → 4.5 → 4.6 → 5 → 6 → 7 → 8. Slice 1.5 lands before 2 because the plugin architecture is what Slice 2 plugs into. Slice 2.5 has to land before 4.5 (column selector needs the backend contract first). Slice 4.6 lands after the picker so we measure picker cost too.

---

## What this unlocks

- **One component to maintain.** A bug fix in the tree chrome benefits every consumer.
- **Sprints + Releases + Milestones look identical to Work Items.** Visual parity = lower cognitive load.
- **The heartbeat feature is one feature flag away** instead of a 2-week build.
- **Future "list-like hierarchical things" cost a config file, not a component.** Workspaces, custom artefacts, fields catalogue, audit log — any of them could mount through `<ObjectTree>` with a 30-line config.
- **`<ObjectTreeRegistry>` finally does its job.** No more aspirational comments in a registry file with zero entries.
- **Pay-per-column data fetching.** Default view stays narrow and fast; users opt-in to richer columns when they need them. New custom field added to an artefact type? It auto-appears in the column picker — no UI change needed.

---

## Risks worth naming

1. **Another agent is currently in Work Items.** Slices 0–4 touch [p_ObjectTree.tsx](../app/components/ObjectTree/p_ObjectTree.tsx). Coordinate with them — don't start until their branch lands, or pair the work explicitly. (Per the [single-agent-ownership-per-domain](../context/MEMORY.md) rule added today.)
2. **The detail flyout extraction (Slice 2) is the highest-risk step.** ArtefactInlineForm has tendrils into cascade refresh, child patch back-channels, drag-handle refs. Boundary tests in Slice 0 are non-negotiable.
3. **Backend ancestor-walk performance.** For a deep topology with hundreds of timeboxes, the UNION read could get expensive. Mitigation: index `timeboxes_sprints (workspace_id, scope_propagation, archived_at)` and limit ancestor walk to the live tree.
4. **The propagating-row edit-block UX needs care.** A grey row that does nothing is a defect. Decision before Slice 7: do we link "edit at source" from the inherited row, or just disable? Recommend a small "edit at source" link that scope-flips and opens the source's flyout.

---

## Decisions you need to make before we start

1. **Order — pause Work Items agent OR wait for them?** Slices 0–4 conflict with their file. Either: (a) ask them to finish + merge, then we start; (b) coordinate so we own ObjectTree refactor for two weeks while they pause; (c) split — they finish their feature on a stable snapshot, we branch refactor afterwards. Recommended: **(c)**, lowest contention.
2. **Heartbeat semantics — confirm.** "Sprint created at Insurance with propagation=descendants" means: (a) ONE row at Insurance, every child READS it (recommended — atomic edit, no fan-out); OR (b) propagation = generates N rows, one per descendant (no — explosion + drift). Confirm (a).
3. **Detail flyout — same flyout for all timeboxes (sprints/releases share `<TimeboxInlineForm>`) OR one per kind?** Recommend shared, with kind-specific bits behind a small `kind` prop — mirrors what TimeboxManager already does.
4. **Naming — keep `<ObjectTree>`?** It's a generic-list-tree-thing. Alternative: `<ResourceList>`, `<DataTree>`, `<HierarchicalTable>`. Recommend keeping `<ObjectTree>` — it's already addressable in Samantha and pages reference it.
5. **Do we delete the legacy mode-prop path immediately or deprecate?** Recommend delete in Slice 3 — no external consumers.
6. **Column-picker prefs persistence.** Default to localStorage only (per-device), OR ship server-side prefs from day one (cross-device parity)? Recommend localStorage in Slice 4.5, server-prefs as a small follow-up (one new endpoint `/me/tree-prefs/{treeName}` GET+PUT). Buyer profile is defence/finance — cross-device parity reads as "professional" and is expected for power-users.
7. **Column picker — what about custom fields?** The workspace custom-fields work in flight (admin agent, dirty state) adds per-workspace fields. If `columnCatalogue` is static-per-build, custom fields can't appear. Need to decide whether the catalogue is partly server-driven (`config.columnCatalogue` is augmented by a `GET /<resource>/columns` call). Probably yes — but lands as a follow-up to Slice 4.5, not part of it.

---

## Next step

Read this, push back, and we converge on the slice list before any code moves. Then I write the slices up as one PLA + child stories, or just keep working from this doc — your call.
