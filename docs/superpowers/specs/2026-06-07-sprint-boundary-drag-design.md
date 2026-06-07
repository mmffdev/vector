# Sprint Boundary-Drag — Design Spec

**Date:** 2026-06-07
**Status:** Draft — awaiting user review
**Author:** Claude (brainstormed with Rick)
**Surface:** `/value-sprint` (`app/(user)/value-sprint/page.tsx`)
**Component home:** `app/components/Grid/`

---

## 1. Purpose

Replicate Jira's **movable sprint-boundary** interaction in Vector: a single
continuous list of work items where a draggable divider separates "in the
sprint" (above the line) from "in the backlog" (below the line). Dragging the
divider **down** sweeps backlog rows into the sprint; dragging **up** pushes
sprint rows back to the backlog. The live counter on the divider updates as you
drag; membership commits on release.

Reference captured live from the user's Jira (SCRM board 101): the divider is
`software-backlog.card-list.divider.container` with a `row-resize` grip; dragging
it past N rows moved the "N of N work items visible" counter and reassigned
sprint membership on drop.

## 2. Scope & intent (decisions locked in brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| **Interaction model** | True Jira — one continuous list, movable divider | User wants the faithful pattern, not a sweep-select on the existing panels. |
| **Commit model** | **Membership only** — set `sprint_id` | Reuses the existing column (`artefacts_id_timebox_sprint`) + existing `workItems.patch` path. No rank-scope reconciliation. Order within each section is unchanged. |
| **Commit timing** | **On release only** | Live counter + tint while dragging are pure UI (zero network); a single batch of PATCHes fires on mouse-up. Jira feel, lightest server load, clean rollback. |
| **Page placement** | **POC mounted ABOVE the existing two panels** | User: "it's a POC … we'll never have both." The continuous-list build is evaluated live next to the legacy panels, then replaces them later (out of scope here). |
| **Legacy panels while POC up** | **Left fully editable** | No read-only plumbing. Both write `sprint_id`; the page's existing `useRefetchOnPush` reconciles drift on the next rank-topic push. |
| **Build seam** | **New sibling skin** in `app/components/Grid/`, reusing `useTree` + `Grid__Tree_Row` + `Grid__Tree_Head` + `useColumnManager` by composition | **HARD CONSTRAINT: `Grid__Tree.tsx` and all shared Grid files are NOT modified.** They are imported, never edited. Other consumers (`GridSprintReview`, `GridExecution`, `GridWorkItems`, `scope`, `DataContainer`) are unaffected. |
| **Drag feedback (visual)** | **Default: tint territory above + live counter + glowing frontier line** (companion option C) | Matches the award-bar design ethos. Dial-back-able; does not affect architecture. User deferred the final pick ("just build it") — flagged as a tunable. |
| **Resting divider** | **Default: subtle at rest, blooms on hover/drag** | Calm when idle, expressive in motion. Tunable. |

