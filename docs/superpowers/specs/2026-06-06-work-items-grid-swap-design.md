# Work Items → Grid swap (retire ObjectTreeV2 on `/work-items`)

**Date:** 2026-06-06
**Status:** Approved (design) — pending implementation plan
**Author:** Claude (Opus 4.8) + Rick

## Problem

`/work-items` still renders the **retiring** ObjectTreeV2 component
(`app/components/ObjectTreeV2/p_ObjectTree.tsx`). The new Grid primitive
(`Grid__Tree` + `useTree`, assembled by `GridExecution`) already powers
`/scope` and `/artefacts`.

The trigger was a **regression**: the "Dependencies" button in the
`/work-items` row-detail expander does nothing. Root cause — ObjectTreeV2
renders `<ArtefactInlineForm>` passing only `onDuplicate` + `onDelete`, never
`onDependencies` (`p_ObjectTree.tsx` ~L2093–2101). The button's
`onClick={() => onDependencies?.(artefact)}` (`ArtefactInlineForm.tsx` L288)
is therefore a silent no-op. The `/dependencies` page reads the artefact id
from `?ash=` (`app/(user)/dependencies/page.tsx` L15) and shows "Missing
artefact id." when it is absent — which is what the user saw.

The Grid path does NOT have this bug: `Grid__Tree_Forms` forwards
`onDependencies` to `ArtefactInlineForm`, and `GridExecution` wires
`onDependencies={openDependencyMap}` (which builds `?meg=…&ash=…` correctly).
**So moving `/work-items` onto the Grid fixes the regression intrinsically** —
no point-patching the retiring component.

## Goal

Replace the `/work-items` grid body (ObjectTreeV2 → Grid) while:

- **Preserving the old grid** at a parallel route as a safety net.
- **Keeping the work-items filter system** — multi-select Type chips with
  **Tasks visible as a top-level type** (not children-only). This differs from
  `/scope` + `/artefacts`, which use a single-type "view picker" and hide
  Tasks.
- **Keeping the rich page chrome** — page heading, KPI summary strip
  (TOTAL / per-type / BLOCKED), and the visualisation petal/pie panel.
