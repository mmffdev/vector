# Task-count Burndown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a task-count burndown (engineering-team view) beside the existing story-points burndown (PO view) on `/value-sprint-review`, driven by a standalone `taskmetrics` backend engine.

**Architecture:** A fully-standalone sibling of `sprintmetrics` (`backend/internal/taskmetrics/`) replays a new append-only `task_burn_events` ledger into a count-based chart model. Tasks inherit sprint membership from their parent story; a task is burned when the engineer crosses it into the `done` flow kind (not the PO's `accepted`). The frontend copies the dumb-SVG chart + geometry shaper, count-flavoured, and the page lays the two charts side-by-side at 50% each.

**Tech Stack:** Go (pgx, chi, sentinel middleware), Postgres (`vector_artefacts` / vaPool), TypeScript/React (Next.js app router, apiSite client, SVG charts, CSS tokens in `app/globals.css`).

**Reference files (copy from, do not import):**
- `backend/internal/sprintmetrics/{types,ledger,projection,service,sql,handler}.go` + their `_test.go`
- `app/components/SprintBurndownChart.tsx`, `app/components/charts/sprint/buildBurndownView.ts`
- `app/lib/apiSite/sprintMetrics.ts`, `app/hooks/useSprintMetrics.ts`

**Conventions (hard rules):**
- Every column is `<table_name>_<column>` prefixed.
- `git diff --cached --stat` before every commit; unstage anything unrelated.
- Backend env is pinned to `dev`. Never switch.
- Run `go build ./...` and `go test ./internal/taskmetrics/...` from `backend/`.

---

## Task 1: Migration — `task_burn_events` table

**Files:**
- Create: `db/vector_artefacts/schema/178_task_burn_events.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 178_task_burn_events.sql
--
-- Append-only event ledger for the TASK-count burndown
-- (engineering-team view). Records task lifecycle events
-- (added / removed / done / undone) against sprints, with a
-- remaining-count delta and a scope-count delta. A task's "size"
-- is always 1 — this ledger counts tasks, it does not weigh them.
--
-- WHY:
--   Sibling of sprint_burn_events (177). The task burndown is a
--   standalone engine (backend/internal/taskmetrics) replaying THIS
--   ledger. Tasks inherit sprint membership from their parent story;
--   a task burns at the engineer-owned "done" kind, NOT the
--   PO-owned "accepted" kind that drives sprint_burn_events.
--
-- IDEMPOTENCY:
--   CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- ROLLBACK:
--   Forward-only — drop task_burn_events manually if needed.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS task_burn_events (
  task_burn_events_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_burn_events_id_sprint        uuid NOT NULL,
  task_burn_events_id_artefact      uuid NOT NULL,
  task_burn_events_event_type       text NOT NULL
    CHECK (task_burn_events_event_type IN
      ('added','removed','done','undone')),
  task_burn_events_remaining_delta  integer NOT NULL DEFAULT 0,
  task_burn_events_scope_delta      integer NOT NULL DEFAULT 0,
  task_burn_events_occurred_at      timestamptz NOT NULL DEFAULT now(),
  task_burn_events_id_actor         uuid,
  task_burn_events_id_workspace     uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_burn_events_sprint_time
  ON task_burn_events (task_burn_events_id_sprint, task_burn_events_occurred_at);

COMMIT;
```

- [ ] **Step 2: Apply the migration via the `<migration>` skill**

Invoke the `migration` skill targeting `vector_artefacts`, pointing at `db/vector_artefacts/schema/178_task_burn_events.sql`. It dry-runs, applies, and verifies `schema_migrations`. Confirm the table exists:

Run: `psql -d vector_artefacts -c "\d task_burn_events"`
Expected: table with the 9 columns above, the CHECK constraint, and the index.

- [ ] **Step 3: Commit**

```bash
git add db/vector_artefacts/schema/178_task_burn_events.sql
git diff --cached --stat
git commit -m "feat(taskmetrics): task_burn_events ledger table (mig 178)"
```

---

## Task 2: `taskmetrics` types

**Files:**
- Create: `backend/internal/taskmetrics/types.go`

- [ ] **Step 1: Write the types**

```go
// Package taskmetrics is the standalone, on-demand projection engine for the
// TASK-count burndown (the engineering-team view). It is a deliberate,
// fully-isolated COPY of the sprintmetrics engine — see
// TD-TASKMETRICS-DUP-PROJECTION in docs/c_tech_debt.md. It shares no code with
// sprintmetrics so the live PO story chart can never be affected by task-chart
// changes.
//
// It replays the append-only task_burn_events ledger into a neutral, count-based
// model whenever asked — NO daemon, NO worker, NO cache. Every call re-reads and
// recomputes from scratch.
//
// Value semantics: a task is "done" at the engineer-owned terminal flow kind
// "done". The word "accepted" is deliberately absent — PO acceptance is a
// story-level concern (sprintmetrics), not a task-level one.
package taskmetrics

// Event-type string constants, matching the CHECK on
// task_burn_events_event_type in migration 178.
const (
	EventAdded   = "added"
	EventRemoved = "removed"
	EventDone    = "done"
	EventUndone  = "undone"
)

// kindDone is the single flow kind at which a task is burned. Leaving it
// restores the count. Flow vocab: backlog -> todo -> in_progress -> done ->
// accepted; "done" is the engineer's terminal, "accepted" is the PO's.
const kindDone = "done"

// TaskBurnEvent is one row of the replayed ledger, normalised for projection.
// OccurredAt is a "YYYY-MM-DD" date string. Deltas are COUNTS (a task is size 1).
type TaskBurnEvent struct {
	ArtefactID     string `json:"artefact_id"`
	EventType      string `json:"event_type"`
	RemainingDelta int    `json:"remaining_delta"`
	ScopeDelta     int    `json:"scope_delta"`
	OccurredAt     string `json:"occurred_at"`
}

// Window describes the sprint's calendar span and where "now" sits within it.
type Window struct {
	Start      string `json:"start"`
	End        string `json:"end"`
	Today      int    `json:"today"`
	SprintDays int    `json:"sprint_days"`
}

// ScopeChange records a mid-sprint task-count change (tasks added/removed).
type ScopeChange struct {
	Day   int `json:"day"`
	Delta int `json:"delta"`
}

// Cone is the forecast envelope between optimistic and pessimistic finishes.
type Cone struct {
	Optimistic  []float64 `json:"optimistic"`
	Pessimistic []float64 `json:"pessimistic"`
}

// KPIs is the at-a-glance scoreboard. No velocity (engineering-team view).
type KPIs struct {
	Total          int  `json:"total"`     // committed task count
	Completed      int  `json:"completed"` // tasks done
	Remaining      int  `json:"remaining"` // total - completed
	DaysLeft       int  `json:"days_left"`
	OnTrack        bool `json:"on_track"`
	ProjectedShort int  `json:"projected_short"`
}

// Model is the neutral, count-based projection result.
type Model struct {
	Window Window `json:"window"`

	// Scope is committed task count per day, index 0..SprintDays.
	Scope []float64 `json:"scope"`

	// Remaining is not-yet-done count per day. Days past `today` carry the
	// sentinel -1 ("no actual value").
	Remaining []float64 `json:"remaining"`

	// Earned is completed count (scope - remaining) for days 0..today.
	Earned []float64 `json:"earned"`

	IdealA        []float64     `json:"ideal_a"`
	IdealB        []float64     `json:"ideal_b"`
	IdealOriginal []float64     `json:"ideal_original"`
	Cone          Cone          `json:"cone"`
	Rate          float64       `json:"rate"` // mean daily completion over last 3 days
	ScopeChanges  []ScopeChange `json:"scope_changes"`
	KPIs          KPIs          `json:"kpis"`
}
```

- [ ] **Step 2: Verify it compiles**

Run (from `backend/`): `go build ./internal/taskmetrics/...`
Expected: success (no other files yet, package compiles).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/taskmetrics/types.go
git diff --cached --stat
git commit -m "feat(taskmetrics): neutral count-based model + types"
```

---

## Task 3: `taskmetrics` projection (pure replay) — TDD

**Files:**
- Create: `backend/internal/taskmetrics/projection.go`
- Test: `backend/internal/taskmetrics/projection_test.go`

- [ ] **Step 1: Write the failing test**

```go
package taskmetrics

import (
	"math"
	"testing"
)

// TestProjectTaskReference pins a canonical task-count dataset. 20 tasks
// committed at day 0; engineers complete [_,2,3,4,3,2,4,5] over days 1..7
// (today=7); +4 tasks added mid-sprint on day 5.
func TestProjectTaskReference(t *testing.T) {
	win := Window{Start: "2026-01-01", End: "2026-01-11", Today: 7, SprintDays: 10}

	events := []TaskBurnEvent{
		{ArtefactID: "commit", EventType: EventAdded, RemainingDelta: 20, ScopeDelta: 20, OccurredAt: "2026-01-01"},
	}
	dones := map[int]int{1: 2, 2: 3, 3: 4, 4: 3, 5: 2, 6: 4, 7: 5}
	dates := map[int]string{1: "2026-01-02", 2: "2026-01-03", 3: "2026-01-04", 4: "2026-01-05", 5: "2026-01-06", 6: "2026-01-07", 7: "2026-01-08"}
	for d := 1; d <= 7; d++ {
		events = append(events, TaskBurnEvent{ArtefactID: "t", EventType: EventDone, RemainingDelta: -dones[d], ScopeDelta: 0, OccurredAt: dates[d]})
	}
	// Day 5 (-> 2026-01-06): +4 tasks added.
	events = append(events, TaskBurnEvent{ArtefactID: "more", EventType: EventAdded, RemainingDelta: 4, ScopeDelta: 4, OccurredAt: "2026-01-06"})

	m := Project(ProjectInput{Window: win, Events: events})

	// scope: 20 until day 5, then 24.
	if got := m.Scope[4]; got != 20 {
		t.Errorf("scope[4] = %v, want 20", got)
	}
	if got := m.Scope[5]; got != 24 {
		t.Errorf("scope[5] = %v, want 24", got)
	}
	// completed through day 7 = 2+3+4+3+2+4+5 = 23. remaining[7] = 24-23 = 1.
	if got := m.Remaining[7]; got != 1 {
		t.Errorf("remaining[7] = %v, want 1", got)
	}
	if got := m.KPIs.Total; got != 24 {
		t.Errorf("KPIs.Total = %v, want 24", got)
	}
	if got := m.KPIs.Completed; got != 23 {
		t.Errorf("KPIs.Completed = %v, want 23", got)
	}
	if got := m.KPIs.Remaining; got != 1 {
		t.Errorf("KPIs.Remaining = %v, want 1", got)
	}
	// rate = mean daily completed delta over last 3 days (days 5,6,7) = (2+4+5)/3 = 3.667.
	if got := m.Rate; math.Abs(got-3.667) >= 0.01 {
		t.Errorf("rate = %v, want ~3.667", got)
	}
	// one scope change on day 5, +4.
	if len(m.ScopeChanges) != 1 || m.ScopeChanges[0].Day != 5 || m.ScopeChanges[0].Delta != 4 {
		t.Fatalf("ScopeChanges = %+v, want [{Day:5 Delta:4}]", m.ScopeChanges)
	}
	// sentinel past today.
	if got := m.Remaining[8]; got != -1 {
		t.Errorf("remaining[8] = %v, want -1 sentinel", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `go test ./internal/taskmetrics/ -run TestProjectTaskReference -v`
Expected: FAIL — `undefined: Project` / `undefined: ProjectInput`.

- [ ] **Step 3: Write the projection**

```go
package taskmetrics

import (
	"math"
	"time"
)

// ProjectInput is the pure, DB-free input to Project.
type ProjectInput struct {
	Window Window
	Events []TaskBurnEvent
}

// Project replays the ledger into a neutral count Model. Pure function: no DB,
// no HTTP, no clock. A standalone copy of sprintmetrics.Project, count-flavoured
// (RemainingDelta instead of PointsDelta; "done" instead of "accepted").
func Project(in ProjectInput) Model {
	days := in.Window.SprintDays
	today := in.Window.Today

	byDay := make(map[int][]TaskBurnEvent)
	for _, e := range in.Events {
		d := dayOffset(in.Window.Start, e.OccurredAt)
		byDay[d] = append(byDay[d], e)
	}

	scope := make([]float64, days+1)
	remaining := make([]float64, days+1)
	scopeChanges := []ScopeChange{}

	curScope := 0
	curRem := 0
	for d := 0; d <= days; d++ {
		for _, e := range byDay[d] {
			curScope += e.ScopeDelta
			curRem += e.RemainingDelta
			if e.EventType == EventAdded && d > 0 && e.ScopeDelta != 0 {
				scopeChanges = append(scopeChanges, ScopeChange{Day: d, Delta: e.ScopeDelta})
			}
		}
		scope[d] = float64(curScope)
		if d <= today {
			remaining[d] = float64(curRem)
		} else {
			remaining[d] = -1
		}
	}

	earned := make([]float64, today+1)
	for d := 0; d <= today; d++ {
		earned[d] = scope[d] - remaining[d]
	}

	// rate = mean daily completed delta over the last up-to-3 actual days.
	rate := 0.0
	if today >= 1 {
		from := today - 2
		if from < 1 {
			from = 1
		}
		var sum float64
		var n int
		for d := from; d <= today; d++ {
			sum += earned[d] - earned[d-1]
			n++
		}
		if n > 0 {
			rate = sum / float64(n)
		}
	}

	// Ideal guidelines.
	base := scope[0]
	slope := base / float64(days)

	idealOriginal := make([]float64, days+1)
	for d := 0; d <= days; d++ {
		idealOriginal[d] = base - slope*float64(d)
	}

	var idealA, idealB []float64
	if len(scopeChanges) == 0 {
		idealA = make([]float64, days+1)
		for d := 0; d <= days; d++ {
			idealA[d] = base - slope*float64(d)
		}
		idealB = []float64{}
	} else {
		sc := scopeChanges[len(scopeChanges)-1]
		idealA = make([]float64, sc.Day+1)
		for d := 0; d <= sc.Day; d++ {
			idealA[d] = base - slope*float64(d)
		}
		startB := (base - slope*float64(sc.Day)) + float64(sc.Delta)
		slopeB := startB / float64(days-sc.Day)
		idealB = make([]float64, days-sc.Day+1)
		for d := sc.Day; d <= days; d++ {
			idealB[d-sc.Day] = startB - slopeB*float64(d-sc.Day)
		}
	}

	// Forecast cone.
	remToday := remaining[today]
	daysLeft := days - today
	pessEnd := remToday - rate*float64(daysLeft)
	if pessEnd < 0 {
		pessEnd = 0
	}
	optimistic := make([]float64, daysLeft+1)
	pessimistic := make([]float64, daysLeft+1)
	for i := 0; i <= daysLeft; i++ {
		var t float64
		if daysLeft > 0 {
			t = float64(i) / float64(daysLeft)
		}
		optimistic[i] = remToday + (0-remToday)*t
		pessimistic[i] = remToday + (pessEnd-remToday)*t
	}

	kpis := KPIs{
		Total:          int(scope[days]),
		Completed:      int(scope[today] - remToday),
		Remaining:      int(remToday),
		DaysLeft:       daysLeft,
		OnTrack:        pessEnd <= 0,
		ProjectedShort: int(math.Round(pessEnd)),
	}

	return Model{
		Window:        in.Window,
		Scope:         scope,
		Remaining:     remaining,
		Earned:        earned,
		IdealA:        idealA,
		IdealB:        idealB,
		IdealOriginal: idealOriginal,
		Cone:          Cone{Optimistic: optimistic, Pessimistic: pessimistic},
		Rate:          rate,
		ScopeChanges:  scopeChanges,
		KPIs:          kpis,
	}
}

func parseYMD(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}
	}
	return t
}

func dayOffset(start, occ string) int {
	if len(occ) < 10 {
		return 0
	}
	s := parseYMD(start)
	o := parseYMD(occ[:10])
	return int(o.Sub(s).Hours() / 24)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `go test ./internal/taskmetrics/ -run TestProjectTaskReference -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/taskmetrics/projection.go backend/internal/taskmetrics/projection_test.go
git diff --cached --stat
git commit -m "feat(taskmetrics): pure count-based projection + reference test"
```

---

## Task 4: `taskmetrics` ledger derivation — TDD

**Files:**
- Create: `backend/internal/taskmetrics/ledger.go`
- Test: `backend/internal/taskmetrics/ledger_test.go`

The pure decision core: given a before/after snapshot of a TASK and its
EFFECTIVE sprint (its parent story's sprint), return the ledger rows to append.
Counts only. A task burns at the `done` crossing.

- [ ] **Step 1: Write the failing test**

```go
package taskmetrics

import (
	"reflect"
	"testing"
)

func TestDeriveTaskEvents(t *testing.T) {
	cases := []struct {
		name string
		in   TaskDelta
		want []PendingEvent
	}{
		{
			name: "non-task emits nothing",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: false, AfterSprintID: "s1"},
			want: nil,
		},
		{
			name: "added to sprint",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "", AfterSprintID: "s1"},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventAdded, ScopeDelta: 1, RemainingDelta: 1}},
		},
		{
			name: "removed from sprint (not done) drops scope and remaining",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "", BeforeKind: "in_progress"},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: -1}},
		},
		{
			name: "removed from sprint while done drops scope only",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "", BeforeKind: kindDone},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: 0}},
		},
		{
			name: "sprint-to-sprint move",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "s2", BeforeKind: "todo"},
			want: []PendingEvent{
				{SprintID: "s1", ArtefactID: "x", EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: -1},
				{SprintID: "s2", ArtefactID: "x", EventType: EventAdded, ScopeDelta: 1, RemainingDelta: 1},
			},
		},
		{
			name: "done crossing (same sprint)",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "s1", BeforeKind: "in_progress", AfterKind: kindDone},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventDone, RemainingDelta: -1}},
		},
		{
			name: "undone crossing (same sprint)",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "s1", BeforeKind: kindDone, AfterKind: "in_progress"},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventUndone, RemainingDelta: 1}},
		},
		{
			name: "no sprint, no events",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "", AfterSprintID: "", AfterKind: kindDone},
			want: nil,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := DeriveTaskEvents(c.in)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("DeriveTaskEvents() = %+v, want %+v", got, c.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `go test ./internal/taskmetrics/ -run TestDeriveTaskEvents -v`
Expected: FAIL — `undefined: TaskDelta` / `undefined: DeriveTaskEvents`.

- [ ] **Step 3: Write the ledger**

```go
package taskmetrics

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TaskDelta is the pure before/after snapshot of a TASK crossing a write
// boundary. BeforeSprintID/AfterSprintID are the task's EFFECTIVE sprint — its
// parent story's sprint — resolved in-tx by the caller, NOT the task's own
// sprint_id column. IsTaskUnit gates all emission: only slot wrk_task emits.
type TaskDelta struct {
	ArtefactID     string
	BeforeSprintID string
	AfterSprintID  string
	BeforeKind     string
	AfterKind      string
	IsTaskUnit     bool
}

// PendingEvent is one un-persisted ledger row derived from a TaskDelta.
type PendingEvent struct {
	SprintID       string
	ArtefactID     string
	EventType      string
	RemainingDelta int
	ScopeDelta     int
}

// DeriveTaskEvents is the pure decision core. Membership change (parent story's
// sprint changed) takes precedence over a done/undone crossing on the same
// write. Counts only — a task is size 1.
func DeriveTaskEvents(d TaskDelta) []PendingEvent {
	if !d.IsTaskUnit {
		return nil
	}

	if d.BeforeSprintID != d.AfterSprintID {
		switch {
		case d.BeforeSprintID == "" && d.AfterSprintID != "":
			return []PendingEvent{{
				SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID,
				EventType: EventAdded, ScopeDelta: 1, RemainingDelta: 1,
			}}
		case d.BeforeSprintID != "" && d.AfterSprintID == "":
			rem := -1
			if d.BeforeKind == kindDone {
				rem = 0
			}
			return []PendingEvent{{
				SprintID: d.BeforeSprintID, ArtefactID: d.ArtefactID,
				EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: rem,
			}}
		default:
			rem := -1
			if d.BeforeKind == kindDone {
				rem = 0
			}
			return []PendingEvent{
				{SprintID: d.BeforeSprintID, ArtefactID: d.ArtefactID, EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: rem},
				{SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID, EventType: EventAdded, ScopeDelta: 1, RemainingDelta: 1},
			}
		}
	}

	if d.AfterSprintID == "" {
		return nil
	}

	// done/undone crossing within the same sprint.
	if d.BeforeKind != d.AfterKind {
		switch {
		case d.AfterKind == kindDone && d.BeforeKind != kindDone:
			return []PendingEvent{{SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID, EventType: EventDone, RemainingDelta: -1}}
		case d.BeforeKind == kindDone && d.AfterKind != kindDone:
			return []PendingEvent{{SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID, EventType: EventUndone, RemainingDelta: 1}}
		}
	}

	return nil
}

// AppendTaskEvents derives ledger rows for one task write and inserts them
// INSIDE the caller's tx so the ledger can never drift from the artefact write.
// No-op (nil error) when no events are derived.
func AppendTaskEvents(ctx context.Context, tx pgx.Tx, d TaskDelta, actorID, workspaceID uuid.UUID) error {
	for _, ev := range DeriveTaskEvents(d) {
		sprintID, err := uuid.Parse(ev.SprintID)
		if err != nil {
			return err
		}
		artefactID, err := uuid.Parse(ev.ArtefactID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, sqlInsertTaskBurnEvent,
			sprintID, artefactID, ev.EventType, ev.RemainingDelta, ev.ScopeDelta, actorID, workspaceID,
		); err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 4: Add the SQL constant (needed by AppendTaskEvents)**

Create `backend/internal/taskmetrics/sql.go`:

```go
package taskmetrics

// sqlSelectTaskBurnEvents reads the append-only ledger for one sprint within one
// workspace, oldest first, normalising occurred_at to "YYYY-MM-DD".
const sqlSelectTaskBurnEvents = `SELECT task_burn_events_id_artefact, task_burn_events_event_type, task_burn_events_remaining_delta, task_burn_events_scope_delta, to_char(task_burn_events_occurred_at,'YYYY-MM-DD') FROM task_burn_events WHERE task_burn_events_id_sprint=$1 AND task_burn_events_id_workspace=$2 ORDER BY task_burn_events_occurred_at ASC`

// sqlSelectSprintWindow reads the sprint's start/end as "YYYY-MM-DD" strings.
const sqlSelectSprintWindow = `SELECT to_char(timeboxes_sprints_date_start,'YYYY-MM-DD'), to_char(timeboxes_sprints_date_end,'YYYY-MM-DD') FROM timeboxes_sprints WHERE timeboxes_sprints_id=$1`

// sqlInsertTaskBurnEvent appends one ledger row inside the artefact write tx.
const sqlInsertTaskBurnEvent = `INSERT INTO task_burn_events (task_burn_events_id_sprint, task_burn_events_id_artefact, task_burn_events_event_type, task_burn_events_remaining_delta, task_burn_events_scope_delta, task_burn_events_id_actor, task_burn_events_id_workspace) VALUES ($1,$2,$3,$4,$5,$6,$7)`
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `backend/`): `go test ./internal/taskmetrics/ -run TestDeriveTaskEvents -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/taskmetrics/ledger.go backend/internal/taskmetrics/ledger_test.go backend/internal/taskmetrics/sql.go
git diff --cached --stat
git commit -m "feat(taskmetrics): task-delta ledger derivation + SQL + tests"
```