### Out of scope (explicitly)
- Retiring/replacing the legacy two panels (the "soon" step — separate task).
- A backend `set_sprint` bulk op (see §7 tech debt — POC uses parallel per-row PATCH).
- Rank/position persistence across the boundary (membership-only by decision).
- Task-tier rows (sprint planning is story/defect/risk granularity, matching the
  existing page's `ALLOWED_SLOTS`).

## 3. Architecture

### 3.1 Reuse seam (verified)

`Grid__Tree_Row` is a **pure presentation component** — props only (`node`,
`columns`, `gridTemplateColumns`, `primaryColumnIndex`, `leadControls`,
`selected`, `onSelect`, `accent`, …), no context reads, owns no tree logic
(verified in `app/components/Grid/Grid__Tree_Row.tsx`). `Grid__Tree_Head` and
`useColumnManager` are likewise independently exported. The new skin drives these
directly. **No edit to any shared file is required.**

### 3.2 New files (all additive, under `app/components/Grid/`)

```
app/components/Grid/
  Grid__Tree.tsx                       ← UNTOUCHED (and all its siblings)
  Grid__Tree_Row.tsx                   ← reused via import
  Grid__Tree_Head.tsx                  ← reused via import
  useColumnManager.ts                  ← reused via import
  useTree.ts                           ← reused via import (two instances)
  types.ts                             ← reused via import

  Grid__SprintBoundary.tsx             ← NEW · the skin: head + continuous body + divider
  Grid__SprintBoundary_Divider.tsx     ← NEW · the draggable divider (grip, counter, frontier)
  useSprintBoundary.ts                 ← NEW · drag math + boundary state + commit-on-drop delta
  sprintBoundaryTreeData.ts            ← NEW · fetchRoots with filters.sprintId clamp;
                                              reuses exported mapWire + ScopeNode (no shared edit)
  __tests__/useSprintBoundary.test.ts  ← NEW · unit tests for the boundary math + delta
  __tests__/Grid__SprintBoundary.test.tsx ← NEW · render + drag-commit integration
```

### 3.3 Data flow

```
              ┌──────────── Grid__SprintBoundary ────────────┐
              │                                              │
  useTree(sprint clamp)   ──► sprintNodes ─┐                 │
   sprint_id=<panelSprintId>               │                 │
                                           ├─► one rendered  │
  useTree(backlog clamp)  ──► backlogNodes ┘   continuous    │
   sprint_id=__none__                          list, divider │
                                               injected at    │
                                               the boundary   │
              │                                              │
              │  useSprintBoundary(sprintNodes, backlogNodes)│
              │    • boundaryIndex (UI state, live)          │
              │    • dragging flag                           │
              │    • computeDelta() on release →             │
              │        { toSprint:[ids], toBacklog:[ids] }   │
              └──────────────────────────────────────────────┘
                                   │ on release
                                   ▼
            parallel workItems.patch(id, {sprint_id}) via Promise.allSettled
                                   │
                                   ▼
            refetch both useTree instances + refetchNextSprint (page-owned)
```

### 3.5 Verified live wiring (the POC must reuse these verbatim)

Grounded in the working two-grid layout (`GridWorkItems` + `scopeTreeData.ts`):

- **Clamp is a real, supported filter.** `WorkItemQueryBody.filters.sprintId`
  exists (`app/lib/apiSite/index.ts:70`) — `"<uuid>"` or `"__none__"` for
  unassigned. Both POC sections query through the **same audited POST gateway**
  `workItems.query` that `GridWorkItems` uses — no new endpoint.
- **Shared data layer can't carry the clamp, so the POC gets its own.**
  `queryFilters()` in `scopeTreeData.ts` maps only type/status/priority/owner
  (its `ScopeTreeFilters = WorkItemsFilters`), and that file is shared by
  `/scope`, `/work-items`, `/value-sprint-review` — **editing it is forbidden by
  the constraint.** The POC adds `app/components/Grid/sprintBoundaryTreeData.ts`
  that reuses the **exported `mapWire`** + `ScopeNode` shape but builds a body
  with `filters.sprintId`. Reuse without mutation.
- **useTree pattern mirrored.** Two instances, each like `GridWorkItems`'
  `useTreeScope(autoLoad, filters)`: `fetchRoots → workItems.query({page,filters})`,
  `pageSize:100`, `rowIdOf: r => r.id`, `getChildrenCount: r => r.childrenCount`,
  `expandable: true`. Sprint instance clamps `sprintId=<panelSprintId>`; backlog
  instance clamps `sprintId="__none__"`.
- **Sprint id is already resolved on the page.** Reuse the page's existing
  `panelSprintId` (`useNextSprint` + `panelSprintIdOverride`) — the POC does not
  re-derive "which sprint."
- **Commit path is the existing patch, keyed by `uuid` (not display `id`).**
  `workItems.patch(row.uuid, { sprint_id })` — exactly `assignToSprint`'s call.
  Batch via `Promise.allSettled`, partial-failure toast via `notify` (mirrors
  `assignManyToSprint`). `sprint_id: ""` removes (backend convention).
- **Refetch + realtime reconciliation.** `tree.refresh()` on each instance after
  commit, plus `useRefetchOnPush({ topic: rankTopic("work_item", tenantId,
  "backlog", null), refetch })` so a legacy-panel edit below refetches the POC
  (and vice-versa) — the drift papered over for the "both editable" decision.
- **Row accent for the tint** comes from `ScopeNode.colour` already mapped by
  `mapWire`; the "in-sprint tint" is the skin applying the sprint accent above
  the divider, not a new data field.

The earlier plan to "reuse the resolved wizard URLs" is superseded: the page's
existing trees are **ObjectTreeV2**, not the Grid primitive, so their URL config
isn't reusable here. The POC reuses the **Grid** stack (`useTree` + `mapWire` +
`ScopeNode` + `makeScopeColumns`) instead — the proven `GridWorkItems` path.

### 3.4 The boundary as a rendered position, not a stored field

