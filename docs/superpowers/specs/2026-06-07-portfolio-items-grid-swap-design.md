# Portfolio-items Grid Swap — Design

**Date:** 2026-06-07
**Surface:** `/portfolio-items`
**Pattern source:** `/work-items` Grid swap (`docs/superpowers/specs/2026-06-06-work-items-grid-swap-design.md`)
**DB / backend:** unchanged — `portfolioItemsV2H` already runs `artefactitems.NewService(..., "strategy")`
**Status:** Design — approved for plan

---

## 1. Problem & intent

`/portfolio-items` renders STRATEGIC artefacts (the portfolio ladder: Portfolio Runway → Product →
Business Objective → Theme → Feature) via the retiring ObjectTreeV2. `/work-items` already swapped
its execution-artefact tree onto the Grid primitive. Do the same swap for `/portfolio-items`,
adapting the chrome + columns for strategic data.

The data layer, backend scope filtering, `?meg=` topology forwarding, and saved-views all already
exist for portfolio items — this is a frontend swap (ObjectTree → Grid), not new plumbing.

## 2. Decisions (approved 2026-06-07)

1. **Same container/chrome as work-items.** `PageContent` > `PageHeading` + `Panel` header +
   `PageSummaryHeader` + `VisualisationPanel` + `<GridPortfolioItems>`. The portfolio page adopts
   the full work-items chrome structure (it currently renders ObjectTree more directly).
2. **Strategy column trim.** Columns: **ID, Summary, Status, Colour, Owner, Parent, Due** — DROP
   Sprint, Points, Release, Priority (always empty/irrelevant for strategy artefacts).
3. **Direct in-place swap.** Replace the ObjectTree in `portfolio-items/page.tsx` with
   `<GridPortfolioItems>`. NO `/portfolio-items-2` safety net (the Grid pattern is proven by
   work-items; the old ObjectTree stays in git history).
4. **Strategy-appropriate title/subtitle copy** — the one deliberate chrome-content change.
5. **Everything else flows from `scope="strategy"`** — create pills, filter chips, and the create
   flyout's field-gating already adapt to strategy via the scope param.

## 3. Architecture

Three files, mirroring work-items' three-piece structure:

### 3a. `app/(user)/portfolio-items/page.tsx` (modify)

Adopt the work-items page chrome. Structure (copied from `work-items/page.tsx`):

```
<PageContent>
  <>
    <PageHeading level={1} title={full} subtitle="<strategy copy>" />
    <Panel name="panel_portfolio_items_header" className="page-panel-heading"
           title="Portfolio Items" description="<strategy copy>" />
    <PageSummaryHeader cells={summaryCells} />     {/* per-strategy-type counts */}
    <VisualisationPanel pageKey="portfolio_items" petalKeys={...} ... treeResourceUrl="/portfolio-items" />
    <GridPortfolioItems />
  </>
</PageContent>
```

- **Summary fetch:** `apiSite("/portfolio-items/summary")` → `{ total, by_type }`. The page already
  has this pattern (current portfolio page builds per-strategy-type cells from
  `types.filter(scope === "strategy")`). Reuse it. Note: portfolio summary may NOT have a `blocked`
  field — if absent, omit the BLOCKED cell (work-items has it; strategy may not). Verify the wire
  shape; render BLOCKED only if present.
- **`surfacedTypes`:** strategy types ordered by `sort_order` (the current page already does this).
- **Realtime + `?meg=` refetch:** reuse the `activeNodeId`/`direction` effect + `useRefetchOnPush`
  with a `portfolio_item` rank topic (mirror work-items' `rankTopic("work_item", ...)` →
  `rankTopic("portfolio_item", ...)`).

### 3b. `app/(user)/portfolio-items/GridPortfolioItems.tsx` (new)

Copy `GridWorkItems.tsx` verbatim, then swap:

| work-items | → portfolio-items |
|---|---|
| `workItems.query/patch/archive` | `portfolioItems.query/patch/archive` (exist in `apiSite`) |
| `scope: "work"` (useChipTypeOptions, flyout) | `scope: "strategy"` |
| `resourceUrl="/work-items"` (flyout) | `resourceUrl="/portfolio-items"` |
| DnD `resourceType: "work_item"` | `resourceType: "portfolio_item"` |
| saved-views / pref namespace `workitems.*` | `portfolioitems.*` |
| title `"Work items"` / work subtitle | `"Portfolio items"` / strategy subtitle |
| `WORK_ITEM_CREATEABLE_SLOTS` create filter | strategy: show all live strategy types (no slot trim) |
| full column factory | strategy column factory (§3c) |
| `empty` copy "No work items in scope." | "No portfolio items in scope." |

**Reused untouched:** the `useTree` headless core, `fetchScopeRoots`/`fetchScopeChildren` shape
(via `portfolioItems.query`), reparent wiring (strategy types chain through `parent_type_id`;
`buildReparentMap` already handles them), `ArtefactCreateFlyout` (gates sprint/points off via its
`isStrategic` check), `WorkItemsFilterChips`, `GridTree`, `Grid__Tree_ActionBar`.

**Data row shape:** the work-items `ScopeNode` (in `scopeTreeData.ts`) maps the wire item. Portfolio
items come from the SAME `artefactitems` handler (same wire shape — `WireWorkItem`), so the existing
`mapWire`/`ScopeNode` is reusable. The strategy columns simply don't read the sprint/points fields.
The data builder can be shared (parameterise `fetchScopeRoots` by the `portfolioItems` bundle) OR a
thin `portfolioTreeData.ts` copy — prefer **parameterising the existing builder** by passing the
api bundle, to avoid a near-duplicate file. If that proves invasive, a focused copy is acceptable.