---

## Task 5: `taskmetrics` service + handler

**Files:**
- Create: `backend/internal/taskmetrics/service.go`
- Create: `backend/internal/taskmetrics/handler.go`

- [ ] **Step 1: Write the service**

```go
package taskmetrics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service replays the task_burn_events ledger on demand. Holds no state beyond
// the pool — every Metrics call re-reads and recomputes from scratch.
type Service struct {
	pool *pgxpool.Pool
}

// NewService wires the service to the vector_artefacts pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Metrics reads the sprint window and its task ledger, then projects the neutral
// count Model. No caching.
func (s *Service) Metrics(ctx context.Context, sprintID, workspaceID uuid.UUID) (Model, error) {
	var start, end string
	if err := s.pool.QueryRow(ctx, sqlSelectSprintWindow, sprintID).Scan(&start, &end); err != nil {
		return Model{}, fmt.Errorf("taskmetrics: load window: %w", err)
	}

	rows, err := s.pool.Query(ctx, sqlSelectTaskBurnEvents, sprintID, workspaceID)
	if err != nil {
		return Model{}, fmt.Errorf("taskmetrics: query events: %w", err)
	}
	defer rows.Close()

	var events []TaskBurnEvent
	for rows.Next() {
		var e TaskBurnEvent
		if err := rows.Scan(&e.ArtefactID, &e.EventType, &e.RemainingDelta, &e.ScopeDelta, &e.OccurredAt); err != nil {
			return Model{}, fmt.Errorf("taskmetrics: scan event: %w", err)
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return Model{}, fmt.Errorf("taskmetrics: iterate events: %w", err)
	}

	win := buildWindow(start, end)
	return Project(ProjectInput{Window: win, Events: events}), nil
}

// buildWindow computes the sprint span and where "now" sits within it.
func buildWindow(start, end string) Window {
	span := dayOffset(start, end)
	if span < 0 {
		span = 0
	}
	today := 0
	if s := parseYMD(start); !s.IsZero() {
		today = int(time.Now().UTC().Sub(s).Hours() / 24)
	}
	if today < 0 {
		today = 0
	}
	if today > span {
		today = span
	}
	return Window{Start: start, End: end, Today: today, SprintDays: span}
}
```

