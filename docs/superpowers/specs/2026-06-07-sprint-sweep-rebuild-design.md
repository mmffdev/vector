# Sprint Sweep-to-Commit — Rebuild Design

**Date:** 2026-06-07
**Status:** Draft — awaiting user review
**Supersedes the drag mechanism in:** 2026-06-07-sprint-boundary-drag-design.md + 2026-06-07-sprint-boundary-chrome-design.md
**Surface:** `app/components/Grid/Grid__SprintBoundary.tsx` + `app/(user)/value-sprint/page.tsx`

---

## 1. Why this rebuild

The current divider drives the boundary through React state: every `pointermove`
calls `setBoundaryIndex` → a `useState` change → a **full re-render of the whole
grid** (100+ rows: filter, dedupe, boundary math, reconcile). On a 114-row
sprint this is slow, stutters, and "feels like it's checking each artefact as
you pass over it" — because it literally re-renders on every pixel of movement.
Symptoms the user hit: only ~one row commits per gesture, laggy, sometimes the
commit doesn't fire, and the Sprint column renders blank (grid overflow clips it).

**Root cause:** per-move React reconciliation of a large list. The fix is
architectural, not a patch: **the sweep must be pure DOM during the gesture —
zero React renders per move — and commit once on release.**

## 2. Target interaction (user-confirmed)

A handle sits at the sprint/backlog boundary. Press it and **sweep**:
- **Down** over backlog rows → each row the pointer passes highlights **green**
  ("will be added"). Release → those rows POST into the sprint.
- **Up** over sprint rows → each highlights **amber** ("will be removed").
  Release → those rows leave the sprint (`sprint_id=""`).
- The highlight is instant (CSS class toggled imperatively), no per-row "checking".
- Empty sprint: handle sits below the header with a "sweep down to fill" hint;
  the hint hides the moment a sweep starts.

It should feel like **painting a selection**, then committing on release.

## 3. Architecture — three units

### 3.1 `useSweepSelect` (NEW headless hook) — the sweep engine
The imperative core. DOM-driven, **no React state during the drag**.

- **`onPointerDown(e)`** (bound to the handle): snapshot, ONCE into refs:
  - the container's row elements (`[data-sweep-row]`, each carrying
    `data-sweep-uuid` + `data-sweep-section="sprint"|"backlog"`),
  - each row's vertical midpoint (`getBoundingClientRect().top + height/2`),
  - the handle's own Y (the sweep origin).
  Set `setPointerCapture` on `e.currentTarget` (the handle). Flip a single
  `dragging` state to `true` (ONE render — enables the dragging CSS).
- **`onPointerMove(e)`** — a plain function, NOT a React callback that sets
  state. It computes the pointer Y, determines direction (below origin = down/
  add over backlog rows; above = up/remove over sprint rows), and for each
  cached row toggles `el.classList`:
  - down: backlog rows with `midpoint <= pointerY` get
    `grid__SprintBoundary_Row-sweptAdd`; others cleared.
  - up: sprint rows with `midpoint >= pointerY` get
    `grid__SprintBoundary_Row-sweptRemove`; others cleared.
  Also updates a live counter via a ref'd text node (`counterRef.current.
  textContent = "N to add"/"N to remove"`) — direct DOM, no render.
  **Net: zero React renders per move.**
- **`onPointerUp(e)`** — collect rows still carrying a swept class → their
  `data-sweep-uuid`s + the direction. Clear all swept classes. Release capture.
  Flip `dragging` to `false` (one render). Call `onCommit({ uuids, direction })`.

- **Signature (headless, testable):**
  `useSweepSelect({ containerRef, handleRef, counterRef, onCommit }) →
   { dragging, handlePointerProps }` where `handlePointerProps` is
  `{ onPointerDown, onPointerMove, onPointerUp }` spread onto the handle.
- **Testable:** inject row rects via a test seam (mock `getBoundingClientRect`
  or a `rowGeometryForTest`); assert the right uuids/direction on release and
  that no React render happens mid-sweep (render-count spy).

### 3.2 `Grid__SprintBoundary` (rewired skin)
- Renders the same continuous list: sprint rows, the **handle** (the old
  divider element, now a sweep origin), backlog rows. Each row `<div>` carries
  `data-sweep-row data-sweep-uuid={uuid} data-sweep-section={...}`.
- The handle gets `useSweepSelect`'s `handlePointerProps` + the ref'd counter.
- `dragging` toggles ONE class on the container at start/end (for the bloom),
  not per move.
- **`useSprintBoundary` is retired** — the per-move-state boundary math is the
  defect. Its file + tests are deleted (or kept inert if another consumer
  exists — there is none). The skin no longer imports it.
- The `commit` prop is unchanged in shape: `commit({ toSprint, toBacklog })`.
  The skin maps a sweep result to that delta: down → `{toSprint: uuids,
  toBacklog: []}`, up → `{toSprint: [], toBacklog: uuids}`.

### 3.3 Columns + container (content-correctness fix)
- **Sprint column blank:** the grid overflows its container (no width/overflow
  rule on `grid__SprintBoundary`), clipping right-edge columns (Sprint, Due).
  Add container CSS: `width: 100%`, `overflow-x: auto` so all columns show, OR
  drop the columns sprint-planning doesn't need (Parent, Due) the way the
  legacy panel's `PANEL_DROP_COLS` does — CONFIRM in planning which (prefer
  showing Sprint correctly over dropping it).
- Verify `pocColumns` includes the Sprint column AND `mapWire` populates
  `r.sprint` for sprint-clamped rows (the alias). Fix the data/clamp if the
  sprint rows arrive without the alias.

## 4. Data flow

```
pointerdown(handle)
  → snapshot rows [{el, midY, uuid, section}] + handle Y   (refs, 1 render: dragging=true)