- **Porting the working create flow** so "Create new" works on day one (the
  Grid's current `onCreate` is a `console.log` stub).
- **Not touching `/scope` or `/artefacts`** — work-items iteration happens on
  an independent assembler copy.

## Approach (chosen)

User-directed, lowest-risk: **copy, don't parameterise.**

1. **`/work-items-2`** = verbatim copy of the current ObjectTreeV2
   `/work-items`. The old grid stays fully working and reachable, **and gets a
   nav-rail entry**. This is the reference/fallback during the rebuild.

2. **`GridWorkItems`** = a **copy** of `GridExecution` with its own filter
   pref key. An independent assembler so work-items behaviour changes never
   ripple into `/scope` or `/artefacts`. Starts behaviourally identical to
   `GridExecution` (single-type, Tasks-hidden) — which already fixes the
   Dependencies regression — then is iterated toward the work-items variant.

3. **`/work-items`** = a clone of `/artefacts` (Panel + grid) that renders
   `<GridWorkItems />` instead of `<GridExecution />`, with the rich chrome
   re-added around it.

Rejected alternatives:
- *Parameterise `GridExecution` via a config prop* — clean single-source, but
  touches the live `/scope` + `/artefacts` surfaces; the user preferred an
  isolated copy.
- *Extract a headless `useGridArtefacts` hook* — cleanest long-term, biggest
  up-front refactor; deferred (see Tech debt).
- *Point-patch ObjectTreeV2's `onDependencies`* — patches a component on its
  way out; wrong place.

## File-level changes

### A. Safety-net copy → `/work-items-2`
- `app/(user)/work-items-2/page.tsx` — verbatim copy of current
  `app/(user)/work-items/page.tsx`. Only change: `SAVED_VIEW_TARGET` →
  `objecttree:work_items_2` so saved-views don't collide.
- `app/(user)/work-items-2/layout.tsx` — copy of the existing layout.
- **Nav**: migration inserting a nav-catalogue row (label e.g. "Work Items
  (old)", href `/work-items-2`) + the page-access grant, mirroring how
  `/work-items` is registered. Nav is DB-driven (`backend/internal/nav` +
  `pageaccess`), so this is a backend/migration touch, not a frontend file.
  Exact table + grant shape to be confirmed against the existing `/work-items`
  catalogue row during planning.

### B. Fresh assembler → `GridWorkItems`
- `app/(user)/work-items/GridWorkItems.tsx` — copy of
  `app/(user)/scope/GridExecution.tsx`, renamed `GridWorkItems`, with
  `WORK_ITEMS_FILTER_PREF_KEY = "workitems.grid.filters"` (distinct from
  `scope.workitems.filters` so the two surfaces don't share chip state).
  Behaviourally identical to `GridExecution` at landing.

### C. New `/work-items` page → clone of `/artefacts`
- `app/(user)/work-items/page.tsx` — replace the ObjectTreeV2 body with the
  `/artefacts` shape, rendering `<GridWorkItems />`. Re-add `PageHeading` +
  `PageSummaryHeader` + `VisualisationPanel` (rich chrome) around it.

### D. Iterate `GridWorkItems` toward the work-items variant
On the new surface only:
- **Type filter → multi-select + Tasks visible.** Swap the `typeSelectionMode`
  to `"multi"`, drop the `TASK_TYPE_SLOT` exclusion + the single-type
  `selectedTypeId` default-to-Epic collapsing, and feed the full work-items
  type set (incl. Task) to both the chip options and the tree filter. The
  underlying filter machinery (`useWorkItemsFilters`, `WorkItemsFilterChips`,
  URL-backed `?type=/?status=/?priority=/?owner=`, multi-value `item_type_id`
  query) already supports multi-select — see
  `app/components/work-items-tree-config.tsx`.
- **Port the create flow.** Lift the working create flyout out of ObjectTreeV2
  (`submitCreate` L1588–1693 + the create-flyout state/JSX L663–2070:
  title, description doc, parent picker, topology node, flow-state, sprint,
  release, milestone, colour, custom fields) into a reusable
  `ArtefactCreateFlyout` component, and wire it to `GridWorkItems`'s
  `actionBar.create.onCreate`. This also pays down `TD-GRID-FORM-MODES`
  (Grid create-mode was deferred) and unblocks create on `/scope`/`/artefacts`
  later. The create POST contract is unchanged (`POST /work-items?meg=` +
  follow-up PATCH for fields the create handler doesn't accept natively).

## What we explicitly are NOT doing

- Not editing `GridExecution`, `/scope`, or `/artefacts`.
- Not deleting ObjectTreeV2 yet — it still powers `/work-items-2`,
  `/portfolio-items`, and other surfaces. Its retirement is tracked
  separately.
- Not changing any backend create/patch/query contract.
- Not changing the burn-event capture (unrelated; investigated and cleared
  during diagnosis).

## Testing

- **Dependencies button (the regression):** with `/work-items` on the Grid,
  clicking a row → expander → Dependencies navigates to
  `/dependencies?meg=…&ash=<id>` and the map loads (no "Missing artefact id").
  A focused test on the dependency-map href construction (always includes
  `ash`) guards the param that broke.
- **Multi-type filter + Tasks:** selecting Story+Task shows both as top-level
  rows; the `item_type_id=a,b` query round-trips.
- **Create:** "Create new" → pick a type → fill title → submit issues
  `POST /work-items?meg=…`, the row appears, and the follow-up PATCH applies
  deferred fields.
- **Safety net:** `/work-items-2` renders the old ObjectTreeV2 grid unchanged
  and is reachable from the nav rail.
- **No collateral:** `/scope` + `/artefacts` behaviour byte-for-byte
  unchanged (independent assembler copy).

## Tech debt

- **TD-WORKITEMS-GRID-DUP** — `GridWorkItems` is a copy of `GridExecution`;
  the two (plus `GridSprintReview`) now triplicate the assembler. Pay-down:
  extract a shared headless `useGridArtefacts` core once the work-items
  variant has settled. Trigger: a fourth Grid page, or the first bug that has
  to be fixed in 3 places.
- **TD-GRID-FORM-MODES** — partially paid by the create-flyout extraction;
  view/duplicate Grid form modes still deferred.
- ObjectTreeV2 retirement remains tracked under its existing register entry;
  `/work-items-2` is a temporary consumer with an explicit removal trigger
  (delete once the Grid `/work-items` is signed off).

## Sequencing (for the plan)

1. `/work-items-2` copy + nav entry (safety net first, so the old grid is
   never the only copy).
2. `GridWorkItems` assembler copy + new `/work-items` page (clone of
   `/artefacts`) → **Dependencies regression fixed here.**
3. Multi-type + Tasks-visible filter on `GridWorkItems`.
4. Rich chrome (heading + KPI strip + visualisation) on the new page.
5. Create-flow extraction + wiring.
6. Regression sweep (`/scope`, `/artefacts`, `/work-items-2` unaffected).