- [ ] **Step 2: Write the handler**

```go
package taskmetrics

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Metrics handles GET /_site/timeboxes/sprints/{id}/task-metrics.
// Sentinel establishes the workspace clamp server-side (fail-closed).
func (h *Handler) Metrics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID, ok := sentinel.WorkspaceIDFromCtx(ctx)
	if !ok || wsID == uuid.Nil {
		httperr.Write(w, r, http.StatusUnauthorized, "no workspace clamp")
		return
	}
	sprintID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid sprint id")
		return
	}
	model, err := h.svc.Metrics(ctx, sprintID, wsID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "task metrics projection failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(model)
}
```

- [ ] **Step 3: Verify it compiles**

Run (from `backend/`): `go build ./internal/taskmetrics/...`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/taskmetrics/service.go backend/internal/taskmetrics/handler.go
git diff --cached --stat
git commit -m "feat(taskmetrics): on-demand service + sentinel-clamped handler"
```

---

## Task 6: Wire the route + service in main.go

**Files:**
- Modify: `backend/cmd/server/main.go` (import block; service init near :919; route mount near :1759)

- [ ] **Step 1: Add the import**

In the import block (alongside `"github.com/mmffdev/vector-backend/internal/sprintmetrics"` at ~:78), add:

```go
	"github.com/mmffdev/vector-backend/internal/taskmetrics"