pointermove (plain JS, NO setState)
  → ptrY, direction
  → for each cached row: el.classList.toggle(sweptAdd|sweptRemove)
  → counterRef.textContent = "N to add"/"N to remove"
  (0 React renders)
pointerup
  → collect .swept rows → uuids + direction          (1 render: dragging=false)
  → onCommit → skin maps to {toSprint|toBacklog} → page.commit
  → existing pocCommit: workItems.patch per uuid (Promise.allSettled) → refresh both trees
```

## 5. Commit + reconcile (reuse existing)
- The page's `pocCommit(delta)` is reused verbatim: PATCH `sprint_id` per uuid
  (`=<sprintId>` to add, `""` to remove), `Promise.allSettled`, then
  `pocSprintTree.refresh()` + `pocBacklogTree.refresh()` + page `refetch`, with
  success/partial-failure toasts. The realtime `pocRefetch` reconciliation and
  the cross-tree dedupe stay as-is.
- Only the *production of the delta* changes (DOM sweep, not boundary math).

## 6. Error handling
- **Partial PATCH failure:** unchanged — `Promise.allSettled` + verbatim toast.
- **No rows swept (click without drag):** `onPointerUp` finds zero swept rows →
  no commit, no-op. No phantom POST.
- **Pointercancel** (touch interrupt): clear swept classes, release capture,
  `dragging=false`, no commit. Self-heals.
- **Rows change under a sweep:** the snapshot is taken at pointerdown; a
  mid-sweep refetch can't happen during a synchronous pointer gesture, so the
  cached geometry is stable for the gesture's lifetime. Release reads the
  snapshot's uuids (stable), then refetch settles the new truth.

## 7. Testing
- **useSweepSelect unit:** simulate pointerdown→moves→up with injected row
  geometry; assert (a) correct swept uuids + direction down and up, (b) a
  no-drag click commits nothing, (c) a render-count spy proves zero renders
  between pointerdown and pointerup (the performance contract — this is the
  regression guard for the original bug).
- **Skin integration:** render with stub rows, sweep the handle down, assert
  `commit({toSprint:[...], toBacklog:[]})`; sweep up asserts the remove delta;
  empty-sprint hint hides on sweep start.
- **Columns:** assert the Sprint column header + a sprint row's alias render
  (guards the blank-column regression).

## 8. Constraints (unchanged)
- **No edits** to shared Grid primitives (`Grid__Tree*`, `useTree`,
  `useColumnManager`, `types`, `scopeTreeData`, `apiSite`, `PrefixBlockStripes`,
  `Grid__Tree_ActionBar`). Compose by import.
- Membership-only, commit-on-release, story/defect/risk clamp retained.
- The page mount stays additive (POC above the legacy panels).
- Work on `main` (user approved); NO new branch (per the no-branch HARD RULE).

## 9. What's deleted / changed
- DELETE: `useSprintBoundary.ts` + its test (per-move-state engine, the defect).
- DELETE: `Grid__SprintBoundary_Divider.tsx`'s capture-based drag → replaced by
  the sweep handle wired to `useSweepSelect` (the divider element/visual can be
  reused; its internal pointer-capture-drag logic is replaced).
- ADD: `useSweepSelect.ts` + test, sweep CSS (`-sweptAdd` green / `-sweptRemove`
  amber), container overflow fix.
- REWIRE: `Grid__SprintBoundary.tsx` to the sweep model; data-attrs on rows.

## 10. Open items to confirm during planning
1. Show-all-columns (overflow-x) vs drop Parent/Due — pick to make Sprint visible.
2. Whether `mapWire`'s `r.sprint` alias is populated for sprint-clamped rows.
3. Exact handle element to reuse from the current divider vs a fresh element.