The divider's `boundaryIndex` is **UI-only state** during a drag. The underlying
truth is still `sprint_id`. On release:
1. `computeDelta()` diffs the post-drag boundary against the original split:
   rows that ended up above the line but were in the backlog → `toSprint`;
   rows below the line that were in the sprint → `toBacklog`.
2. Fire `workItems.patch(id, { sprint_id })` for each delta row in parallel.
3. Toast success/partial-failure (mirrors the page's existing `assignManyToSprint`).
4. Refetch both lists; realtime push reconciles the legacy panels below.

If the page is mid-fetch or a patch rejects, the optimistic boundary snaps back
to the server truth on refetch — no half-committed visual state persists.

## 4. Component responsibilities (isolation)

- **`useSprintBoundary`** — *what it does:* owns `boundaryIndex`, `dragging`, the
  pointer math (px → row index via row refs / `row-resize` pointer events), and
  `computeDelta()`. *Depends on:* the two node arrays + a `commit(delta)` callback.
  *Testable headless* — no DOM beyond row offsets injected as numbers.
- **`Grid__SprintBoundary_Divider`** — *what it does:* renders the grip + live
  counter + frontier line; emits pointer-down/move/up to the hook. *Depends on:*
  hook state + counter text. Pure presentation.
- **`Grid__SprintBoundary`** — *what it does:* composes `useColumnManager` +
  `Grid__Tree_Head` + a flat map of `Grid__Tree_Row` (sprint rows, divider,
  backlog rows) + tint accents above the line. *Depends on:* two `useTree`
  results + the hook + the page's `commit` callback.
- **Page (`value-sprint/page.tsx`)** — *what it does:* mounts the POC above the
  existing `<Panel>`s, wires the two clamps it already builds, provides the
  `commit` callback (thin wrapper over the existing patch/refetch), leaves the
  legacy panels untouched below. *Minimal page edit — additive only.*

## 5. Error handling

- **Patch failure (some/all):** `Promise.allSettled`; toast verbatim API error
  (server stays the gate). Partial failure is reported honestly
  ("Updated X of Y — Z failed"), boundary re-syncs to server truth on refetch.
- **No sprint loaded:** divider is inert / hidden; the POC shows the backlog list
  with an empty sprint section and a "no sprint in focus" affordance (reuses
  `panelSprint` null-state semantics already on the page).
- **Drag past list ends:** clamp `boundaryIndex` to `[0, total]`; can't drag the
  divider above the first row or below the last.
- **Concurrent edit from legacy panel:** realtime `useRefetchOnPush` already wired
  on the page refetches both POC lists; last-write-wins on `sprint_id`, consistent
  with the rest of Vector.

## 6. Testing

- **`useSprintBoundary` unit:** boundary clamp, `computeDelta` for down-drag (rows
  enter sprint), up-drag (rows leave), no-op drag (empty delta), drag-past-ends.
- **`Grid__SprintBoundary` integration:** render with stub nodes, simulate a
  pointer drag of the divider, assert the correct `commit({toSprint,toBacklog})`
  payload and that no shared Grid file is imported-and-mutated (structural).
- **Regression guard:** a test asserting `Grid__Tree.tsx` is byte-unchanged is
  overkill; instead the PR diff must show zero edits to shared Grid files (review
  gate). Existing `Grid__Tree` tests must still pass untouched.

## 7. Tech debt / follow-ups

- **TD-SPRINT-BULK-OP** (S3): commit-on-drop fires N parallel per-row PATCHes
  because `BulkOps` (artefactitems/service.go) supports `set_priority/set_owner/
  archive/set_flow_state/set_status` but **not** `set_sprint`. *Trigger:* a sweep
  routinely crosses >~10 rows, or server load from per-row PATCH shows up. *Pay-down:*
  add a `set_sprint` op to `BulkOps` + a `workItems.bulk` caller, swap the
  `Promise.allSettled` loop for one round-trip.
- **TD-SPRINT-POC-RETIRE** (S2): the POC and legacy panels both edit `sprint_id`
  on one screen. *Trigger:* POC accepted. *Pay-down:* retire the two `<Panel>`s
  from `/value-sprint`, promote `Grid__SprintBoundary` to the page body.

## 8. Open visual tunables (do not block build)

1. Drag feedback: defaulting to **tint + counter + glowing frontier** (option C).
2. Resting divider: defaulting to **subtle-at-rest, blooms-on-hover**.

Both are CSS/skin-level and changeable without touching the architecture.