```

- [ ] **Step 2: Init the service**

Immediately after the `sprintMetricsH` init block (the `if vaPool != nil { ... }` ending at ~:925), add:

```go
	// Task metrics (task-count burndown, engineering-team view) — standalone
	// sibling of sprintmetrics; same vaPool guard. Mounted at GET
	// /timeboxes/sprints/{id}/task-metrics.
	var taskMetricsH *taskmetrics.Handler
	if vaPool != nil {
		taskMetricsSvc := taskmetrics.NewService(vaPool)
		taskMetricsH = taskmetrics.NewHandler(taskMetricsSvc)
	}
```

- [ ] **Step 3: Mount the route**

Immediately after the existing metrics route mount (`r.With(sentinelMW).Get("/{id}/metrics", sprintMetricsH.Metrics)` at ~:1759), add:

```go
				// Task-count burndown — same sentinelMW-on-this-route-only
				// rule as /metrics above (handler reads the workspace clamp).
				r.With(sentinelMW).Get("/{id}/task-metrics", taskMetricsH.Metrics)
```

- [ ] **Step 4: Verify it builds**

Run (from `backend/`): `go build ./...`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/server/main.go
git diff --cached --stat
git commit -m "feat(taskmetrics): mount GET /timeboxes/sprints/{id}/task-metrics"
```

---

## Task 7: Emit task events from the artefact write path

**Files:**
- Modify: `backend/internal/artefactitems/service.go` (create path ~:1249; update path ~:2113)
- Modify: `backend/internal/artefactitems/sql.go` (add parent-sprint lookup)

**Context:** A task's effective sprint = its parent story's `sprint_id`. The
existing burn block already resolves slot + before/after kind in-tx. We add a
parallel task-emission branch that resolves the parent story's sprint.

- [ ] **Step 1: Add the parent-sprint lookup SQL**

In `backend/internal/artefactitems/sql.go`, add a constant (place near the other artefact reads):