### 3c. Strategy column factory

The work-items columns live in `app/(user)/scope/scopeColumns.tsx` (`makeScopeColumns`). For
portfolio, provide a strategy column set: **ID, Summary, Status, Colour, Owner, Parent, Due**.

Two implementation options:
- **(a) Add a column-set param to `makeScopeColumns`** (e.g. `{ omit: ["points","sprint"] }` or an
  explicit column-id list). Keeps one factory; work-items passes the full set, portfolio passes the
  trim. **Preferred** — DRY, the cells are identical where present.
- (b) A separate `portfolioColumns.tsx` factory. More duplication; only if (a) tangles the
  work-items factory.

Column details (all reuse the existing work-items cell renderers):
- **ID** — `treePrimary`, hosts caret/indent, click opens detail flyout.
- **Summary** — flex, the title.
- **Status** — flow-state cell (strategy types now have flows after the flow-seeding work).
- **Colour** — the colour swatch picker (`ColourBlockPicker`), patches via `portfolioItems.patch`.
- **Owner** — owner pill.
- **Parent** — display label of the parent (matters for the ladder).
- **Due** — due date.
- DROPPED: Sprint, Points (Pts), Release, Priority (Pri).

## 4. Backend

**No change.** `/portfolio-items` is already mounted (`main.go`: `mountArtefactSite(r,
portfolioItemsV2H)` + the dependency-impact route), and `portfolioItemsV2H` is
`NewService(..., "strategy")`, so every query filters `artefacts_types_scope = 'strategy'`.
`portfolioItems.query`/`patch`/`archive`/`summary` already exist in `app/lib/apiSite`. `?meg=`
forwarding via `withForwardedMeg` already applies to `/portfolio-items` GETs.

## 5. Reparent for strategy

Strategy types form a single-parent ladder via `artefacts_types_strategy_parent_id`. The work-items
`buildReparentMap` is built from `execution_parent_slots` (work types only) — it returns no entries
for strategy types, so the work-items reparent map won't gate strategy reparenting correctly.

**Decision:** for strategy, allow reparenting a row onto any artefact whose TYPE is the immediate
parent type in the ladder (e.g. a Feature can reparent under a Theme instance). Resolve "legal
parent type" from the `parent_type_id` chain (the strategy source of truth), not
`execution_parent_slots`. Implement a `strategyCanReparent` that checks the mover type's
`parent_type_id` against the target type. If this proves involved, the MINIMUM viable version is:
permit reparent only within the same workspace + same-or-adjacent strategy layer, and log the
constraint. (Reparent is secondary to the read/create swap — get the grid rendering first; reparent
can land as a follow-up if the strategy rule is non-trivial.)

> NOTE: this is the one place portfolio genuinely diverges from work-items' DnD. Flag it; if the
> strategy reparent rule balloons, ship the grid with reparent disabled (`dnd` omitted) and a
> TD-PORTFOLIO-REPARENT entry, rather than a wrong rule.

## 6. Out of scope

- Backend changes (already correct).
- New columns beyond the trim (no Layer column this pass).
- `/portfolio-items-2` safety net (direct swap).
- Changing the portfolio summary wire shape.

## 7. Validation & safety

- Page renders the strategy ladder via Grid with the trimmed columns.
- Create pills show ONLY strategy types.
- Sprint/Points/Release absent from columns AND the create flyout (flyout already gates via
  `isStrategic`).
- `?meg=` scope clamp still applies (reuse the forwarding).
- Saved-views persist under `portfolioitems.*`, not `workitems.*`.

## 8. Testing

Frontend (Vitest/RTL where component tests exist; otherwise manual smoke):
- `GridPortfolioItems` renders strategy rows from a mocked `portfolioItems.query`.
- Column set excludes Sprint/Points; includes ID/Summary/Status/Colour/Owner/Parent/Due.
- Create pills list strategy types (mocked `useChipTypeOptions("strategy")`).
- Summary cells render per-strategy-type from a mocked `/portfolio-items/summary`.
- Manual: load `/portfolio-items`, confirm the PRW→Feature ladder renders, create a Theme, reparent
  a Feature under a Theme (or confirm reparent disabled if deferred), confirm `?meg=` scope.

## 9. Tech-debt

- **TD-PORTFOLIO-REPARENT** (conditional, S3) — only if strategy reparent is deferred: the grid
  ships with DnD reparent disabled until a strategy-ladder reparent rule (via `parent_type_id`
  chain) is implemented. Trigger: user wants drag-reparent on the portfolio ladder.
- **TD-SCOPETREEDATA-SHARED** (conditional, S3) — if a `portfolioTreeData.ts` copy is made instead
  of parameterising `scopeTreeData.ts`, note the near-duplicate for later consolidation.

## 10. Phasing (for the plan)

1. **Strategy columns** — parameterise `makeScopeColumns` (or a portfolio factory) for the trim.
2. **Data builder** — parameterise `fetchScopeRoots`/`fetchScopeChildren` by api bundle (or copy).
3. **`GridPortfolioItems.tsx`** — copy GridWorkItems, apply the swaps (§3b).
4. **`page.tsx`** — adopt work-items chrome, swap body to `<GridPortfolioItems>`.
5. **Reparent** — strategy rule, or defer with TD + disabled DnD.
6. **Verify** — tsc, tests, manual smoke on `/portfolio-items`.
