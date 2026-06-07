# Sprint Boundary-Drag — Chrome & Sprint-Context Additions

**Date:** 2026-06-07
**Status:** Draft — awaiting user review
**Builds on:** docs/superpowers/specs/2026-06-07-sprint-boundary-drag-design.md (the POC)
**Surface:** `app/components/Grid/Grid__SprintBoundary.tsx` + `app/(user)/value-sprint/page.tsx`

---

## 1. Purpose

Bring the `Grid__SprintBoundary` POC to parity with the `value-sprint-review` sprint grid's chrome, and make it self-contained and sprint-aware:

1. **Empty-sprint state** — when the sprint section has zero rows, render a blank explanatory row directly below the column header (above the divider) telling the user the sprint is empty and how to use the drag handle to pull work in. The divider sits below that explanatory row.
2. **Title + subtitle panels (in-skin)** — render the striped prefix box + red **FILTER** prefix + the live **sprint name** as the title, and the subtitle line, *inside* the component (self-contained), matching the `Grid__Tree` title band.
3. **Action bar (in-skin, fully wired)** — Prev / Next / Current / Switch / Status sprint-nav buttons + Search + the filter chips (Items / Status / Priority / Sprint / Release / Owner), all functional.
4. **Default to current sprint** — the component shows today's active sprint on load with no searching, and auto-advances when a new sprint becomes current (same rule as `value-sprint-review`).

## 2. Decisions (locked with the user, 2026-06-07)

| Decision | Choice |
|---|---|
| **Chrome location** | **Inside the skin** — `Grid__SprintBoundary` renders its own title band + subtitle + action bar (self-contained). It takes the sprint object + nav callbacks + search/filter state as props. Rationale: this POC will *become* the page when the legacy panels retire (TD-SPRINT-POC-RETIRE), so it should be whole. |
| **Filters + search** | **Fully wired** — Search and the filter chips re-clamp BOTH `useTree` instances (sprint + backlog) live, reusing `useWorkItemsFilters` + `WorkItemsFilterChips` + the fingerprint-driven refresh pattern from `GridSprintReview`. |
| **Sprint nav** | **Reuse existing piping** — Prev/Next/Current/Switch/Status wire to the page's existing `stepSprint` / `sprintNavState` / radial `targetMenu` (`useNextSprint` + `panelSprintIdOverride`). All functional from day one. |
| **Default-to-current** | Reuse `value-sprint`'s existing `panelSprintId` chain: `panelSprintIdOverride ?? currentSprint ?? nextSprint`. Add the auto-advance effect from `value-sprint-review/page.tsx:239-249` if not already present, so the POC follows the active sprint. |

## 3. What already exists (reuse verbatim — no shared-file edits)

- **Title band markup** (`Grid__Tree.tsx:501-511`): `PrefixBlockStripes` (the B/W striped box) + `<span class="grid__Tree_Title_Heading_Filter">FILTER</span>` (the red prefix) + title + subtitle. `PrefixBlockStripes` is an importable component (`app/components/PrefixBlockStripes`). The skin composes the SAME markup + classes (so the existing CSS applies) — it does NOT edit `Grid__Tree`.
- **Action bar** (`Grid__Tree_ActionBar.tsx`): `GridTreeActionBar` is a standalone export taking `{ ariaLabel, leading, search, filterChips }`. Import + render it directly.
- **Filter threading** (`GridSprintReview.tsx:148-254`): `useWorkItemsFilters(PREF_KEY)` → `filters` → `effectiveFilters` → into `fetchRoots`; a `fingerprint` memo calls `refresh()` on any filter change. Replicate for both boundary trees.
- **Sprint piping** (`value-sprint/page.tsx`, already present): `useNextSprint`, `panelSprintId`, `panelSprint`, `formatSprintLabel`, `stepSprint`, `sprintNavState`, `currentSprint`, `showCurrentSprintBtn`, the radial `targetMenu` + `setTargetMenu`, the nav-button JSX. These move/extend to drive the skin.
- **Empty state convention**: `GridTree` uses `empty={<p className="grid__Empty">…</p>}`. The boundary's empty-sprint row reuses `grid__Empty` styling for visual consistency, but is a bespoke explanatory row (see §5).

## 4. Component shape (new props on Grid__SprintBoundary)

```
GridSprintBoundaryProps (extended):
  sprintTree, backlogTree, columns, commit, defaultSort?, rowHeightForTest?   // existing
  // NEW — chrome (all optional so existing tests/use keep working):
  sprintLabel?: string            // formatSprintLabel(panelSprint) → title after "FILTER"
  sprintMeta?: ReactNode          // the date → date · status subtitle/ description line
  subtitle?: string               // "Work items committed to this sprint…" sub-line
  actionBar?: {                   // mirrors GridTreeActionBarConfig
    leading?: ReactNode           // Prev/Next/Current/Switch/Status buttons (page-built)
    search?: { placeholder; value; onChange }
    filterChips?: ReactNode       // <WorkItemsFilterChips …>
  }
  emptySprintHint?: ReactNode     // override the default empty-sprint explanatory row
```