```go
// sqlSelectParentSprintID returns the timebox-sprint id of an artefact's parent
// (the task's parent story). Empty string when no parent or the parent has no
// sprint. Column names verified against the live artefacts table:
// PK artefacts_id, parent artefacts_id_parent, sprint artefacts_id_timebox_sprint.
const sqlSelectParentSprintID = `SELECT COALESCE(parent.artefacts_id_timebox_sprint::text, '') FROM artefacts child JOIN artefacts parent ON parent.artefacts_id = child.artefacts_id_parent WHERE child.artefacts_id = $1`
```

The lookup runs on the tx (`tx.QueryRow`) so it sees this write's parent/sprint reassignment.

- [ ] **Step 2: Add a helper to resolve effective sprint in-tx**

In `service.go`, near `flowKindByStateID` (~:197), add:

```go
// effectiveSprintForTask resolves a task's sprint as its parent story's
// sprint_id, read on the tx so it reflects in-flight writes. Empty string when
// the task has no parent or the parent carries no sprint.
func (s *Service) effectiveSprintForTask(ctx context.Context, tx pgx.Tx, artefactID uuid.UUID) (string, error) {
	var sid string
	if err := tx.QueryRow(ctx, sqlSelectParentSprintID, artefactID).Scan(&sid); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return sid, nil
}
```

> Ensure `errors` and `pgx` are imported in service.go (they are already used elsewhere in the package — confirm at the top of the file).

- [ ] **Step 3: Emit on the UPDATE path**

In the update burn block (after the existing `sprintmetrics.AppendBurnEvents(...)` call at ~:2124, still inside `if burnBefore != nil {`), add the task branch. `slot` is already computed above as the artefact's slot:

```go
		// Task-count burndown emission (engineering-team view). Only the TASK
		// tier emits here; the story-tier block above handles points. A task's
		// effective sprint is its parent story's sprint, resolved in-tx.
		if slot == SlotTask {
			beforeEff, eerr := s.effectiveSprintForTask(ctx, tx, id)
			if eerr != nil {
				return nil, fmt.Errorf("task burn-event capture: %w", eerr)
			}
			// The parent reassignment (if any) is already written above, so the
			// lookup reflects the after-state. For the before-state we treat the
			// pre-write effective sprint as equal unless parent/sprint changed;
			// the membership delta is driven by before/after of the SAME lookup
			// across the tx is not available, so we use the parent's current
			// sprint as both — membership moves are captured when the STORY
			// moves (Task 7b cascade). Here we capture the task's own done/undone
			// crossing within a stable sprint.
			taskDelta := taskmetrics.TaskDelta{
				ArtefactID:     id.String(),
				BeforeSprintID: beforeEff,
				AfterSprintID:  beforeEff,
				BeforeKind:     beforeKind,
				AfterKind:      afterKind,
				IsTaskUnit:     true,
			}
			if terr := taskmetrics.AppendTaskEvents(ctx, tx, taskDelta, in.AuthorUserID, burnWorkspaceID); terr != nil {
				return nil, fmt.Errorf("task burn-event capture: %w", terr)
			}
		}
```

> Add `"github.com/mmffdev/vector-backend/internal/taskmetrics"` to service.go's imports.

- [ ] **Step 4: Emit on the CREATE path**

In the create burn block (after `sprintmetrics.AppendBurnEvents(ctx, tx, createDelta, ...)` at ~:1260), add:

```go
		// Task created directly under a story already in a sprint → "added".
		if createSlot == SlotTask {
			eff, eerr := s.effectiveSprintForTask(ctx, tx, newID)
			if eerr != nil {
				return nil, fmt.Errorf("task burn-event capture: %w", eerr)
			}
			if eff != "" {
				createTaskDelta := taskmetrics.TaskDelta{
					ArtefactID:     newID.String(),
					BeforeSprintID: "",
					AfterSprintID:  eff,
					BeforeKind:     "",
					AfterKind:      afterKind,
					IsTaskUnit:     true,
				}
				if terr := taskmetrics.AppendTaskEvents(ctx, tx, createTaskDelta, createdBy, workspaceID); terr != nil {
					return nil, fmt.Errorf("task burn-event capture: %w", terr)
				}
			}
		}
```

- [ ] **Step 5: Verify it builds**

Run (from `backend/`): `go build ./...`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/artefactitems/service.go backend/internal/artefactitems/sql.go
git diff --cached --stat
git commit -m "feat(taskmetrics): emit task burn events on create/update (done crossing)"
```

---

## Task 7b: Cascade task membership when a story moves sprints

**Files:**
- Modify: `backend/internal/artefactitems/service.go` (story-tier update burn block ~:2124)
- Modify: `backend/internal/artefactitems/sql.go` (children lookup)

**Context:** When a STORY changes sprint, every TASK child's effective sprint
changes too. Emit removed-from-old + added-to-new task events for each task
child, in-tx.

- [ ] **Step 1: Add the task-children lookup SQL**

In `sql.go`:

```go
// sqlSelectTaskChildren returns (id, flow_kind) for every TASK-tier child of a
// parent artefact. Used to cascade sprint-membership moves to the task burndown
// when the parent story changes sprint. Names verified against live schema:
// artefacts (PK artefacts_id, parent artefacts_id_parent, type
// artefacts_id_artefact_type, flow-state artefacts_id_flow_state);
// artefacts_types (PK artefacts_types_id, artefacts_types_slot);
// flows_states (PK flows_states_id, flows_states_kind).
const sqlSelectTaskChildren = `SELECT c.artefacts_id::text, COALESCE(fs.flows_states_kind, '') FROM artefacts c JOIN artefacts_types t ON t.artefacts_types_id = c.artefacts_id_artefact_type LEFT JOIN flows_states fs ON fs.flows_states_id = c.artefacts_id_flow_state WHERE c.artefacts_id_parent = $1 AND t.artefacts_types_slot = 'wrk_task'`
```

- [ ] **Step 2: Cascade in the story-tier branch**

Inside the update burn block, after the existing story `AppendBurnEvents`, add — guarded so it only fires when the story actually changed sprint and the slot is story-tier:

```go
		// Cascade: a story moving sprints moves its tasks' membership too.
		if isSprintUnit && beforeSprintID != afterSprintID {
			rows, qerr := tx.Query(ctx, sqlSelectTaskChildren, id)
			if qerr != nil {
				return nil, fmt.Errorf("task cascade: %w", qerr)
			}
			type childRow struct{ id, kind string }
			var children []childRow
			for rows.Next() {
				var cr childRow
				if serr := rows.Scan(&cr.id, &cr.kind); serr != nil {
					rows.Close()
					return nil, fmt.Errorf("task cascade scan: %w", serr)
				}
				children = append(children, cr)
			}
			rows.Close()
			if rerr := rows.Err(); rerr != nil {
				return nil, fmt.Errorf("task cascade iterate: %w", rerr)
			}
			for _, cr := range children {
				cd := taskmetrics.TaskDelta{
					ArtefactID:     cr.id,
					BeforeSprintID: beforeSprintID,
					AfterSprintID:  afterSprintID,
					BeforeKind:     cr.kind,
					AfterKind:      cr.kind,
					IsTaskUnit:     true,
				}
				if terr := taskmetrics.AppendTaskEvents(ctx, tx, cd, in.AuthorUserID, burnWorkspaceID); terr != nil {
					return nil, fmt.Errorf("task cascade emit: %w", terr)
				}
			}
		}
```

- [ ] **Step 3: Verify it builds**

Run (from `backend/`): `go build ./...`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/artefactitems/service.go backend/internal/artefactitems/sql.go
git diff --cached --stat
git commit -m "feat(taskmetrics): cascade task membership when parent story moves sprint"
```

