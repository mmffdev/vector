# Task-count Burndown — design

**Date:** 2026-06-06
**Page:** `/value-sprint-review`
**Status:** approved, pending implementation plan

## Problem & framing

The existing sprint burndown is the **Product Owner's view**: it measures
*story-tier* work (Story / Defect / Risk) in **story points**, and value is
earned only when the PO **accepts** the work (flow kind `accepted`). In Scrum
terms — taught by the product owner here as an agile coach — **the story is the
problem, owned by the product team.**

This design adds a second, parallel burndown: the **engineering team's view**.
It measures **tasks** by **count** (not points), and a task is burned when the
**engineer marks it `done`** — not when a PO accepts anything. **The task is the
solution, owned by the doers** (engineers, UX, QA). The two charts mirror the
ownership boundary: PO-owned stories vs team-owned tasks, accepted vs done.

> 100 tasks committed, 50 done = halfway, plotted over the sprint window.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Task population | Tasks **inherit** sprint membership from their parent story. A task is "in the sprint" iff its parent story is. |
| "Done" semantics | Terminal **`done`** kind (engineer-owned). NOT `accepted` (PO-owned, story-level). Flow vocab confirmed: `backlog → todo → in_progress → done → accepted`. |
| Metric | Task **count**. Committed = total tasks; Completed = tasks done; Remaining = total − done. |
| KPI strip | **Total · Completed · Remaining · Days-left**. No velocity. |
| Chart elements | Keep **ideal line + forecast cone (optimistic/pessimistic) + on-track pill** — full parity with the story chart minus the velocity KPI. |
| Backend shape | **Fully standalone sibling package** `taskmetrics` — complete copy of the `sprintmetrics` engine, count-flavoured. Zero shared code. Maximum isolation; accepted duplication (see TD below). |
| Emission | **Full event path**: new ledger table + done-crossing emission wired into the artefact write tx + a one-shot backfill. |
| Membership move | A task's sprint follows its parent story **live**. When a story moves sprints, its done/undone task counts move with it. |
| Layout | Story burndown + Task burndown **side by side, 50% each**, one band. Stack on narrow viewports. |

## Architecture

### Backend — `backend/internal/taskmetrics/` (standalone sibling)

A complete, isolated copy of `sprintmetrics`, count-flavoured. It shares **no
code** with the live story engine — by explicit choice, so the live PO chart
cannot be affected by task-chart changes.