The skin renders, top to bottom:
1. **Title band** — `PrefixBlockStripes` + `FILTER` + `sprintLabel`, then `subtitle` (using the `grid__Tree_Title*` classes so existing CSS styles it).
2. **Action bar** — `GridTreeActionBar` with the passed `actionBar` config.
3. **Column head** — `GridTreeHead` (existing).
4. **Body** — sprint rows; if zero sprint rows, the **empty-sprint explanatory row**; the **divider**; backlog rows. Tint above the line unchanged.

## 5. Empty-sprint state (detail)

When `sprintTree.flatNodes.length === 0` (boundaryIndex initial = 0):
- Render a single full-width row directly below the column header, before the divider:
  > **This sprint is empty.** Drag the handle below downward through the backlog to commit work items into **{sprintLabel}**. Release to save.
- The divider renders immediately below this row (the `boundaryIndex === 0` branch the skin already handles — the explanatory row occupies the visual "sprint section," the divider sits at the top of the backlog).
- Styling: a muted, centered hint row (reuse `grid__Empty` tone). Not a data row — no checkbox/columns. `data-sprintboundary-empty` for testability.
- The drag handle remains fully functional: dragging down from index 0 sweeps backlog rows in exactly as before.

## 6. Page wiring (`value-sprint/page.tsx`)

The page already resolves `panelSprint` / `panelSprintId` / nav state. The POC block:
- Passes `sprintLabel={formatSprintLabel(panelSprint)}`, the date·status `sprintMeta`, and `subtitle`.
- Builds `actionBar.leading` = the SAME Prev/Next/Current/Switch/Status JSX the legacy panel already renders (lines ~791-877) — reused, pointed at the same `stepSprint`/`setTargetMenu`/radial.
- Builds `actionBar.search` + `actionBar.filterChips` (`<WorkItemsFilterChips prefKey="value_sprint.boundary.filters" …>`), and threads the resulting `filters` into both `fetchSprintRoots` calls (add the `effectiveFilters` → `queryFilters` mapping; extend `fetchSprintRoots` to accept the optional filter object alongside sprintId + itemTypeIds).
- Adds the auto-advance-to-current effect if absent.
- Default-to-current already holds via the existing `panelSprintId` fallback chain (currentSprint is in it).

## 7. Filter threading (the heaviest new piece)

- New pref key: `value_sprint.boundary.filters` (independent of review/work-items chip state).
- `fetchSprintRoots(page, sprintId, itemTypeIds?, extraFilters?)` gains an optional `extraFilters` (flowStateId/priorityId/ownerId arrays) merged into `filters`. Back-compatible (no extraFilters → current behavior).
- A `fingerprint` memo over (sprintId, itemTypeIds, filters, search) drives `refresh()` on both trees when anything changes — mirrors `GridSprintReview.tsx:228-254`.
- Search: client-side title filter on the combined rendered rows is the POC-simple path; but to match GridSprintReview, prefer server search if `fetchSprintRoots`/`workItems.query` supports a search term — CONFIRM during planning whether `WorkItemQueryBody` has a search field. If not, POC does client-side title-contains filtering on `flatNodes` and logs a TD for server search.

## 8. Constraints (unchanged from the POC)

- **No edits** to `Grid__Tree.tsx`, `Grid__Tree_Row/Head/Lines.tsx`, `useTree.ts`, `useColumnManager.ts`, `types.ts`, `scopeTreeData.ts`, or `app/lib/apiSite`. Compose `PrefixBlockStripes` + `GridTreeActionBar` + `GridTreeHead` by import.
- All new skin props OPTIONAL → the 34 existing tests + the existing mount keep working unchanged.
- Membership-only, commit-on-drop, story/defect/risk clamp — all retained.

## 9. Testing

- **Empty-sprint:** render the skin with `sprintTree` = 0 rows → assert the explanatory row + divider-at-top + that a drag still commits.
- **Title band:** assert `FILTER` prefix + `sprintLabel` render; stripe box present.
- **Action bar:** assert leading buttons + search + chips render; search filters the visible rows (or re-clamps).
- **Filter threading:** assert a chip/search change refires `fetchSprintRoots` with the merged filter (mock the data layer, assert the body).
- **Default-to-current:** page-level — assert `panelSprintId` resolves to `currentSprint` on load (covered by reusing the existing chain; add an assertion if cheap).

## 10. Open items to confirm during planning

1. Does `WorkItemQueryBody` support a server-side `search` term? (Decides §7 search path.)
2. Is the auto-advance-to-current effect already on `value-sprint/page.tsx` or only on review? (Add if absent.)
3. Exact `grid__Tree_Title*` class names + whether `PrefixBlockStripes` needs props.