---

## Task 8: Backfill existing tasks

**Files:**
- Create: `dev/scripts/backfill_task_burn_added.sql`

**Context:** Mirror `dev/scripts/backfill_sprint_burn_added.sql`. Seed one
`added` event per existing task whose parent story is in a sprint, and one
`done` event for tasks already at `done`. Best-effort dates: sprint start for
`added`; the task's `updated_at` (or sprint start) for `done`.

- [ ] **Step 1: Read the story backfill for the exact pattern**

Run: `cat dev/scripts/backfill_sprint_burn_added.sql`
Use its structure (workspace resolution, idempotency guard, INSERT ... SELECT) as the template.

- [ ] **Step 2: Write the task backfill**

```sql
-- backfill_task_burn_added.sql
-- Seed task_burn_events for existing tasks whose parent story is in a sprint.
-- Idempotent: skips tasks that already have the matching event row.
-- Column names verified against the live artefacts / artefacts_types /
-- flows_states / timeboxes_sprints tables.

BEGIN;

-- One 'added' (scope+1, remaining+1) per task under a sprinted story.
INSERT INTO task_burn_events (
  task_burn_events_id_sprint, task_burn_events_id_artefact,
  task_burn_events_event_type, task_burn_events_remaining_delta,
  task_burn_events_scope_delta, task_burn_events_id_workspace,
  task_burn_events_occurred_at
)
SELECT
  parent.artefacts_id_timebox_sprint,
  child.artefacts_id,
  'added', 1, 1,
  child.artefacts_id_workspace,
  COALESCE(s.timeboxes_sprints_date_start::timestamptz, now())
FROM artefacts child
JOIN artefacts parent ON parent.artefacts_id = child.artefacts_id_parent
JOIN artefacts_types t ON t.artefacts_types_id = child.artefacts_id_artefact_type
JOIN timeboxes_sprints s ON s.timeboxes_sprints_id = parent.artefacts_id_timebox_sprint
WHERE t.artefacts_types_slot = 'wrk_task'
  AND parent.artefacts_id_timebox_sprint IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM task_burn_events e
    WHERE e.task_burn_events_id_artefact = child.artefacts_id
      AND e.task_burn_events_event_type = 'added'
  );

-- One 'done' (remaining-1) per task currently at flow kind 'done'.
INSERT INTO task_burn_events (
  task_burn_events_id_sprint, task_burn_events_id_artefact,
  task_burn_events_event_type, task_burn_events_remaining_delta,
  task_burn_events_scope_delta, task_burn_events_id_workspace,
  task_burn_events_occurred_at
)
SELECT
  parent.artefacts_id_timebox_sprint,
  child.artefacts_id,
  'done', -1, 0,
  child.artefacts_id_workspace,
  COALESCE(child.artefacts_updated_at, s.timeboxes_sprints_date_start::timestamptz, now())
FROM artefacts child
JOIN artefacts parent ON parent.artefacts_id = child.artefacts_id_parent
JOIN artefacts_types t ON t.artefacts_types_id = child.artefacts_id_artefact_type
JOIN flows_states fs ON fs.flows_states_id = child.artefacts_id_flow_state
JOIN timeboxes_sprints s ON s.timeboxes_sprints_id = parent.artefacts_id_timebox_sprint
WHERE t.artefacts_types_slot = 'wrk_task'
  AND parent.artefacts_id_timebox_sprint IS NOT NULL
  AND fs.flows_states_kind = 'done'
  AND NOT EXISTS (
    SELECT 1 FROM task_burn_events e
    WHERE e.task_burn_events_id_artefact = child.artefacts_id
      AND e.task_burn_events_event_type = 'done'
  );

COMMIT;
```

- [ ] **Step 3: Dry-run the counts, then apply**

Run (count what WOULD insert — wrap each SELECT in `SELECT count(*) FROM (...)` first to sanity-check), then:
`psql -d vector_artefacts -f dev/scripts/backfill_task_burn_added.sql`
Expected: two INSERT row counts > 0 for a tenant with sprinted tasks. Verify:
`psql -d vector_artefacts -c "SELECT task_burn_events_event_type, count(*) FROM task_burn_events GROUP BY 1"`

- [ ] **Step 4: Commit**

```bash
git add dev/scripts/backfill_task_burn_added.sql
git diff --cached --stat
git commit -m "feat(taskmetrics): backfill task_burn_events for existing sprinted tasks"
```

---

## Task 9: Frontend apiSite client + types

**Files:**
- Create: `app/lib/apiSite/taskMetrics.ts`
- Modify: `app/lib/apiSite/index.ts` (export the client + types)

- [ ] **Step 1: Write the client**

```ts
/**
 * taskMetrics — typed client for the TASK-count burndown engine.
 * Backend: backend/internal/taskmetrics/handler.go → GET
 *   /_site/timeboxes/sprints/{id}/task-metrics (Sentinel-clamped server-side).
 * Wire shapes mirror taskmetrics.Model (types.go). Count metric, not points.
 */
import { apiSite } from "@/app/lib/api";
import type { ID } from "@/app/lib/apiSite";

export interface TaskWindow { start: string; end: string; today: number; sprint_days: number; }
export interface TaskScopeChange { day: number; delta: number; }
export interface TaskCone { optimistic: number[]; pessimistic: number[]; }
export interface TaskKPIs {
  total: number; completed: number; remaining: number;
  days_left: number; on_track: boolean; projected_short: number;
}
export interface TaskMetricsModel {
  window: TaskWindow;
  scope: number[];
  remaining: number[];        // values < 0 = "no actual" sentinel
  earned: number[];
  ideal_a: number[];
  ideal_b: number[];
  ideal_original: number[];
  cone: TaskCone;
  rate: number;
  scope_changes: TaskScopeChange[];
  kpis: TaskKPIs;
}

export const taskMetrics = {
  get: (sprintId: ID): Promise<TaskMetricsModel> =>
    apiSite<TaskMetricsModel>(`/timeboxes/sprints/${sprintId}/task-metrics`),
};
```

- [ ] **Step 2: Export from the apiSite index**

In `app/lib/apiSite/index.ts`, mirror how `sprintMetrics` is exported. Find the `sprintMetrics` export line and add beside it:

```ts
export { taskMetrics } from "./taskMetrics";
export type {
  TaskMetricsModel, TaskWindow, TaskScopeChange, TaskCone, TaskKPIs,
} from "./taskMetrics";
```

> Match the exact export style already used for `sprintMetrics` in that file (named re-export vs `export *`). Confirm by reading the `sprintMetrics` lines first.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/apiSite/taskMetrics.ts app/lib/apiSite/index.ts
git diff --cached --stat
git commit -m "feat(taskmetrics): apiSite client + TaskMetricsModel types"
```

---

## Task 10: Frontend hook + geometry shaper

**Files:**
- Create: `app/hooks/useTaskMetrics.ts`
- Create: `app/components/charts/sprint/buildTaskBurndownView.ts`
- Test: `app/components/charts/sprint/__tests__/buildTaskBurndownView.test.ts`

- [ ] **Step 1: Write the hook**

```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { taskMetrics, type TaskMetricsModel } from "@/app/lib/apiSite";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";

