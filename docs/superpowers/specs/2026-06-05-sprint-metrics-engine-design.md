# Sprint metrics engine (ledger + on-demand projection) + live burndown chart

**Date:** 2026-06-05
**Status:** Design — awaiting review
**Page:** `/value-sprint-review` (first consumer)
**Origin:** Burndown chart design handoff (`MMFFDev - Vector Assets/Handoffs Claude Design/design_handoff_burndown_chart/`) escalated from "place a chart" to "build the real sprint-metrics engine first" during brainstorming.

## Engine, not chart logic — read this first

This spec builds a **shared, chart-agnostic sprint-metrics engine** that will be leaned on by many sprint charts (burndown first, then **burnup**, velocity, cumulative-flow, scope-churn). Two principles govern the whole design:

1. **Charts are dumb.** All metric logic lives in ONE place (the engine's projection). A chart collects already-derived numbers and draws them — it computes nothing. Burnup is the same engine model with a different line selected (`scope[d] − remaining[d]`); it needs **zero** new backend work.
2. **The engine is on-demand, not a daemon.** It does not run as a constant service or background worker. You load a page → the engine starts up → it fetches/replays the relevant sprint's ledger → returns the neutral model → done. It runs only when called (page load, 60s poll tick, realtime push, manual refresh). The only *passive* part is capture: ledger rows are appended as an ordinary insert inside the existing artefact write transaction — a side-effect, not a process.

**Reserved-word rule:** the ledger and engine **never** use the word `completed` for value. Vector already has a `completed` sprint-lifecycle state and a `done` flow kind. **Value is earned ONLY at `accepted`.** The earn event is `accepted`; its reversal is `unaccepted`. `completed`/`done`/`reopened` never appear as event names.

---

## 1. Problem & decision

The handoff asks for a sprint burndown chart (gradient actual line, re-based ideal, forecast cone, scope-change pin). The handoff's math (`reference/data.js`) is driven by a hardcoded per-day `accepted[]` array — points burned each day.

**That data does not exist in the backend.** The sprint wire (`useNextSprint` → `/timeboxes/sprints`) exposes `scope`, `velocity`, `estimate`, dates, status — but **no per-day burn history** and no daily-snapshot table. The work-items wire carries `story_points` / `rollup_points`, but only as a current value, with no history.

**Decision (user, 2026-06-05):** Do not fake the hero line. Build a real **event-sourced sprint ledger** that records the lifecycle of artefacts against a sprint — every load-in, take-out, acceptance, and reversal, stamped with date+time — and an **on-demand projection engine** that derives a neutral metrics model from it. Charts (burndown first, burnup next) are dumb consumers of that model. The model is fetched on a live feed (realtime push + 60s poll fallback + manual refresh).

This is the "PoC = real architecture, narrowly wired" principle: real event capture and a real shared engine, narrowly scoped to one page's charts to begin with — but built to be leaned on.

---

## 2. Value-earned semantics (authoritative — the correctness core)

These rules are non-negotiable and drive the capture logic:

1. **Only the parent (roll-up) flow state matters.** Children never emit burn events. Vector already derives parent flow state from children ("work flows UP" — `artefactitems/service.go`). The authoritative parent state is the single source of truth for value earned.
2. **Value is earned ONLY at `accepted`.** Vector flow states carry a canonical `flows_states_kind ∈ {backlog, todo, in_progress, done, accepted, cancelled}` (`flows/types.go:7`). Value burns down **only** when the parent crosses **into `kind = 'accepted'`**. Tenant-custom state *names* never matter — we key off `kind`.
3. **`done` and `completed` do NOT earn value.** Reaching `done` (flow kind) or `completed` (sprint lifecycle) burns nothing; **only `accepted` does.** These are distinct concepts and must never be conflated with value-earned. The ledger never uses the word `completed`.
4. **Value is reversible.** If a parent was `accepted` (points earned) and is pulled back to any other kind (`in_progress`, `todo`, `done`, …), the reward is **removed** — an **`unaccepted`** event restores the points and the burndown line goes back **up**. This is a real recorded reversal, not an edge case — it is the main reason an event ledger (not a daily snapshot) is the right substrate.

> **Capture rule, stated once:** emit `accepted` (burn points down) when the **parent** flow state transitions **into `kind=accepted`**; emit `unaccepted` (restore points, line goes up) when it transitions **out of `kind=accepted`**. Sprint membership changes (add/remove) adjust *scope*, not earned value.

---

## 3. Architecture — five layers

```
┌─ Migration 991 (vector_artefacts) ─────────────────────────────┐
│  sprint_burn_events  (append-only ledger)                      │
└────────────────────────────────────────────────────────────────┘
   ▲ append (same tx — passive side-effect, NOT a daemon)
   │                                  │ pg_notify('sprint_burn_changed', sprint_id)
┌──┴───────────────────────────┐     ▼
│ Capture: artefactitems/      │   ┌─ realtime/listener → hub.Publish(metricsTopic) ─┐
│ service.go before→after diff  │   └──────────────────────────────────────────────────┘
└──────────────────────────────┘     │
   │ replay ON DEMAND (no daemon)     │ push
   ▼                                  ▼
┌─ ENGINE: GET /_site/timeboxes/sprints/{id}/metrics ─┐  ┌─ useSprintMetrics(sprintId) ──┐
│  on-demand projection (no daemon, no cache):        │─▶│  SHARED hook: fetch +          │
│  replay ledger → NEUTRAL chart-agnostic model:      │  │  useRefetchOnPush + 60s poll + │
│  { window, scope[], remaining[], earned[],          │  │  refetch(). ONE source for ALL │
│    velocity, events[], scopeChanges[] }             │  │  sprint charts.                │
│  knows NOTHING of burndown/burnup/gradient/cone     │  └────────────────────────────────┘
└──────────────────────────────────────────────────────┘        │
                                                       ┌─────────┴──────────┐
                                                       ▼                    ▼
                                          ┌─ SprintBurndownChart ─┐ ┌─ SprintBurnupChart ─┐
                                          │ DUMB: draws            │ │ DUMB: draws          │
                                          │ remaining[] falling    │ │ earned[]/scope[]     │
                                          │ (handoff SVG)          │ │ rising (future)      │
                                          └────────────────────────┘ └──────────────────────┘
                                                       │ charts compute NOTHING — collect + draw
                                                       ▼
                                          <Panel "Sprint burndown"> above the sprint tree
                                          on app/(user)/value-sprint-review/page.tsx
```

**Lifecycle:** page mounts → `useSprintMetrics` calls the engine once → engine replays the ledger, returns the neutral model → charts render. Subsequent fetches happen only on realtime push, the 60s poll tick, or manual ↻. Nothing runs between fetches; the engine is not a standing service.

### Layer 1 — Substrate (migration 991, `vector_artefacts`)

Append-only event ledger. Immutable: rows are never updated or deleted. Column-prefixed per the hard rule.

```sql
CREATE TABLE sprint_burn_events (
  sprint_burn_events_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_burn_events_id_sprint     uuid NOT NULL,         -- FK timeboxes_sprints
  sprint_burn_events_id_artefact   uuid NOT NULL,         -- FK artefact_items
  sprint_burn_events_event_type    text NOT NULL,         -- added|removed|accepted|unaccepted|points_changed
  sprint_burn_events_points_delta  integer NOT NULL,      -- signed; effect on REMAINING
  sprint_burn_events_points_after  integer,               -- item points at event time (audit aid)
  sprint_burn_events_scope_delta   integer NOT NULL DEFAULT 0, -- signed; effect on SCOPE (add/remove only)
  sprint_burn_events_occurred_at   timestamptz NOT NULL DEFAULT now(),
  sprint_burn_events_id_actor      uuid,                  -- who triggered (nullable for system)
  sprint_burn_events_id_workspace  uuid NOT NULL          -- tenant clamp
);
CREATE INDEX idx_sprint_burn_events_sprint_time
  ON sprint_burn_events (sprint_burn_events_id_sprint, sprint_burn_events_occurred_at);
```

**Event taxonomy** (each row's effect on the two running totals — `scope` and `remaining`):

| event_type | Fires when | scope_delta | points_delta (remaining) |
|---|---|---|---|
| `added` | artefact's `sprint_id` set → this sprint | +points | +points (adds to remaining) |
| `removed` | artefact's `sprint_id` cleared / moved away | −points | −points if it was **unaccepted**; **0** if already accepted (points were already burned — only scope drops) |
| `accepted` | **parent** flow state crosses **into** `kind=accepted` | 0 | −points (burn down) |
| `unaccepted` | **parent** flow state crosses **out of** `kind=accepted` (to ANY other kind, incl. `done`) | 0 | +points (un-burn, line goes up) |
| `points_changed` | item's points change while in sprint | ±Δ | **0** if currently accepted (remaining already excludes it — only scope moves); ±Δ if unaccepted |

> **Scope vs. remaining are two independent running totals.** `scope` = total committed (moves on add/remove/points_changed). `remaining` = unearned work (moves on accept/reopen, and on add/remove/points_changed only while the item is unaccepted). An accepted item that is removed or re-pointed moves scope but NOT remaining — its value was already burned. Do not "simplify" these to one delta; the divergence is the whole point.

> The handoff's "+12" scope pin is literally an `added` event with `scope_delta=+12`. The day-5 up-tick is a real `unaccepted`/`points_changed` reversal. Nothing is scripted.

### Layer 2 — Capture (Go, IN the write transaction)

**Finding (verified):** `artefactitems/service.go` has a `diffWorkItem(before, after)` map (L116) that already contains before/after for `sprint_id`, `flow_state_id`, and `story_points`. BUT the existing seam that consumes it — `fireRuleHook` — runs **post-commit** (`CreateWorkItem`: Begin L970 → Commit L1168 → `fireRuleHook` L1190; `PatchWorkItem`: Commit → `fireRuleHook` L2001). Post-commit means a crash between commit and hook would **lose a burn event**, letting the ledger drift from reality.

**DECIDED (user, 2026-06-05): in-tx capture, correctness-first.** The ledger is an audit-grade record (defence/finance bar) and must never drop events. So the ledger append is injected **inside `CreateWorkItem` and `PatchWorkItem`, before their `Commit`**, using the tx handle and the before/after snapshots already in scope. NOT via the post-commit `fireRuleHook`. A helper `appendBurnEvents(ctx, tx, before, after, actorID)` is called just before each `tx.Commit(ctx)`; if it errors, the whole artefact write rolls back (atomic).

Logic in `appendBurnEvents`:
- `before.SprintID != after.SprintID` → `added` (null→X) or `removed` (X→null/Y).
- `before.FlowStateID != after.FlowStateID` **on the authoritative parent** → look up both state IDs' `flows_states_kind`; `after=accepted & before≠accepted` → `accepted`; `before=accepted & after≠accepted` → `unaccepted`. No event for any transition that doesn't cross the accepted boundary (so `done`↔`in_progress` emits nothing).
- `before.StoryPoints != after.StoryPoints` while `sprint_id` non-null → `points_changed`.

After `tx.Commit` succeeds, fire `pg_notify('sprint_burn_changed', <sprint_id>)` (post-commit is correct for the notify — it's only a wake-up, losing one is harmless; the next poll/refresh recovers).

**Parent-detection:** the event is evaluated only against the row whose flow state is authoritative (parent / leaf-without-children). Reuse the existing roll-up cascade guard (`service.go:1198+`, "flow state is derived from children, work flows UP"). Children that derive their state up do not emit.

### Layer 3 — The ENGINE: on-demand projection (Go endpoint)

`GET /_site/timeboxes/sprints/{id}/metrics` — the shared, chart-agnostic engine. **Not** named `/burndown`; burndown is just one consumer.

- **On-demand, no daemon, no cache.** Runs only when called (page load, poll, push, manual refresh). Each call replays the ledger fresh and returns. Nothing runs between calls.
- Sentinel-clamped: `sentinel.FromCtx(ctx)` + `sentinel.WorkspaceIDFromCtx(ctx)`, workspace-scoped, fail-closed (sentinel + server-is-the-gate hard rules).
- Replays `sprint_burn_events` for the sprint, ordered by `occurred_at`, bucketed by **day offset** within `[date_start, date_end]` → produces the **neutral model**:

```jsonc
{
  "window":       { "start": "…", "end": "…", "today": 7, "sprint_days": 10 },
  "scope":        [80, 80, 80, 80, 80, 92, 92, 92, …],   // committed per day
  "remaining":    [80, 76, 70, 62, 55, 62, 53, 44, …],   // unearned per day (incl. reversals)
  "earned":       [0, 4, 10, 18, 25, 30, 39, 48, …],     // scope − remaining (burnup reads THIS)
  "velocity":     7.67,                                    // mean accepted, last 3 days
  "scopeChanges": [{ "day": 5, "delta": 12 }],            // drives the +12 pin, generically
  "events":       [ /* raw ledger rows for the day, for tooltips/audit */ ]
}
```

- The engine emits **only neutral numbers** — no notion of burndown vs burnup, no gradient/cone/pin styling. `earned[]` is included precisely so a future burnup chart needs zero backend work.
- **DECIDED: the ideal guideline, forecast cone, and all date/offset derivations are computed ENGINE-SIDE** and returned in the model. Rationale (user, 2026-06-05): the sprint's dates and derived figures (day offsets, `today` index, days-left, the re-baseline day, projected-short) are needed by **other page consumers too** — report labels, KPI text, the panel header — not just the chart. Computing them once in the engine makes it the single source for "where are we in this sprint"; even non-chart UI reads from it, and a dumb chart never recomputes a date. The neutral model therefore also carries:

```jsonc
  "ideal":         [80, 72, 64, 56, 48, 40, 52, 41.6, …], // re-based guideline incl. break
  "idealOriginal": [80, 72, …, 0],                         // faint pre-change 80→0 line
  "cone":          { "optimistic": [44, 29.3, 14.7, 0],
                     "pessimistic": [44, 36.3, 28.7, 21] },
  "kpis":          { "committed": 92, "remaining": 44, "velocity": 7.67,
                     "daysLeft": 3, "onTrack": false, "projectedShort": 21 }
```

  The dumb chart's `buildBurndownView` then only maps these numbers to SVG paths (smoothing, gradient, dash patterns) — it shapes pixels, not metrics.

### Layer 4 — Shared frontend hook

`app/hooks/useSprintMetrics.ts` — the **single source for every sprint chart**:
- Fetches the neutral model via `apiSite` (engine starts up on first call — lazy).
- `useRefetchOnPush({ topic: metricsTopic(sprintId), refetch })` — **auto-refresh on any ledger write** (the user's preferred mechanism over polling). Topic shape mirrors `rankTopic`.
- 60s `setInterval` poll fallback.
- Exposes `refetch` for the manual ↻ button.
- Returns the neutral model untouched. Burndown, burnup, velocity, CFD all call this same hook.

### Layer 5 — DUMB charts + placement

**Charts compute nothing.** They take the neutral model and pick which numbers to draw.

- `app/components/charts/sprint/buildBurndownView.ts` — a **pure, tested** view-shaper that turns the neutral model into burndown draw-arrays (smoothed actual = `remaining[]`, ideal-with-break, forecast cone, scope pins, KPIs). This is the only place the handoff's `data.js` math lives. It is a pure function of the neutral model — no fetching, no state. (A future `buildBurnupView.ts` shapes the same model into rising `earned[]`/`scope[]` lines.)
- `app/components/SprintBurndownChart.tsx` — hand-built SVG per the handoff (gridlines, gradient area under the smoothed actual line, re-based ideal + faint original guideline, forecast cone band, scope pin, today line, open-circle markers, hover tooltip `--ink` bg / no shadow / 120ms fade / clamped, KPI strip, legend). Respects `prefers-reduced-motion`. Follows `ThroughputChart.tsx` structure + the `<chart>` Aperture draw-order rule (connectors/regions before dots; actual line + markers last). **It receives the neutral model + calls `buildBurndownView` — it owns drawing, not metrics.**
- **Colour tokens** added to `app/styles/primitives.css` as a themeable `--chart-*` band (no raw hex in the component, satisfying the `<chart>` no-hardcoded-hex rule while honouring the handoff's colour intent):
  `--chart-actual #E5392B`, `--chart-actual-fill-0/1`, `--chart-optimistic #2F7D54`, `--chart-pessimistic #B7791F`, `--chart-scope #2F5F8A`, `--chart-cone-band`, `--chart-scope-region`. Ink/border/axis use live tokens.
- Placed in a **new `<Panel title="Sprint burndown">`** between `<PageDescription>` and the existing sprint-backlog `<Panel>` on `value-sprint-review/page.tsx`, with a manual ↻ button. Reads `panelSprintId` (the page's already-resolved current sprint) → `useSprintMetrics(panelSprintId)` → `SprintBurndownChart`.

---

## 4. Where the handoff math lives + tests

The handoff's `data.js → build()` derivation moves **into the Go engine** (`sprintmetrics`), because ideal/cone/KPIs/dates are computed engine-side (§Layer 3 decision). The split:

- **`backend/internal/sprintmetrics/` (Go)** — owns the derivation: replay ledger → bucket by day → ideal-with-break, forecast cone, KPIs, `onTrack`/`projectedShort`, all date offsets. **Table-driven Go test** pins the handoff reference dataset against a synthetic ledger: `remaining[7]=44`, `velocity≈7.67`, `projectedShort≈21`, ideal break at `52`, scope `80→92` at the scope day, day-5 up-tick `62`. This is the authoritative contract test — the part every chart and label depends on. (Defence/finance "pin the contract" bar.)
- **`app/components/charts/sprint/buildBurndownView.ts` (TS)** — a thin, pure **pixel-shaper**: maps the engine's already-derived `remaining[]`/`ideal[]`/`cone`/`scopeChanges` to SVG path strings (Catmull-Rom smoothing, gradient stops, dash arrays, marker positions). No metrics math. `buildBurndownView.test.ts` pins the path geometry (e.g. plot insets, day→x / val→y mapping, the break produces two path segments), not the numbers.

---

## 5. Realtime auto-refresh path (confirmed available)

`append ledger row → pg_notify('sprint_burn_changed', sprint_id) → realtime/listener.go → hub.Publish(metricsTopic) → useRefetchOnPush on the page → useSprintMetrics.refetch() → every sprint chart re-renders`. This is the same proven channel that drives the sprint tree (search outbox + notifications v2 both use it). 60s poll + manual ↻ are fallbacks.

---

## 6. Honest caveats (written into the build)

1. **No historical backfill.** The ledger only knows events from the moment it ships. Sprints already in flight start populating their burndown from deploy day forward; their pre-deploy history is absent. Inherent to event-sourcing without backfill; acceptable for a PoC (real go-forward truth > faked history). A future backfill could reconstruct partial history from the existing audit log if flow-state transitions are timestamped there — out of scope here.
2. **Day bucketing assumes the sprint date window is set.** Sprints with null `date_start`/`date_end` can't bucket by day; the chart shows an empty/"no window" state rather than guessing.
3. **Parent-detection predicate** is reused from the existing roll-up cascade; if that logic changes, the capture filter must track it. Noted as a coupling point.

---

## 7. Files touched

**New — the engine (shared, reused by future charts):**
- `dev/migrations/991_*.sql` (via `<migration>` skill) — `sprint_burn_events` ledger
- `backend/internal/sprintmetrics/` — **DECIDED: its own package** (not folded into `timeboxsprints`). The engine: on-demand projection service + `/metrics` read handler + the ideal/cone/KPI/date derivations + Go replay test. A standalone package because it's the shared substrate many charts and page labels will depend on.
- `app/hooks/useSprintMetrics.ts` — shared hook, one source for all sprint charts

**New — the first dumb chart:**
- `app/components/charts/sprint/buildBurndownView.ts` + `buildBurndownView.test.ts` — pure view-shaper (handoff math)
- `app/components/SprintBurndownChart.tsx` — dumb SVG renderer

**Edited:**
- `backend/internal/artefactitems/service.go` — ledger append in the before→after diff (capture)
- `backend/cmd/server/main.go` — wire the engine service/route (+ pg_notify listener topic if needed)
- `app/styles/primitives.css` — `--chart-*` token band
- `app/(user)/value-sprint-review/page.tsx` — new Panel + chart + hook
- `app/lib/apiSite.ts` — `/metrics` endpoint client

---

## 8. Out of scope (but the engine is built to enable these cheaply)

- **Burnup chart** — deliberately NOT built here, but the engine's `earned[]`/`scope[]` arrays mean it's a dumb-chart-only addition later (no backend work). This is the proof the engine/chart split paid off.
- Velocity / cumulative-flow / scope-churn charts — same: future dumb consumers of the same `/metrics` model.
- The other gallery treatments; the series filter chip bar (handoff makes it optional for a single card).
- Historical backfill of pre-deploy events.
- Multi-sprint / portfolio aggregation.