- **`types.go`** — `TaskBurnEvent`, `Window` (reused shape), `Model`, `KPIs`.
  `KPIs` drops `Velocity`/`Committed`-as-points and carries
  `Total int`, `Completed int`, `Remaining int`, `DaysLeft int`,
  `OnTrack bool`, `ProjectedShort int`. `Model` keeps `Scope` (total-count per
  day), `Remaining` (count per day; `-1` sentinel past today), `Earned`
  (completed count per day), `IdealA/IdealB/IdealOriginal`, `Cone`,
  `ScopeChanges`. Event-type constants: `EventAdded`, `EventRemoved`,
  `EventDone`, `EventUndone`. (No `points_changed` — a task has no points; a
  task's "size" is always 1.)
- **`ledger.go`** — `TaskDelta` + `DeriveTaskEvents`. The pure decision core:
  - Gate: only `IsTaskUnit` (slot `wrk_task`) emits.
  - Membership change (before/after **effective** sprint, where effective =
    parent story's sprint): added → `+1` scope & `+1` remaining; removed → `−1`
    scope, and `−1` remaining **unless already done** (done tasks already
    excluded from remaining); sprint-to-sprint move → removal from old + add to
    new, both ledgers consistent.
  - `done` crossing (same sprint): into `done` → `EventDone`, `−1` remaining;
    out of `done` → `EventUndone`, `+1` remaining.
  - `AppendTaskEvents(ctx, tx, delta, actor, ws)` inserts inside the caller's tx.
- **`projection.go`** — `Project(ProjectInput) Model`. A **copy** of the
  `sprintmetrics` replay: bucket events by day-offset, accumulate scope &
  remaining, compute earned (completed) = scope − remaining for actual days,
  ideal guidelines (base = total at day 0, straight line to 0, re-based on the
  last scope change), forecast cone from the recent completion rate, KPIs.
  Identical math, count units, terminal kind `done`.
- **`service.go`** — `Metrics(ctx, sprintID, wsID)`: read window from
  `timeboxes_sprints`, replay `task_burn_events`, project. No cache (matches
  sprintmetrics).
- **`sql.go`** — `task_burn_events` reads + window read + insert.
- **`handler.go`** — `GET /_site/timeboxes/sprints/{id}/task-metrics`,
  sentinel-clamped, fail-closed (401 on no clamp, 400 on bad id, 500 on
  projection error) — identical shape to the sprintmetrics handler.
- **wiring** — `NewService(vaPool)` in `backend/cmd/server/main.go`; route
  mounted beside `/metrics`.

### Migration — `task_burn_events`

New table mirroring `sprint_burn_events`, every column fully table-name-prefixed
(hard rule). Columns:
`task_burn_events_id` (PK), `task_burn_events_id_sprint`,
`task_burn_events_id_artefact`, `task_burn_events_event_type`
(CHECK in `added,removed,done,undone`), `task_burn_events_remaining_delta`,
`task_burn_events_scope_delta`, `task_burn_events_id_actor`,
`task_burn_events_id_workspace`, `task_burn_events_occurred_at` (default now()).
Indexes on `(_id_sprint, _id_workspace)` for the replay read.

### Emission wiring — `artefactitems/service.go`

In the **same in-tx block** (~service.go:2049) that already derives
`sprintmetrics.ArtefactDelta` for story-tier writes, add a parallel branch:

- Gate on `slot == SlotTask`.
- Resolve the task's **effective sprint** = parent story's `sprint_id`, read
  in-tx (so it sees this tx's writes). Before/after effective sprint drives the
  membership events; before/after kind (already resolved via
  `flowKindByStateID`) drives the done/undone crossing.
- Build `taskmetrics.TaskDelta` and call `taskmetrics.AppendTaskEvents` in the
  same transaction — the ledger can never drift from the artefact write.
- The **create path** gets the same hook (a task created directly into a story
  that's in a sprint is "added").
- A story moving sprints cascades to its tasks: when a story-tier write changes
  the story's sprint, re-derive task membership events for its task children
  in-tx (this is what makes membership follow the parent **live**).

### Backfill

One-shot (dev script + `<remove>`/devtools-style action) seeding
`task_burn_events` from current task state: for every task whose parent story is
in a sprint, emit an `added` at sprint start and a `done` at the task's
done-crossing date (best-effort from flow history; fall back to sprint start).
Mirrors the 16-event story backfill done on 2026-06-06.

### Frontend

- **`app/components/charts/sprint/buildTaskBurndownView.ts`** — standalone copy
  of `buildBurndownView` (same `VB` viewbox, count geometry). Same null-coalesce
  guards (Go nil-slice → JSON `null`).
- **`app/components/TaskBurndownChart.tsx`** — copy of `SprintBurndownChart`.
  KPI strip = **Total · Completed · Remaining · Days-left**. Keeps cone + ideal
  + on-track pill. Legend keeps "Scope change" only when task scope pins exist.
  Dumb SVG, all `--chart-*`/`--ink`/`--surface` tokens (no colour literals).
- **`app/hooks/useTaskMetrics.ts`** — sibling of `useSprintMetrics` hitting
  `/task-metrics`, same rank-topic subscription + 60s poll + manual refetch.
- **apiSite** — `app/lib/apiSite/taskMetrics.ts` client + `TaskMetricsModel`
  type; export from the apiSite index.

### Layout — `/value-sprint-review/page.tsx`

Wrap the two burndown panels in a flex row, each `flex: 1` (50%). Story left,
tasks right. The existing burndown panel becomes half-width; the new task panel
fills the other half. Responsive: column-stack below a breakpoint. New CSS in
`app/globals.css` under a `value-sprint-review__burndown-row` block (catalog
class first per the CSS guide — no inline styles). The page fetches both
`useSprintMetrics` and `useTaskMetrics` for `panelSprintId`; `refreshMetrics`
refetches both.

## Tech debt

**`TD-TASKMETRICS-DUP-PROJECTION`** (S2) — the replay math (ideal line, forecast
cone, KPI derivation, scope-change re-basing) now exists in **two standalone
copies**: `sprintmetrics/projection.go` and `taskmetrics/projection.go`. This is
a deliberate isolation choice (the live PO chart must be untouchable by
task-chart work). **Trigger to pay down:** the moment a cone/ideal/KPI bug is
fixed in one copy, or a third count-metric chart is requested — at that point
extract a shared pure `burnmodel.Project(events, window, opts) Model` package
both siblings call, keeping the ledger/emission/SQL paths isolated. Until then
the duplication is logged, not hidden.

## Testing

- `taskmetrics/projection_test.go` — table tests for `Project` (mirroring the
  sprintmetrics tests): empty, on-track, behind, mid-sprint scope change, all
  done.
- `taskmetrics/ledger_test.go` — `DeriveTaskEvents` crossings: added (+1),
  removed (−1), removed-while-done (scope −1, remaining 0), sprint-to-sprint
  move, done (+done/−remaining), undone (reverse).
- Emission integration — a task done-crossing appends `done`; story moving
  sprints cascades task membership events.
- `buildTaskBurndownView` geometry test — actual/ideal/cone path strings for a
  known model.

## Out of scope

- Sharing the projection math (deferred to TD trigger above).
- Task-level points (tasks are count-only, size always 1).
- Per-assignee task breakdown / WIP limits (future).