/**
 * useTaskMetrics — single source for the task-count burndown. Sibling of
 * useSprintMetrics: fetches the neutral count model on demand, auto-refreshes
 * on ledger pushes (best-effort), 60s poll + manual refetch().
 */
export function useTaskMetrics(sprintId: string | null, topic?: string | null) {
  const [model, setModel] = useState<TaskMetricsModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sprintId) { setModel(null); return; }
    setLoading(true); setError(null);
    try { setModel(await taskMetrics.get(sprintId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load task metrics"); }
    finally { setLoading(false); }
  }, [sprintId]);

  useEffect(() => { void load(); }, [load]);
  useRefetchOnPush({ topic: topic ?? null, refetch: load });

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!sprintId) return;
    const t = setInterval(() => void loadRef.current(), 60_000);
    return () => clearInterval(t);
  }, [sprintId]);

  return { model, loading, error, refetch: load };
}
```

- [ ] **Step 2: Write the failing geometry test**

```ts
import { describe, it, expect } from "vitest";
import { buildTaskBurndownView, VB } from "../buildTaskBurndownView";
import type { TaskMetricsModel } from "@/app/lib/apiSite";

const model: TaskMetricsModel = {
  window: { start: "2026-01-01", end: "2026-01-11", today: 2, sprint_days: 10 },
  scope: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  remaining: [10, 8, 6, -1, -1, -1, -1, -1, -1, -1, -1],
  earned: [0, 2, 4],
  ideal_a: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ideal_b: [],
  ideal_original: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  cone: { optimistic: [], pessimistic: [] },
  rate: 2,
  scope_changes: [],
  kpis: { total: 10, completed: 4, remaining: 6, days_left: 8, on_track: true, projected_short: 0 },
};

describe("buildTaskBurndownView", () => {
  it("plots the actual line only up to today and skips -1 sentinels", () => {
    const v = buildTaskBurndownView(model);
    expect(v.markers).toHaveLength(3); // days 0,1,2
    expect(v.actualPath.startsWith("M")).toBe(true);
    expect(v.todayX).toBeCloseTo(VB.plotL + (2 / 10) * VB.plotW, 1);
  });

  it("tolerates null array fields from the wire", () => {
    const bad = { ...model, scope_changes: null as unknown as [], cone: { optimistic: null, pessimistic: null } as unknown as TaskMetricsModel["cone"] };
    expect(() => buildTaskBurndownView(bad)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/components/charts/sprint/__tests__/buildTaskBurndownView.test.ts`
Expected: FAIL — cannot resolve `../buildTaskBurndownView`.

- [ ] **Step 4: Write the geometry shaper**

Copy `app/components/charts/sprint/buildBurndownView.ts` verbatim into `buildTaskBurndownView.ts`, then change ONLY:
- Import type: `SprintMetricsModel` → `TaskMetricsModel`.
- The function signature/param type and the `BurndownView`/return interface name → `TaskBurndownView`.
- The `arr(...)` normalisation block field list stays identical (scope/remaining/earned/ideal_a/ideal_b/ideal_original/scope_changes/cone) — `TaskMetricsModel` has the same field names, so the body needs no other change.

The math is count-vs-points agnostic (it reads `remaining[]`, `scope_changes[]`, `cone`, `ideal_*`), so the copied body works unchanged. Keep `VB` exported.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/components/charts/sprint/__tests__/buildTaskBurndownView.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add app/hooks/useTaskMetrics.ts app/components/charts/sprint/buildTaskBurndownView.ts app/components/charts/sprint/__tests__/buildTaskBurndownView.test.ts
git diff --cached --stat
git commit -m "feat(taskmetrics): useTaskMetrics hook + count geometry shaper + test"
```

---

## Task 11: TaskBurndownChart component

**Files:**
- Create: `app/components/TaskBurndownChart.tsx`

- [ ] **Step 1: Write the component**

Copy `app/components/SprintBurndownChart.tsx` into `TaskBurndownChart.tsx`, then change:
- Imports: `SprintMetricsModel` → `TaskMetricsModel`; `buildBurndownView` → `buildTaskBurndownView`; drop the `TeamVelocity` import.
- Component name + export → `TaskBurndownChart`.
- Drop the `teamVelocity` prop entirely.
- Replace the KPI strip with FOUR KPIs only: Total · Completed · Remaining · Days-left (no velocity, no team-velocity block). Use `k.total`, `k.completed`, `k.remaining`, `k.days_left`:

```tsx
      {/* KPI strip — engineering-team view: counts, no velocity. */}
      <div className="sprint-burndown__kpis">
        <div className="sprint-burndown__kpi">
          <span className="sprint-burndown__kpi-value">{k.total}</span>
          <span className="sprint-burndown__kpi-label">Total tasks</span>
        </div>
        <div className="sprint-burndown__kpi">
          <span className="sprint-burndown__kpi-value">{k.completed}</span>
          <span className="sprint-burndown__kpi-label">Completed</span>
        </div>
        <div className="sprint-burndown__kpi">
          <span className="sprint-burndown__kpi-value">{k.remaining}</span>
          <span className="sprint-burndown__kpi-label">Remaining</span>
        </div>
        <div className="sprint-burndown__kpi">
          <span className="sprint-burndown__kpi-value">{k.days_left}</span>
          <span className="sprint-burndown__kpi-label">Days left</span>
        </div>
        <span
          className={
            "sprint-burndown__pill " +
            (k.on_track ? "sprint-burndown__pill--ok" : "sprint-burndown__pill--warn")
          }
        >
          {k.on_track ? "On track" : `~${k.projected_short} tasks short`}
        </span>
      </div>
```

- Keep the ENTIRE SVG block (gridlines, scope region, cone, area, ideal A/B/original, optimistic/pessimistic, today line, actual line, markers, scope pins) and the legend UNCHANGED — they read `v.*` from the shaper and are count-agnostic.
- Reuse the existing `sprint-burndown__*` CSS classes verbatim (no new chart CSS needed — the two charts are visually identical, differing only in KPI labels and units).
- `const days = model.window.sprint_days;` and `const k = model.kpis;` stay; just the prop type is `TaskMetricsModel`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/TaskBurndownChart.tsx
git diff --cached --stat
git commit -m "feat(taskmetrics): TaskBurndownChart (count KPIs, shared SVG + CSS)"
```

---

## Task 12: Page layout — two charts side-by-side at 50%

**Files:**
- Modify: `app/(user)/value-sprint-review/page.tsx`
- Modify: `app/globals.css` (add the burndown-row flex block)

- [ ] **Step 1: Add the CSS row block**

In `app/globals.css`, immediately before the `.sprint-burndown {` rule (~:22436), add:

```css
.value-sprint-review__burndown-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4, 1rem);
  align-items: stretch;
}
.value-sprint-review__burndown-col {
  flex: 1 1 0;
  min-width: 320px;
}
@media (max-width: 900px) {
  .value-sprint-review__burndown-col { flex-basis: 100%; }
}
```

> Confirm the `--space-4` token exists in globals.css; if not, use the gap token used by adjacent panels (grep `--space-` near other flex rows).

- [ ] **Step 2: Add the task-metrics hook to the page**

In `page.tsx`, add the import beside `useSprintMetrics`:

```tsx
import { useTaskMetrics } from "@/app/hooks/useTaskMetrics";
import { TaskBurndownChart } from "@/app/components/TaskBurndownChart";
```

After the `useSprintMetrics(...)` call (~:196), add:

```tsx
  const {
    model: taskModel,
    loading: taskLoading,
    refetch: refetchTask,
  } = useTaskMetrics(panelSprintId, burndownTopic);
```

Extend `refreshMetrics` (~:208) to also refetch tasks:

```tsx
  const refreshMetrics = useCallback(() => {
    void refetchBurndown();
    void refreshTeamVelocity();
    void refetchTask();
  }, [refetchBurndown, refreshTeamVelocity, refetchTask]);
```

- [ ] **Step 3: Wrap the two charts in the row**

Replace the single burndown `<Panel>` (the `panel_value_sprint_review_burndown` block, ~:360-388) with a row holding two columns. The first column is the EXISTING story burndown panel verbatim; the second is the new task panel:

```tsx
        <div className="value-sprint-review__burndown-row">
          <div className="value-sprint-review__burndown-col">
            <Panel
              name="panel_value_sprint_review_burndown"
              className="page-panel-heading"
              title="Sprint burndown"
              description="Story points remaining vs. the ideal pace, with forecast cone and scope-change history."
            >
              <div className="value-sprint-review__burndown-bar">
                <button
                  type="button"
                  className="btn"
                  onClick={() => refreshMetrics()}
                  aria-label="Refresh burndown"
                  title="Refresh burndown"
                >
                  <span>↻ Refresh</span>
                </button>
              </div>
              {burndownModel ? (
                <SprintBurndownChart model={burndownModel} teamVelocity={teamVelocity} />
              ) : (
                <p className="text-size-90">
                  {burndownLoading
                    ? "Loading burndown…"
                    : panelSprintId
                      ? "No burndown data for this sprint yet — it populates as items are added and accepted."
                      : "Select a sprint to see its burndown."}
                </p>
              )}
            </Panel>
          </div>

          <div className="value-sprint-review__burndown-col">
            <Panel
              name="panel_value_sprint_review_task_burndown"
              className="page-panel-heading"
              title="Task burndown"
              description="Tasks completed vs. the ideal pace — the engineering-team view. A task burns when its owner marks it done."
            >
              {taskModel ? (
                <TaskBurndownChart model={taskModel} />
              ) : (
                <p className="text-size-90">
                  {taskLoading
                    ? "Loading task burndown…"
                    : panelSprintId
                      ? "No task burndown yet — it populates as tasks are added under sprinted stories and marked done."
                      : "Select a sprint to see its task burndown."}
                </p>
              )}
            </Panel>
          </div>
        </div>
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors (watch for `lint:h2-panel-only`, `lint:page-description` — both satisfied: titles via `<Panel>`, page already has `<PageDescription>`).

- [ ] **Step 5: Commit**

```bash
git add "app/(user)/value-sprint-review/page.tsx" app/globals.css
git diff --cached --stat
git commit -m "feat(taskmetrics): two burndowns side-by-side (half width each) on value-sprint-review"
```

---

## Task 13: Tech-debt entry + verification

**Files:**
- Modify: `docs/c_tech_debt.md`

- [ ] **Step 1: Add the TD entry**

Append to `docs/c_tech_debt.md` (follow the existing `TD-*` entry format in that file — read one entry first to match the exact shape):

```markdown
### TD-TASKMETRICS-DUP-PROJECTION (S2)

**What:** The burndown replay math (ideal line, forecast cone, KPI derivation,
scope-change re-basing) now exists in TWO standalone copies:
`backend/internal/sprintmetrics/projection.go` (points, PO view) and
`backend/internal/taskmetrics/projection.go` (count, engineering view). Frontend
mirrors it: `buildBurndownView.ts` + `buildTaskBurndownView.ts`.

**Why it's here:** Deliberate isolation — the live PO story chart must be
untouchable by task-chart work (owner decision, 2026-06-06 brainstorm).

**Trigger to pay down:** the first time a cone/ideal/KPI bug is fixed in one copy
(it must be mirrored to the other), OR a third count-style chart is requested. At
that point extract a shared pure `burnmodel.Project(events, window, opts) Model`
package both engines call, keeping ledger/emission/SQL/handler paths isolated.

**Cap now:** none — both copies are pinned by reference tests
(`projection_test.go` in each package; `buildTaskBurndownView.test.ts`).
```

- [ ] **Step 2: Full backend test + build**

Run (from `backend/`): `go build ./... && go test ./internal/taskmetrics/... ./internal/artefactitems/...`
Expected: PASS.

- [ ] **Step 3: Full frontend check**

Run: `npx tsc --noEmit && npx vitest run app/components/charts/sprint/`
Expected: PASS.

- [ ] **Step 4: Manual smoke (real app)**

Use the `verify` skill (or `<npm>` + browser): load `/value-sprint-review` for a sprint with tasks. Confirm:
- Two charts render side-by-side, each ~half width.
- Story chart KPIs unchanged (Committed/Remaining/3-day/Team velocity/Days-left).
- Task chart KPIs: Total / Completed / Remaining / Days-left, no velocity.
- Marking a task done (in the grid) then ↻ Refresh drops the task remaining line by one.

- [ ] **Step 5: Commit**

```bash
git add docs/c_tech_debt.md
git diff --cached --stat
git commit -m "docs(tech-debt): TD-TASKMETRICS-DUP-PROJECTION — accepted projection-math duplication"
```

- [ ] **Step 6: Regenerate SY003 (substrate changed — new table)**

Per the SY003 hard rule, the substrate changed (new `task_burn_events` table + new SQL touchpoints). Invoke `<report> -sy` with the standard Vector-databases prompt so the master inventory captures the new table + the new Go SQL constants. (Non-destructive — re-POST prepends a change-log entry.)

---

## Schema reference (verified 2026-06-06)

The SQL in Tasks 7, 7b, and 8 uses column names **confirmed against the live
substrate** (read from `backend/internal/artefactitems/sql.go` constants):

| Concept | Table | Column |
|---|---|---|
| Artefact PK | `artefacts` | `artefacts_id` |
| Parent | `artefacts` | `artefacts_id_parent` |
| Sprint membership | `artefacts` | `artefacts_id_timebox_sprint` |
| Type ref | `artefacts` | `artefacts_id_artefact_type` |
| Flow-state ref | `artefacts` | `artefacts_id_flow_state` |
| Workspace | `artefacts` | `artefacts_id_workspace` |
| Updated-at | `artefacts` | `artefacts_updated_at` |
| Type slot | `artefacts_types` | PK `artefacts_types_id`, `artefacts_types_slot` |
| Flow kind | `flows_states` | PK `flows_states_id`, `flows_states_kind` |
| Sprint window | `timeboxes_sprints` | PK `timeboxes_sprints_id`, `timeboxes_sprints_date_start/_end` |

Note the table is `artefacts` (NOT `artefact_items`), and the slot/kind helper
tables are `artefacts_types` / `flows_states` (double-pluralised). The existing
`slotByTypeID` / `flowKindByStateID` queries in `artefactitems/sql.go` encode
the same names — they are the canonical reference if anything drifts.

One open verification for the implementer: confirm whether reads on `artefacts`
need an `artefacts_id_subscription = $n` clamp for correctness in the
parent-sprint and task-children lookups (the broader ListWorkItems queries
clamp by subscription + sentinel subtree). Since both lookups are keyed by a
specific artefact id / parent id resolved INSIDE the same tenant write tx, the
id is already tenant-bound; a subscription clamp is defence-in-depth, not
correctness. Add it if mirroring the package's other tx-local reads do so.
