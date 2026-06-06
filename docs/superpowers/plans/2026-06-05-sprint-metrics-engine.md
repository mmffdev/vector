# Sprint Metrics Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an event-sourced sprint ledger + on-demand projection engine that feeds a live, real-data burndown chart on `/value-sprint-review`, architected so future sprint charts (burnup, velocity, CFD) reuse the same engine with zero backend work.

**Architecture:** An append-only `sprint_burn_events` ledger captures artefact lifecycle against sprints (added/removed/accepted/unaccepted/points_changed) **in the artefact write transaction**. A standalone Go `sprintmetrics` package replays the ledger **on demand** (no daemon) into a neutral, chart-agnostic model (scope/remaining/earned/ideal/cone/KPIs/dates). A shared `useSprintMetrics` hook fetches it (realtime push + 60s poll + manual refresh). Dumb chart components map the neutral model to SVG.

**Tech Stack:** Go (chi, pgx/v5), Postgres (`vector_artefacts`), Next.js 15 / React 18, hand-written CSS, hand-built SVG (no chart lib), Vitest (TS), Go `testing`.

**Spec:** [docs/superpowers/specs/2026-06-05-sprint-metrics-engine-design.md](../specs/2026-06-05-sprint-metrics-engine-design.md)

**Reference patterns (read before starting):**
- Sentinel-clamped read client: `app/lib/apiSite/dependencies.ts`
- Existing line chart (SVG + randomize + structure): `app/components/ThroughputChart.tsx`
- Artefact write txns + diff seam: `backend/internal/artefactitems/service.go` (`CreateWorkItem` L954, `PatchWorkItem` L1208, `diffWorkItem` L116, `fireRuleHook` L90)
- Realtime topic helper: `app/hooks/useRealtimeSubscription.ts` → `rankTopic` (L175)
- Push→refetch: `app/hooks/useRefetchOnPush.ts`
- Page to place into: `app/(user)/value-sprint-review/page.tsx`
- Sprint handler/route: `backend/internal/timeboxsprints/handler.go`, route mount `backend/cmd/server/main.go:1707`
- Flow-state kind vocabulary: `backend/internal/flows/types.go:7` (`backlog|todo|in_progress|done|accepted|cancelled`)

---

## File Structure

**New — engine (shared substrate):**
- `backend/internal/sprintmetrics/types.go` — neutral model structs + event-type constants
- `backend/internal/sprintmetrics/projection.go` — pure replay+derive (ledger rows → neutral model). No DB, no HTTP. The testable core.
- `backend/internal/sprintmetrics/projection_test.go` — table-driven contract test (handoff dataset)
- `backend/internal/sprintmetrics/sql.go` — the ledger SELECT + sprint-window SELECT
- `backend/internal/sprintmetrics/service.go` — fetches rows, calls projection, returns model (on-demand)
- `backend/internal/sprintmetrics/handler.go` — `GET /metrics` handler, Sentinel-clamped
- `backend/internal/sprintmetrics/ledger.go` — `AppendBurnEvents(ctx, tx, before, after, actorID)` in-tx writer + flow-kind lookup
- Migration (via `<migration>` skill) — `sprint_burn_events` table

**New — frontend:**
- `app/lib/apiSite/sprintMetrics.ts` — typed client + wire shapes
- `app/hooks/useSprintMetrics.ts` — shared fetch hook (push + poll + refetch)
- `app/components/charts/sprint/buildBurndownView.ts` — pure model→SVG-paths shaper
- `app/components/charts/sprint/buildBurndownView.test.ts` — path geometry test
- `app/components/SprintBurndownChart.tsx` — dumb SVG renderer

**Modified:**
- `backend/internal/artefactitems/service.go` — call `AppendBurnEvents` before Commit in Create/Patch
- `backend/cmd/server/main.go` — wire sprintmetrics service + route + pg_notify listener topic
- `app/lib/apiSite/index.ts` — re-export sprintMetrics client
- `app/styles/primitives.css` — `--chart-*` token band
- `app/(user)/value-sprint-review/page.tsx` — new `<Panel>` + chart + hook

---

## Task 1: Migration — `sprint_burn_events` ledger

**Files:**
- Create: migration via `<migration>` skill against `vector_artefacts`

- [ ] **Step 1: Scaffold the migration**

Invoke the `<migration>` skill: target DB `vector_artefacts`, name `sprint_burn_events`. It picks the next NNN and writes the BEGIN/COMMIT skeleton. Paste this body inside the transaction:

```sql
CREATE TABLE sprint_burn_events (
  sprint_burn_events_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_burn_events_id_sprint     uuid NOT NULL,
  sprint_burn_events_id_artefact   uuid NOT NULL,
  sprint_burn_events_event_type    text NOT NULL
    CHECK (sprint_burn_events_event_type IN
      ('added','removed','accepted','unaccepted','points_changed')),
  sprint_burn_events_points_delta  integer NOT NULL DEFAULT 0,
  sprint_burn_events_points_after  integer,
  sprint_burn_events_scope_delta   integer NOT NULL DEFAULT 0,
  sprint_burn_events_occurred_at   timestamptz NOT NULL DEFAULT now(),
  sprint_burn_events_id_actor      uuid,
  sprint_burn_events_id_workspace  uuid NOT NULL
);

CREATE INDEX idx_sprint_burn_events_sprint_time
  ON sprint_burn_events (sprint_burn_events_id_sprint, sprint_burn_events_occurred_at);
```

- [ ] **Step 2: Dry-run + apply via the skill**

The `<migration>` skill dry-runs then applies. Expected: `CREATE TABLE` + `CREATE INDEX` succeed, row appended to `schema_migrations`.

- [ ] **Step 3: Verify the table exists**

Run (via `pg-mcp.sh` wrapper or curl per the DIAGNOSE-WITH-DB rule):
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sprint_burn_events' ORDER BY ordinal_position;
```
Expected: the 10 `sprint_burn_events_*` columns listed.

- [ ] **Step 4: Commit**

```bash
git add -A && git diff --cached --stat   # inspect index per HARD RULE
git commit -m "feat(sprintmetrics): add sprint_burn_events ledger [migration]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Engine types — neutral model + event constants

**Files:**
- Create: `backend/internal/sprintmetrics/types.go`

- [ ] **Step 1: Write the types**

```go
// Package sprintmetrics is the shared, on-demand projection engine for
// sprint charts. It replays the sprint_burn_events ledger into a
// neutral, chart-agnostic model (scope/remaining/earned/ideal/cone/
// KPIs/dates). It is NOT a daemon — every call replays fresh and
// returns. Burndown is the first consumer; burnup/velocity/CFD reuse
// the same model with zero backend work.
package sprintmetrics

// Event types — MUST match the migration CHECK constraint. The word
// "completed" is deliberately absent: value is earned ONLY at the
// `accepted` flow kind; its reversal is `unaccepted`.
const (
	EventAdded         = "added"
	EventRemoved       = "removed"
	EventAccepted      = "accepted"
	EventUnaccepted    = "unaccepted"
	EventPointsChanged = "points_changed"
)

// BurnEvent is one ledger row (subset the projection reads).
type BurnEvent struct {
	ArtefactID  string
	EventType   string
	PointsDelta int
	ScopeDelta  int
	OccurredAt  string // RFC3339
}

// Window is the sprint's time frame + derived offsets.
type Window struct {
	Start      string `json:"start"`
	End        string `json:"end"`
	Today      int    `json:"today"`       // day offset of "now" within the window
	SprintDays int    `json:"sprint_days"` // total day span
}

// ScopeChange is one mid-sprint scope delta (drives the "+N" pin).
type ScopeChange struct {
	Day   int `json:"day"`
	Delta int `json:"delta"`
}

// Cone is the forecast band from today to sprint end.
type Cone struct {
	Optimistic  []float64 `json:"optimistic"`
	Pessimistic []float64 `json:"pessimistic"`
}

// KPIs are the headline figures (also consumed by non-chart labels).
type KPIs struct {
	Committed      int     `json:"committed"`
	Remaining      int     `json:"remaining"`
	Velocity       float64 `json:"velocity"`
	DaysLeft       int     `json:"days_left"`
	OnTrack        bool    `json:"on_track"`
	ProjectedShort int     `json:"projected_short"`
}

// Model is the neutral, chart-agnostic projection. Every sprint chart
// reads THIS; charts compute nothing.
type Model struct {
	Window        Window        `json:"window"`
	Scope         []float64     `json:"scope"`          // committed per day
	Remaining     []float64     `json:"remaining"`      // unearned per day (nil past today)
	Earned        []float64     `json:"earned"`         // scope-remaining (burnup reads this)
	Ideal         []float64     `json:"ideal"`          // re-based guideline incl. break (NaN = break)
	IdealOriginal []float64     `json:"ideal_original"` // faint pre-change line
	Cone          Cone          `json:"cone"`
	Velocity      float64       `json:"velocity"`
	ScopeChanges  []ScopeChange `json:"scope_changes"`
	KPIs          KPIs          `json:"kpis"`
}
```

- [ ] **Step 2: Compile-check**

Run: `cd backend && go build ./internal/sprintmetrics/`
Expected: builds clean (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/sprintmetrics/types.go
git commit -m "feat(sprintmetrics): neutral model + event-type constants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Engine projection — the testable core (TDD)

This is the authoritative contract: ledger rows + sprint window → neutral model, using the handoff math. Written test-first.

**Files:**
- Create: `backend/internal/sprintmetrics/projection.go`
- Test: `backend/internal/sprintmetrics/projection_test.go`

- [ ] **Step 1: Write the failing test (handoff reference dataset)**

```go
package sprintmetrics

import (
	"math"
	"testing"
)

// Reconstruct the handoff reference dataset as a synthetic ledger and
// assert the projection reproduces its documented derived values.
// Sprint: 10 days, today=7, baseCommit=80, scopeDay=5, scopeDelta=+12.
// accepted/day (0..7) = [0,4,6,8,7,5,9,9]; remaining ends at 44.
func TestProject_HandoffReference(t *testing.T) {
	// Day-stamped events. Use a fixed sprint window so day offsets are
	// deterministic; occurredAt strings are bucketed by day index.
	in := ProjectInput{
		Window: Window{Start: "2026-01-01", End: "2026-01-11", Today: 7, SprintDays: 10},
		// Day 0: 80 pts of scope added.
		// Day 5: +12 scope added (the re-baseline).
		// accepted burns: cumulative completed by day 7 = 36 → remaining 44.
		Events: handoffSyntheticLedger(),
	}
	m := Project(in)

	if got := m.Remaining[7]; got != 44 {
		t.Fatalf("remaining[7] = %v, want 44", got)
	}
	if got := m.Scope[4]; got != 80 {
		t.Errorf("scope[4] = %v, want 80 (pre-scope-change)", got)
	}
	if got := m.Scope[5]; got != 92 {
		t.Errorf("scope[5] = %v, want 92 (post +12)", got)
	}
	if got := m.Remaining[5]; got != 62 {
		t.Errorf("remaining[5] = %v, want 62 (day-5 up-tick)", got)
	}
	if math.Abs(m.Velocity-7.667) > 0.01 {
		t.Errorf("velocity = %v, want ~7.67", m.Velocity)
	}
	if m.KPIs.ProjectedShort != 21 {
		t.Errorf("projectedShort = %v, want 21", m.KPIs.ProjectedShort)
	}
	if m.KPIs.OnTrack {
		t.Error("onTrack = true, want false (behind)")
	}
	// Ideal re-baselines: segment B starts at 40+12 = 52 on day 5.
	if got := m.Ideal[5]; got != 52 {
		t.Errorf("ideal[5] = %v, want 52 (re-based start)", got)
	}
	if len(m.ScopeChanges) != 1 || m.ScopeChanges[0].Day != 5 || m.ScopeChanges[0].Delta != 12 {
		t.Errorf("scopeChanges = %+v, want [{5 12}]", m.ScopeChanges)
	}
}
```

- [ ] **Step 2: Run — verify it fails to compile/run**

Run: `cd backend && go test ./internal/sprintmetrics/ -run TestProject_HandoffReference -v`
Expected: FAIL — `ProjectInput`, `Project`, `handoffSyntheticLedger` undefined.

- [ ] **Step 3: Implement `projection.go` (ported from handoff data.js)**

```go
package sprintmetrics

import "math"

// ProjectInput is the pure projection's input: the sprint window + the
// ordered ledger rows for that sprint.
type ProjectInput struct {
	Window Window
	Events []BurnEvent
}

// dayIndex buckets an RFC3339 occurredAt into a 0..SprintDays offset.
// Implemented by the caller (service.go); the pure projection receives
// events already tagged via OccurredAt → see eventsByDay below using a
// caller-provided bucketer. For the unit test, handoffSyntheticLedger
// pre-buckets by encoding day as the date component.
func Project(in ProjectInput) Model {
	days := in.Window.SprintDays
	today := in.Window.Today

	// Running totals per day from the ledger.
	scope := make([]float64, days+1)
	remaining := make([]float64, days+1)
	var scopeChanges []ScopeChange

	// Replay: accumulate deltas into the day they occurred, then carry
	// forward. eventsByDay groups Events by their day offset.
	byDay := eventsByDay(in.Events, in.Window)
	var curScope, curRem float64
	for d := 0; d <= days; d++ {
		for _, e := range byDay[d] {
			curScope += float64(e.ScopeDelta)
			curRem += float64(e.PointsDelta)
			if e.EventType == EventAdded && e.ScopeDelta != 0 && d > 0 {
				scopeChanges = append(scopeChanges, ScopeChange{Day: d, Delta: e.ScopeDelta})
			}
		}
		scope[d] = curScope
		if d <= today {
			remaining[d] = curRem
		} else {
			remaining[d] = math.NaN() // actual stops at today
		}
	}

	earned := make([]float64, days+1)
	for d := 0; d <= today; d++ {
		earned[d] = scope[d] - remaining[d]
	}

	// Velocity = mean of completed-per-day over last 3 actual days.
	vel := velocityLast3(earned, today)

	// Ideal guideline with re-baseline at the largest scope change.
	ideal, idealOriginal := buildIdeal(scope, days, scopeChanges)

	// Forecast cone from today.
	remToday := remaining[today]
	daysLeft := days - today
	cone := buildCone(remToday, vel, scope, today, days)
	pessEnd := math.Max(0, remToday-vel*float64(daysLeft))

	return Model{
		Window:        in.Window,
		Scope:         scope,
		Remaining:     remaining,
		Earned:        earned,
		Ideal:         ideal,
		IdealOriginal: idealOriginal,
		Cone:          cone,
		Velocity:      vel,
		ScopeChanges:  scopeChanges,
		KPIs: KPIs{
			Committed:      int(scope[days]),
			Remaining:      int(remToday),
			Velocity:       vel,
			DaysLeft:       daysLeft,
			OnTrack:        pessEnd <= 0,
			ProjectedShort: int(math.Round(pessEnd)),
		},
	}
}

func velocityLast3(earned []float64, today int) float64 {
	if today < 1 {
		return 0
	}
	start := today - 2
	if start < 1 {
		start = 1
	}
	var sum float64
	var n int
	for d := start; d <= today; d++ {
		sum += earned[d] - earned[d-1] // accepted that day
		n++
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

func buildIdeal(scope []float64, days int, changes []ScopeChange) (ideal, original []float64) {
	ideal = make([]float64, days+1)
	original = make([]float64, days+1)
	base := scope[0]
	slope := base / float64(days)
	for d := 0; d <= days; d++ {
		original[d] = base - slope*float64(d)
	}
	if len(changes) == 0 {
		copy(ideal, original)
		return
	}
	// Re-baseline at the (single, largest) scope change day.
	sc := changes[len(changes)-1]
	for d := 0; d < sc.Day; d++ {
		ideal[d] = base - slope*float64(d)
	}
	ideal[sc.Day] = math.NaN() // break marker
	startB := (base - slope*float64(sc.Day)) + float64(sc.Delta)
	slopeB := startB / float64(days-sc.Day)
	// Overwrite from sc.Day with segment B (sc.Day carries the re-based start
	// value for the chart's first segment-B point).
	for d := sc.Day; d <= days; d++ {
		ideal[d] = startB - slopeB*float64(d-sc.Day)
	}
	return
}

func buildCone(remToday, vel float64, scope []float64, today, days int) Cone {
	daysLeft := days - today
	opt := make([]float64, daysLeft+1)
	pess := make([]float64, daysLeft+1)
	pessEnd := math.Max(0, remToday-vel*float64(daysLeft))
	for i := 0; i <= daysLeft; i++ {
		t := float64(i) / float64(daysLeft)
		opt[i] = remToday + (0-remToday)*t
		pess[i] = remToday + (pessEnd-remToday)*t
	}
	return Cone{Optimistic: opt, Pessimistic: pess}
}

// eventsByDay groups events into 0..SprintDays buckets. In production
// the service tags OccurredAt with real timestamps; the bucketer
// compares the date against Window.Start. For the synthetic test,
// handoffSyntheticLedger encodes the day directly in the date.
func eventsByDay(events []BurnEvent, w Window) map[int][]BurnEvent {
	out := map[int][]BurnEvent{}
	for _, e := range events {
		d := dayOffset(w.Start, e.OccurredAt)
		if d < 0 {
			d = 0
		}
		out[d] = append(out[d], e)
	}
	return out
}
```

- [ ] **Step 4: Add the date helper + synthetic-ledger test fixture**

Append to `projection.go`:

```go
// dayOffset returns whole days between start and occurredAt (ISO dates).
// Both are "YYYY-MM-DD" (date component only); the synthetic ledger and
// the service both pass date-only strings.
func dayOffset(start, occurredAt string) int {
	s := parseYMD(start)
	o := parseYMD(occurredAt[:min(10, len(occurredAt))])
	return int(o.Sub(s).Hours() / 24)
}
```

Add to `projection_test.go`:

```go
// handoffSyntheticLedger reconstructs the handoff dataset as ledger
// rows. accepted/day (0..7) = [0,4,6,8,7,5,9,9]; +12 scope on day 5.
func handoffSyntheticLedger() []BurnEvent {
	day := func(n int) string {
		// 2026-01-01 + n days, naive (Jan has 31 days, n<=10).
		return "2026-01-" + twodigit(1+n)
	}
	var ev []BurnEvent
	// Day 0: 80 pts committed (one lump "added").
	ev = append(ev, BurnEvent{ArtefactID: "seed", EventType: EventAdded,
		ScopeDelta: 80, PointsDelta: 80, OccurredAt: day(0)})
	// accepted burns each day (negative remaining delta).
	accepted := []int{0, 4, 6, 8, 7, 5, 9, 9}
	for d := 1; d <= 7; d++ {
		if accepted[d] == 0 {
			continue
		}
		ev = append(ev, BurnEvent{ArtefactID: "x", EventType: EventAccepted,
			PointsDelta: -accepted[d], OccurredAt: day(d)})
	}
	// Day 5: +12 scope landed (adds to scope AND remaining).
	ev = append(ev, BurnEvent{ArtefactID: "creep", EventType: EventAdded,
		ScopeDelta: 12, PointsDelta: 12, OccurredAt: day(5)})
	return ev
}

func twodigit(n int) string {
	if n < 10 {
		return "0" + string(rune('0'+n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}
```

Add `parseYMD`, `min`, `twodigit` helpers to `projection.go` (Go <1.21 has no builtin `min` for ints — define one):

```go
import "time"

func parseYMD(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}
func min(a, b int) int { if a < b { return a }; return b }
```

> NOTE: verify the day-5 up-tick. accepted cumulative by day 5 = 0+4+6+8+7+5 = 30; scope day5 = 92; remaining = 92-30 = 62. ✓ matches handoff. remaining[7]: accepted cum&nbsp;= 30+9+9 = 48; scope = 92; remaining = 44. ✓

- [ ] **Step 5: Run — verify it passes**

Run: `cd backend && go test ./internal/sprintmetrics/ -run TestProject_HandoffReference -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/sprintmetrics/projection.go backend/internal/sprintmetrics/projection_test.go
git commit -m "feat(sprintmetrics): pure projection engine + handoff contract test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Engine SQL + service (on-demand fetch)

**Files:**
- Create: `backend/internal/sprintmetrics/sql.go`, `backend/internal/sprintmetrics/service.go`

- [ ] **Step 1: Write the SQL**

```go
package sprintmetrics

// sqlSelectBurnEvents — ordered ledger rows for one sprint, clamped to
// workspace (defence-in-depth alongside the handler's Sentinel clamp).
const sqlSelectBurnEvents = `
	SELECT sprint_burn_events_id_artefact,
	       sprint_burn_events_event_type,
	       sprint_burn_events_points_delta,
	       sprint_burn_events_scope_delta,
	       to_char(sprint_burn_events_occurred_at, 'YYYY-MM-DD') AS occurred_day
	FROM   sprint_burn_events
	WHERE  sprint_burn_events_id_sprint   = $1
	  AND  sprint_burn_events_id_workspace = $2
	ORDER  BY sprint_burn_events_occurred_at ASC`

// sqlSelectSprintWindow — the sprint's date window + status for bucketing.
const sqlSelectSprintWindow = `
	SELECT to_char(timeboxes_sprints_date_start, 'YYYY-MM-DD'),
	       to_char(timeboxes_sprints_date_end,   'YYYY-MM-DD')
	FROM   timeboxes_sprints
	WHERE  timeboxes_sprints_id = $1`
```

- [ ] **Step 2: Write the service (on-demand — no daemon, no cache)**

```go
package sprintmetrics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the on-demand engine. It holds only a pool; every call
// replays the ledger fresh. No background goroutine, no cache.
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Metrics fetches the ledger + window for one sprint and projects the
// neutral model. workspaceID is the Sentinel clamp (caller resolves it).
func (s *Service) Metrics(ctx context.Context, sprintID, workspaceID uuid.UUID) (Model, error) {
	var start, end string
	if err := s.pool.QueryRow(ctx, sqlSelectSprintWindow, sprintID).Scan(&start, &end); err != nil {
		return Model{}, fmt.Errorf("sprintmetrics: window: %w", err)
	}
	rows, err := s.pool.Query(ctx, sqlSelectBurnEvents, sprintID, workspaceID)
	if err != nil {
		return Model{}, fmt.Errorf("sprintmetrics: events: %w", err)
	}
	defer rows.Close()
	var events []BurnEvent
	for rows.Next() {
		var e BurnEvent
		if err := rows.Scan(&e.ArtefactID, &e.EventType, &e.PointsDelta, &e.ScopeDelta, &e.OccurredAt); err != nil {
			return Model{}, err
		}
		events = append(events, e)
	}
	w := buildWindow(start, end)
	return Project(ProjectInput{Window: w, Events: events}), nil
}

// buildWindow computes day span + today offset from the sprint dates.
func buildWindow(start, end string) Window {
	s := parseYMD(start)
	e := parseYMD(end)
	span := int(e.Sub(s).Hours() / 24)
	if span < 0 {
		span = 0
	}
	today := int(time.Now().UTC().Sub(s).Hours() / 24)
	if today < 0 {
		today = 0
	}
	if today > span {
		today = span
	}
	return Window{Start: start, End: end, Today: today, SprintDays: span}
}
```

- [ ] **Step 3: Compile-check**

Run: `cd backend && go build ./internal/sprintmetrics/`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/sprintmetrics/sql.go backend/internal/sprintmetrics/service.go
git commit -m "feat(sprintmetrics): on-demand service + ledger SQL

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Engine handler (`GET /metrics`, Sentinel-clamped)

**Files:**
- Create: `backend/internal/sprintmetrics/handler.go`

- [ ] **Step 1: Write the handler**

```go
package sprintmetrics

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

// Metrics handles GET /_site/timeboxes/sprints/{id}/metrics.
// Sentinel establishes the workspace clamp server-side (fail-closed);
// the sprint id is the only selection input.
func (h *Handler) Metrics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := sentinel.WorkspaceIDFromCtx(ctx)
	if wsID == uuid.Nil {
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
		httperr.Write(w, r, http.StatusInternalServerError, "metrics projection failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(model)
}
```

- [ ] **Step 2: Verify `sentinel.WorkspaceIDFromCtx` + `httperr.Write` signatures**

Run: `grep -n "func WorkspaceIDFromCtx" backend/internal/sentinel/*.go && grep -n "func Write" backend/internal/httperr/*.go`
Expected: both exist. If `httperr.Write` has a different signature, adapt the calls (match the timeboxsprints handler's error style).

- [ ] **Step 3: Compile-check**

Run: `cd backend && go build ./internal/sprintmetrics/`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/sprintmetrics/handler.go
git commit -m "feat(sprintmetrics): Sentinel-clamped /metrics handler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: In-tx ledger capture (the correctness-critical part, TDD)

**Files:**
- Create: `backend/internal/sprintmetrics/ledger.go`
- Modify: `backend/internal/artefactitems/service.go` (call site before each Commit)
- Test: `backend/internal/sprintmetrics/ledger_test.go`

- [ ] **Step 1: Write the failing test for event-derivation logic**

```go
package sprintmetrics

import "testing"

// DeriveBurnEvents is the pure decision: given before/after artefact
// state + the resolved flow kinds, what ledger rows (if any) fire?
func TestDeriveBurnEvents_AcceptedBurnsDown(t *testing.T) {
	got := DeriveBurnEvents(ArtefactDelta{
		SprintID:       "s1", // unchanged, in sprint
		BeforeSprintID: "s1",
		AfterSprintID:  "s1",
		BeforeKind:     "in_progress",
		AfterKind:      "accepted",
		Points:         5,
		IsAuthoritative: true,
	})
	if len(got) != 1 || got[0].EventType != EventAccepted || got[0].PointsDelta != -5 {
		t.Fatalf("accepted transition = %+v, want one accepted -5", got)
	}
}

func TestDeriveBurnEvents_UnacceptedRestores(t *testing.T) {
	got := DeriveBurnEvents(ArtefactDelta{
		BeforeSprintID: "s1", AfterSprintID: "s1",
		BeforeKind: "accepted", AfterKind: "done", // leaving accepted, even to done
		Points: 5, IsAuthoritative: true,
	})
	if len(got) != 1 || got[0].EventType != EventUnaccepted || got[0].PointsDelta != 5 {
		t.Fatalf("unaccepted transition = %+v, want one unaccepted +5", got)
	}
}

func TestDeriveBurnEvents_DoneEarnsNothing(t *testing.T) {
	got := DeriveBurnEvents(ArtefactDelta{
		BeforeSprintID: "s1", AfterSprintID: "s1",
		BeforeKind: "in_progress", AfterKind: "done", // never crosses accepted
		Points: 5, IsAuthoritative: true,
	})
	if len(got) != 0 {
		t.Fatalf("done transition = %+v, want NO events", got)
	}
}

func TestDeriveBurnEvents_AddedAndRemoved(t *testing.T) {
	add := DeriveBurnEvents(ArtefactDelta{
		BeforeSprintID: "", AfterSprintID: "s1",
		BeforeKind: "todo", AfterKind: "todo", Points: 8, IsAuthoritative: true,
	})
	if len(add) != 1 || add[0].EventType != EventAdded || add[0].ScopeDelta != 8 || add[0].PointsDelta != 8 {
		t.Fatalf("add = %+v, want added scope+8 pts+8", add)
	}
	// Removing an ALREADY-ACCEPTED item: scope drops, remaining does NOT.
	rem := DeriveBurnEvents(ArtefactDelta{
		BeforeSprintID: "s1", AfterSprintID: "",
		BeforeKind: "accepted", AfterKind: "accepted", Points: 8, IsAuthoritative: true,
	})
	if len(rem) != 1 || rem[0].EventType != EventRemoved || rem[0].ScopeDelta != -8 || rem[0].PointsDelta != 0 {
		t.Fatalf("remove-accepted = %+v, want removed scope-8 pts0", rem)
	}
}

func TestDeriveBurnEvents_NonAuthoritativeChildEmitsNothing(t *testing.T) {
	got := DeriveBurnEvents(ArtefactDelta{
		BeforeSprintID: "s1", AfterSprintID: "s1",
		BeforeKind: "in_progress", AfterKind: "accepted",
		Points: 5, IsAuthoritative: false, // a child — derives state up, no emit
	})
	if len(got) != 0 {
		t.Fatalf("child emit = %+v, want none", got)
	}
}
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd backend && go test ./internal/sprintmetrics/ -run TestDeriveBurnEvents -v`
Expected: FAIL — `DeriveBurnEvents`, `ArtefactDelta` undefined.

- [ ] **Step 3: Implement `ledger.go`**

```go
package sprintmetrics

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ArtefactDelta is the before/after slice the capture logic needs.
// Kinds are the resolved flows_states_kind for the PARENT (authoritative)
// flow state; the caller does the parent resolution + kind lookup.
type ArtefactDelta struct {
	ArtefactID      string
	SprintID        string // current (after) sprint, for points_changed
	BeforeSprintID  string
	AfterSprintID   string
	BeforeKind      string
	AfterKind       string
	BeforePoints    int
	AfterPoints     int
	Points          int // convenience = AfterPoints for add/accept paths
	IsAuthoritative bool
}

type pendingEvent struct {
	SprintID    string
	ArtefactID  string
	EventType   string
	PointsDelta int
	ScopeDelta  int
	PointsAfter int
}

const kindAccepted = "accepted"

// DeriveBurnEvents is the pure decision function (no DB). Returns the
// ledger rows a single artefact write should append.
func DeriveBurnEvents(d ArtefactDelta) []pendingEvent {
	if !d.IsAuthoritative {
		return nil
	}
	var out []pendingEvent

	// Sprint membership change.
	if d.BeforeSprintID != d.AfterSprintID {
		switch {
		case d.BeforeSprintID == "" && d.AfterSprintID != "": // added
			out = append(out, pendingEvent{
				SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID,
				EventType: EventAdded, ScopeDelta: d.Points, PointsDelta: d.Points,
				PointsAfter: d.Points,
			})
		case d.BeforeSprintID != "" && d.AfterSprintID == "": // removed
			// scope always drops; remaining drops only if it was unaccepted.
			rem := d.Points
			if d.BeforeKind == kindAccepted {
				rem = 0 // already burned
			}
			out = append(out, pendingEvent{
				SprintID: d.BeforeSprintID, ArtefactID: d.ArtefactID,
				EventType: EventRemoved, ScopeDelta: -d.Points, PointsDelta: -rem,
			})
		}
		return out // membership change dominates; skip kind logic this write
	}

	// Flow-kind acceptance crossing (only when in a sprint).
	if d.AfterSprintID != "" && d.BeforeKind != d.AfterKind {
		switch {
		case d.AfterKind == kindAccepted && d.BeforeKind != kindAccepted:
			out = append(out, pendingEvent{
				SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID,
				EventType: EventAccepted, PointsDelta: -d.Points, PointsAfter: d.Points,
			})
		case d.BeforeKind == kindAccepted && d.AfterKind != kindAccepted:
			out = append(out, pendingEvent{
				SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID,
				EventType: EventUnaccepted, PointsDelta: d.Points, PointsAfter: d.Points,
			})
		}
	}

	// Points change while in sprint (and not the add/remove path).
	if d.AfterSprintID != "" && d.BeforeSprintID == d.AfterSprintID && d.BeforePoints != d.AfterPoints {
		delta := d.AfterPoints - d.BeforePoints
		rem := delta
		if d.AfterKind == kindAccepted {
			rem = 0 // accepted: remaining already excludes it
		}
		out = append(out, pendingEvent{
			SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID,
			EventType: EventPointsChanged, ScopeDelta: delta, PointsDelta: rem,
			PointsAfter: d.AfterPoints,
		})
	}
	return out
}

// AppendBurnEvents derives + writes ledger rows inside the caller's tx.
// Called from artefactitems Create/Patch BEFORE Commit, so a failure
// here rolls back the whole artefact write (audit-grade atomicity).
func AppendBurnEvents(ctx context.Context, tx pgx.Tx, d ArtefactDelta, actorID, workspaceID uuid.UUID) error {
	for _, e := range DeriveBurnEvents(d) {
		_, err := tx.Exec(ctx, `
			INSERT INTO sprint_burn_events (
				sprint_burn_events_id_sprint, sprint_burn_events_id_artefact,
				sprint_burn_events_event_type, sprint_burn_events_points_delta,
				sprint_burn_events_points_after, sprint_burn_events_scope_delta,
				sprint_burn_events_id_actor, sprint_burn_events_id_workspace)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			e.SprintID, e.ArtefactID, e.EventType, e.PointsDelta,
			e.PointsAfter, e.ScopeDelta, actorID, workspaceID)
		if err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 4: Run — verify the derivation tests pass**

Run: `cd backend && go test ./internal/sprintmetrics/ -run TestDeriveBurnEvents -v`
Expected: all 5 PASS.

- [ ] **Step 5: Wire the in-tx call into artefactitems**

In `backend/internal/artefactitems/service.go`, locate `CreateWorkItem`'s `tx.Commit(ctx)` (L1168) and `PatchWorkItem`'s `tx.Commit(ctx)` (L2171). Immediately BEFORE each Commit, add (adapting field access to the WorkItem struct + the resolved parent kind):

```go
	// Sprint burn-event capture — in-tx so the ledger can never drift
	// from the artefact state (audit-grade, defence/finance bar).
	// before/after are the WorkItem snapshots already in scope; kinds
	// are the authoritative PARENT flow-state kinds (resolveParentKind
	// reuses the roll-up cascade — see service.go:1198+).
	if berr := sprintmetrics.AppendBurnEvents(ctx, tx, sprintmetrics.ArtefactDelta{
		ArtefactID:      item.ID,
		BeforeSprintID:  strDeref(beforeSprintID),
		AfterSprintID:   strDeref(item.SprintID),
		BeforeKind:      beforeParentKind,
		AfterKind:       afterParentKind,
		BeforePoints:    intDeref(beforeStoryPoints),
		AfterPoints:     intDeref(item.StoryPoints),
		Points:          intDeref(item.StoryPoints),
		IsAuthoritative: isAuthoritativeParent,
	}, authorUserID, workspaceID); berr != nil {
		return nil, fmt.Errorf("burn-event capture: %w", berr)
	}
```

> The Create branch passes `BeforeSprintID:""`, `BeforeKind:""`, `BeforePoints:0` (new row). Add small helpers `strDeref(*string) string` and `intDeref(*int) int` if not present. `beforeParentKind`/`afterParentKind`/`isAuthoritativeParent` come from a `resolveParentKind` helper — see Step 6.

- [ ] **Step 6: Add the parent-kind resolver in artefactitems**

The capture needs the authoritative parent's flow-state kind before/after. Add a helper that, given the item, returns whether THIS row is the authoritative one and its before/after kinds. Reuse the cascade guard logic at `service.go:1198+`. Minimal version (verify against the real cascade rule):

```go
// resolveParentKind reports whether `item` is the authoritative flow-
// state owner (a parent, or a leaf with no children — work flows UP)
// and resolves its before/after flows_states_kind for burn capture.
func (s *Service) resolveParentKind(ctx context.Context, tx pgx.Tx,
	beforeFlowStateID, afterFlowStateID *string) (before, after string, authoritative bool, err error) {
	// A row whose flow state is DERIVED from children is not
	// authoritative for value-earned (children already emitted).
	// Look up kind by flow_state_id.
	kindOf := func(id *string) (string, error) {
		if id == nil || *id == "" {
			return "", nil
		}
		var k string
		e := tx.QueryRow(ctx,
			`SELECT flows_states_kind FROM flows_states WHERE flows_states_id = $1`, *id).Scan(&k)
		return k, e
	}
	before, err = kindOf(beforeFlowStateID)
	if err != nil {
		return
	}
	after, err = kindOf(afterFlowStateID)
	if err != nil {
		return
	}
	// authoritative = this row's state is NOT derived from children.
	// Reuse existing helper; placeholder true for leaf items.
	authoritative = s.isAuthoritativeFlowOwner(ctx, tx /* item id */)
	return
}
```

> IMPORTANT: `isAuthoritativeFlowOwner` must mirror the EXISTING roll-up rule (the parent-derives-from-children guard). Find that predicate at `service.go:1198+` and reuse it — do NOT invent a new one. If it's inlined, extract it to a named method first so both sites share it.

- [ ] **Step 7: Add the import + build**

Add `"github.com/mmffdev/vector-backend/internal/sprintmetrics"` to artefactitems imports.
Run: `cd backend && go build ./... && go test ./internal/sprintmetrics/ -v`
Expected: builds clean; all sprintmetrics tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/sprintmetrics/ledger.go backend/internal/sprintmetrics/ledger_test.go backend/internal/artefactitems/service.go
git diff --cached --stat   # HARD RULE: inspect index
git commit -m "feat(sprintmetrics): in-tx burn-event capture (accepted/unaccepted semantics)

Value earned ONLY at flows_states_kind=accepted on the authoritative
parent; reversible via unaccepted. Captured in the artefact write tx so
the ledger can never drift. done/completed never earn value.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire the route + pg_notify in main.go

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Construct the service + handler**

Near the sprint handler construction (`main.go:900-905`), add:

```go
	sprintMetricsSvc := sprintmetrics.NewService(vaPool)
	sprintMetricsH := sprintmetrics.NewHandler(sprintMetricsSvc)
```

Add the import `"github.com/mmffdev/vector-backend/internal/sprintmetrics"` to main.go.

- [ ] **Step 2: Mount the route**

Inside the existing `r.Route("/timeboxes/sprints", …)` block (`main.go:1709`), add alongside `r.Get("/{id}", sprintH.Get)`:

```go
			r.Get("/{id}/metrics", sprintMetricsH.Metrics)
```

- [ ] **Step 3: Add the pg_notify post-commit fire in artefactitems**

After each successful `tx.Commit(ctx)` in Create/Patch (artefactitems/service.go), fire the wake-up (best-effort; losing it is harmless — poll/refresh recovers):

```go
	// Wake any live burndown viewers. Best-effort, post-commit.
	if item.SprintID != nil {
		_, _ = s.vectorArtefactsPool.Exec(ctx,
			`SELECT pg_notify('sprint_burn_changed', $1)`, *item.SprintID)
	}
```

> Verify a LISTEN consumer exists: the realtime `listener.go` already forwards pg_notify payloads to `hub.Publish`. Confirm `sprint_burn_changed` is added to the channels it listens on (grep `listener.go` for the LISTEN list; add the channel if needed, mapping payload→topic `rank:work_item:…:sprint:<id>` OR a dedicated `sprint_burn:<id>` topic — match the existing convention).

- [ ] **Step 4: Build the whole backend**

Run: `cd backend && go build ./...`
Expected: builds clean.

- [ ] **Step 5: Manual smoke test against dev**

Start the dev server (it's already pinned to dev). With the DEV_API_KEY:
```bash
curl -s -H "Authorization: Bearer $DEV_API_KEY" \
  "http://localhost:5100/_site/timeboxes/sprints/<a-real-sprint-id>/metrics" | head -40
```
Expected: a JSON `Model` (likely near-empty arrays for a sprint with no ledger events yet — that's correct go-forward behaviour). No 500.

- [ ] **Step 6: Commit**

```bash
git add backend/cmd/server/main.go backend/internal/artefactitems/service.go
git diff --cached --stat
git commit -m "feat(sprintmetrics): mount /metrics route + pg_notify wake-up

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Frontend client + shared hook

**Files:**
- Create: `app/lib/apiSite/sprintMetrics.ts`, `app/hooks/useSprintMetrics.ts`
- Modify: `app/lib/apiSite/index.ts`

- [ ] **Step 1: Write the typed client (mirror dependencies.ts)**

```ts
/**
 * sprintMetrics — typed client for the sprint metrics engine.
 *
 * Backend: backend/internal/sprintmetrics/handler.go mounted at
 *   GET /_site/timeboxes/sprints/{id}/metrics
 *
 * Sentinel enforces the workspace clamp server-side; the client just
 * calls and renders. Wire shapes mirror sprintmetrics/types.go (Model).
 * This is the ONE source every sprint chart reads — charts are dumb.
 */
import { apiSite } from "@/app/lib/api";
import type { ID } from "@/app/lib/apiSite";

export interface SprintWindow {
  start: string;
  end: string;
  today: number;
  sprint_days: number;
}
export interface SprintScopeChange { day: number; delta: number; }
export interface SprintCone { optimistic: number[]; pessimistic: number[]; }
export interface SprintKPIs {
  committed: number; remaining: number; velocity: number;
  days_left: number; on_track: boolean; projected_short: number;
}
/** Mirrors sprintmetrics.Model. NaN in arrays = break/no-actual. */
export interface SprintMetricsModel {
  window: SprintWindow;
  scope: number[];
  remaining: number[];
  earned: number[];
  ideal: number[];
  ideal_original: number[];
  cone: SprintCone;
  velocity: number;
  scope_changes: SprintScopeChange[];
  kpis: SprintKPIs;
}

export const sprintMetrics = {
  get: (sprintId: ID): Promise<SprintMetricsModel> =>
    apiSite(`/timeboxes/sprints/${sprintId}/metrics`),
};
```

> Verify the `apiSite(...)` call convention against dependencies.ts (it may be `apiSite.get(...)` or `apiSite("GET", ...)`). Match exactly.

- [ ] **Step 2: Re-export from index.ts**

Add to `app/lib/apiSite/index.ts`:
```ts
export { sprintMetrics } from "./sprintMetrics";
export type { SprintMetricsModel } from "./sprintMetrics";
```

- [ ] **Step 3: Write the shared hook**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sprintMetrics, type SprintMetricsModel } from "@/app/lib/apiSite";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";

/**
 * useSprintMetrics — the single source for every sprint chart. Fetches
 * the neutral model on demand (engine starts up per call), auto-refreshes
 * on any ledger write via the realtime push channel, polls every 60s as
 * a fallback, and exposes refetch() for a manual refresh button.
 */
export function useSprintMetrics(sprintId: string | null) {
  const [model, setModel] = useState<SprintMetricsModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sprintId) { setModel(null); return; }
    setLoading(true); setError(null);
    try {
      setModel(await sprintMetrics.get(sprintId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [sprintId]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh on ledger writes. Topic mirrors rankTopic convention.
  const topic = sprintId ? `sprint_burn:${sprintId}` : null;
  useRefetchOnPush({ topic, refetch: load });

  // 60s poll fallback.
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

> The `topic` string MUST match whatever the backend pg_notify→hub mapping publishes (Task 7 Step 3). If the backend reuses `rankTopic("work_item", subID, "sprint", sprintId)`, import and use that instead. Align the two before finishing.

- [ ] **Step 4: Typecheck**

Run: `npm run lint:tsc` (or the project's tsc check — verify the script name in package.json)
Expected: no type errors in the new files.

- [ ] **Step 5: Commit**

```bash
git add app/lib/apiSite/sprintMetrics.ts app/lib/apiSite/index.ts app/hooks/useSprintMetrics.ts
git commit -m "feat(sprintmetrics): typed client + shared useSprintMetrics hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Chart colour tokens

**Files:**
- Modify: `app/styles/primitives.css`

- [ ] **Step 1: Add the `--chart-*` band**

In `app/styles/primitives.css`, inside `:root { … }` (after the STATUS block, ~L143), add:

```css
  /* ── CHART — sprint series (scoped colour exception, see handoff) ──
     Burndown/burnup series colours. A deliberate, documented exception
     to the monochrome-charts rule. Themeable; charts reference these
     tokens, never raw hex. */
  --chart-actual:        #E5392B;
  --chart-actual-fill-0: rgba(229, 57, 43, 0.26);
  --chart-actual-fill-1: rgba(229, 57, 43, 0.02);
  --chart-optimistic:    #2F7D54;   /* == --status-success */
  --chart-pessimistic:   #B7791F;   /* == --status-warning */
  --chart-scope:         #2F5F8A;
  --chart-cone-band:     rgba(26, 26, 26, 0.05);
  --chart-scope-region:  rgba(26, 26, 26, 0.025);
```

- [ ] **Step 2: Visual sanity (tokens resolve)**

Run: `grep -n "chart-actual" app/styles/primitives.css`
Expected: the tokens are present in `:root`.

- [ ] **Step 3: Commit**

```bash
git add app/styles/primitives.css
git commit -m "feat(sprintmetrics): --chart-* series tokens for sprint charts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Pure view-shaper (model → SVG paths, TDD)

**Files:**
- Create: `app/components/charts/sprint/buildBurndownView.ts`
- Test: `app/components/charts/sprint/buildBurndownView.test.ts`

- [ ] **Step 1: Write the failing test (geometry contract)**

```ts
import { describe, it, expect } from "vitest";
import { buildBurndownView, VB } from "./buildBurndownView";
import type { SprintMetricsModel } from "@/app/lib/apiSite";

const model: SprintMetricsModel = {
  window: { start: "2026-01-01", end: "2026-01-11", today: 7, sprint_days: 10 },
  scope: [80, 80, 80, 80, 80, 92, 92, 92, 92, 92, 92],
  remaining: [80, 76, 70, 62, 55, 62, 53, 44, NaN, NaN, NaN],
  earned: [0, 4, 10, 18, 25, 30, 39, 48, 0, 0, 0],
  ideal: [80, 72, 64, 56, 48, 52, 41.6, 31.2, 20.8, 10.4, 0],
  ideal_original: [80, 72, 64, 56, 48, 40, 32, 24, 16, 8, 0],
  cone: { optimistic: [44, 29.3, 14.7, 0], pessimistic: [44, 36.3, 28.7, 21] },
  velocity: 7.67,
  scope_changes: [{ day: 5, delta: 12 }],
  kpis: { committed: 92, remaining: 44, velocity: 7.67, days_left: 3, on_track: false, projected_short: 21 },
};

describe("buildBurndownView", () => {
  it("maps day 0 to the left plot inset and day 10 to the right", () => {
    const v = buildBurndownView(model);
    expect(v.x(0)).toBeCloseTo(VB.plotL, 1);
    expect(v.x(10)).toBeCloseTo(VB.plotL + VB.plotW, 1);
  });

  it("maps value 0 to the baseline and 100 to the top", () => {
    const v = buildBurndownView(model);
    expect(v.y(0)).toBeCloseTo(VB.plotT + VB.plotH, 1);
    expect(v.y(100)).toBeCloseTo(VB.plotT, 1);
  });

  it("stops the actual path at today (no NaN points drawn)", () => {
    const v = buildBurndownView(model);
    // actual path should not contain 'NaN'
    expect(v.actualPath).not.toContain("NaN");
    // and should include the day-7 remaining=44 point's y
    expect(v.actualPath.length).toBeGreaterThan(0);
  });

  it("emits the ideal as two segments around the break", () => {
    const v = buildBurndownView(model);
    // segment A (days 0-4) + segment B (days 5-10) → 2 'M' move commands
    const moves = (v.idealPath.match(/M/g) || []).length;
    expect(moves).toBe(2);
  });

  it("exposes the scope pin at day 5 with the +12 label", () => {
    const v = buildBurndownView(model);
    expect(v.scopePins).toHaveLength(1);
    expect(v.scopePins[0].label).toBe("+12");
    expect(v.scopePins[0].x).toBeCloseTo(v.x(5), 1);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run app/components/charts/sprint/buildBurndownView.test.ts`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Implement `buildBurndownView.ts`**

```ts
import type { SprintMetricsModel } from "@/app/lib/apiSite";

// Viewbox geometry — exact values from the handoff prototype.
export const VB = {
  W: 560, H: 300,
  plotL: 38, plotT: 16, plotW: 560 - 38 - 16, plotH: 300 - 16 - 26,
  yMax: 100,
};

export interface ScopePin { x: number; y: number; label: string; }
export interface BurndownView {
  x: (day: number) => number;
  y: (val: number) => number;
  actualPath: string;       // smoothed remaining[], stops at today
  areaPath: string;         // actual area down to baseline (gradient fill)
  idealPath: string;        // two segments around the break
  idealOriginalPath: string;
  optimisticPath: string;
  pessimisticPath: string;
  conePath: string;         // filled band between opt + pess
  scopePins: ScopePin[];
  scopeRegionX: number | null; // left edge of shaded post-scope region
  markers: { x: number; y: number }[];
  todayX: number;
}

const sprintDaysOf = (m: SprintMetricsModel) => m.window.sprint_days;

function mkX(m: SprintMetricsModel) {
  const days = sprintDaysOf(m);
  return (day: number) => VB.plotL + (day / days) * VB.plotW;
}
function mkY() {
  return (val: number) => VB.plotT + (1 - val / VB.yMax) * VB.plotH;
}

// Catmull-Rom → cubic Bézier smoothing, matching chartkit.js.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) return polyline(pts);
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} `;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} `;
  }
  return d.trim();
}
function polyline(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

export function buildBurndownView(m: SprintMetricsModel): BurndownView {
  const x = mkX(m), y = mkY();
  const days = sprintDaysOf(m);
  const today = m.window.today;

  // Actual: remaining[0..today], skip NaN.
  const actualPts = [];
  for (let d = 0; d <= today; d++) {
    if (!Number.isNaN(m.remaining[d])) actualPts.push({ x: x(d), y: y(m.remaining[d]) });
  }
  const actualPath = smoothPath(actualPts);
  const baseY = y(0);
  const areaPath = actualPts.length
    ? `${actualPath} L${actualPts[actualPts.length - 1].x.toFixed(1)} ${baseY.toFixed(1)} L${actualPts[0].x.toFixed(1)} ${baseY.toFixed(1)} Z`
    : "";

  // Ideal: split into two segments at the NaN break.
  const idealPath = segmentedPath(m.ideal, x, y);
  const idealOriginalPath = polyline(m.ideal_original.map((v, d) => ({ x: x(d), y: y(v) })));

  // Forecast cone: opt/pess start at `today`.
  const coneDays = m.cone.optimistic.map((_, i) => today + i);
  const optimisticPath = polyline(m.cone.optimistic.map((v, i) => ({ x: x(coneDays[i]), y: y(v) })));
  const pessimisticPath = polyline(m.cone.pessimistic.map((v, i) => ({ x: x(coneDays[i]), y: y(v) })));
  const conePath =
    m.cone.optimistic.length && m.cone.pessimistic.length
      ? `${m.cone.pessimistic.map((v, i) => `${x(coneDays[i]).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} ` +
        `${m.cone.optimistic.slice().reverse().map((v, i) => { const idx = m.cone.optimistic.length - 1 - i; return `${x(coneDays[idx]).toFixed(1)},${y(v).toFixed(1)}`; }).join(" ")}`
      : "";

  // Scope pins + region.
  const scopePins: ScopePin[] = m.scope_changes.map((sc) => ({
    x: x(sc.day), y: VB.plotT + 8, label: (sc.delta > 0 ? "+" : "") + sc.delta,
  }));
  const scopeRegionX = m.scope_changes.length ? x(m.scope_changes[0].day) : null;

  const markers = actualPts.map((p) => ({ x: p.x, y: p.y }));

  return {
    x, y, actualPath, areaPath, idealPath, idealOriginalPath,
    optimisticPath, pessimisticPath, conePath, scopePins, scopeRegionX,
    markers, todayX: x(today),
  };
}

// segmentedPath draws straight segments, breaking on NaN.
function segmentedPath(vals: number[], x: (d: number) => number, y: (v: number) => number): string {
  let d = "";
  let started = false;
  for (let i = 0; i < vals.length; i++) {
    if (Number.isNaN(vals[i])) { started = false; continue; }
    const cmd = started ? "L" : "M";
    d += `${cmd}${x(i).toFixed(1)} ${y(vals[i]).toFixed(1)} `;
    started = true;
  }
  return d.trim();
}
```

> NOTE on the ideal break: the engine sets `ideal[5] = NaN` for the break, but the test fixture above has `ideal[5] = 52` (segment-B start). Reconcile: the engine should emit the break as a SEPARATE signal OR the shaper splits on the slope discontinuity. SIMPLEST: engine emits TWO arrays — `idealA` (days 0..scopeDay) and `idealB` (scopeDay..end) — instead of one with a NaN. **Update `types.go`/`projection.go` to emit `IdealA`/`IdealB` and adjust this shaper + both tests accordingly.** Pick this cleaner shape during implementation and keep the "2 segments" test assertion.

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run app/components/charts/sprint/buildBurndownView.test.ts`
Expected: all assertions PASS (after the idealA/idealB reconciliation above).

- [ ] **Step 5: Commit**

```bash
git add app/components/charts/sprint/buildBurndownView.ts app/components/charts/sprint/buildBurndownView.test.ts
git commit -m "feat(sprintmetrics): pure model→SVG-path view-shaper + geometry test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Dumb chart component

**Files:**
- Create: `app/components/SprintBurndownChart.tsx`

- [ ] **Step 1: Write the component (model in, SVG out — computes nothing)**

```tsx
"use client";

import { buildBurndownView } from "@/app/components/charts/sprint/buildBurndownView";
import type { SprintMetricsModel } from "@/app/lib/apiSite";

// Sprint burndown — DUMB renderer. Receives the engine's neutral model,
// calls buildBurndownView for SVG geometry, draws. No metrics math here.
// Colours come from --chart-* tokens (themeable). Aperture rule:
// connectors/regions/lines first, markers + pin last.

export default function SprintBurndownChart({ model }: { model: SprintMetricsModel }) {
  const v = buildBurndownView(model);
  const gid = "burndownGradient";

  return (
    <div className="sprint-burndown">
      <svg viewBox="0 0 560 300" width="100%" height={300} role="img"
        aria-label="Sprint burndown chart" className="sprint-burndown__svg">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="sprint-burndown__grad-0" />
            <stop offset="100%" className="sprint-burndown__grad-1" />
          </linearGradient>
        </defs>

        {/* PASS 1 — regions, gridlines, bands, lines (connectors) */}
        {v.scopeRegionX !== null && (
          <rect className="sprint-burndown__scope-region"
            x={v.scopeRegionX} y={16} width={560 - 16 - v.scopeRegionX} height={300 - 16 - 26} />
        )}
        {v.conePath && <polygon className="sprint-burndown__cone" points={v.conePath} />}
        {v.areaPath && <path className="sprint-burndown__area" d={v.areaPath} fill={`url(#${gid})`} />}
        <path className="sprint-burndown__ideal-original" d={v.idealOriginalPath} fill="none" />
        <path className="sprint-burndown__ideal" d={v.idealPath} fill="none" />
        <path className="sprint-burndown__optimistic" d={v.optimisticPath} fill="none" />
        <path className="sprint-burndown__pessimistic" d={v.pessimisticPath} fill="none" />
        <line className="sprint-burndown__today" x1={v.todayX} x2={v.todayX} y1={16} y2={300 - 26} />
        <path className="sprint-burndown__actual" d={v.actualPath} fill="none" />

        {/* PASS 2 — markers + pin painted on top (Aperture rule) */}
        {v.markers.map((p, i) => (
          <circle key={`m${i}`} className="sprint-burndown__marker" cx={p.x} cy={p.y} r={3} />
        ))}
        {v.scopePins.map((pin, i) => (
          <g key={`pin${i}`}>
            <circle className="sprint-burndown__pin" cx={pin.x} cy={pin.y} r={8} />
            <text className="sprint-burndown__pin-label" x={pin.x} y={pin.y + 3} textAnchor="middle">
              {pin.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS band to globals.css**

Append to `app/globals.css` under a new band `/* === Sprint burndown chart === */`:

```css
/* === Sprint burndown chart === */
.sprint-burndown__svg { display: block; }
.sprint-burndown__grad-0 { stop-color: var(--chart-actual); stop-opacity: 0.26; }
.sprint-burndown__grad-1 { stop-color: var(--chart-actual); stop-opacity: 0.02; }
.sprint-burndown__scope-region { fill: var(--chart-scope-region); }
.sprint-burndown__cone { fill: var(--chart-cone-band); stroke: none; }
.sprint-burndown__area { /* fill set inline via gradient url */ }
.sprint-burndown__actual { stroke: var(--chart-actual); stroke-width: 2.6; stroke-linejoin: round; stroke-linecap: round; }
.sprint-burndown__marker { fill: var(--surface-raised); stroke: var(--chart-actual); stroke-width: 2; }
.sprint-burndown__ideal { stroke: var(--ink); stroke-width: 1.75; stroke-dasharray: 6 5; opacity: 0.7; }
.sprint-burndown__ideal-original { stroke: var(--ink-subtle); stroke-width: 1.25; stroke-dasharray: 2 4; opacity: 0.4; }
.sprint-burndown__optimistic { stroke: var(--chart-optimistic); stroke-width: 1.75; stroke-dasharray: 1 5; }
.sprint-burndown__pessimistic { stroke: var(--chart-pessimistic); stroke-width: 1.75; stroke-dasharray: 1 5; }
.sprint-burndown__today { stroke: var(--ink-muted); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.55; }
.sprint-burndown__pin { fill: var(--chart-scope); }
.sprint-burndown__pin-label { fill: var(--ink-inverse); font-size: 9px; font-weight: 700; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint:tsc`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/SprintBurndownChart.tsx app/globals.css
git commit -m "feat(sprintmetrics): dumb SprintBurndownChart SVG renderer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Place on the value-sprint-review page

**Files:**
- Modify: `app/(user)/value-sprint-review/page.tsx`

- [ ] **Step 1: Add imports**

Near the existing imports in `page.tsx`:
```tsx
import SprintBurndownChart from "@/app/components/SprintBurndownChart";
import { useSprintMetrics } from "@/app/hooks/useSprintMetrics";
```

- [ ] **Step 2: Call the hook (after panelSprintId is resolved, ~L132)**

```tsx
  const {
    model: burndownModel,
    loading: burndownLoading,
    refetch: refetchBurndown,
  } = useSprintMetrics(panelSprintId);
```

- [ ] **Step 3: Render the Panel above the existing sprint Panel**

Between `<PageDescription>…</PageDescription>` (closes ~L378) and the existing `<Panel name="panel_value_sprint_review_target" …>`, insert:

```tsx
        <Panel
          name="panel_value_sprint_review_burndown"
          className="page-panel-heading"
          title="Sprint burndown"
          description="Story points remaining vs. the ideal pace, with forecast cone and scope-change history. Live from the sprint metrics engine."
        >
          <div className="sprint-burndown__head">
            <button
              type="button"
              className="btn"
              onClick={() => void refetchBurndown()}
              aria-label="Refresh burndown"
              title="Refresh burndown"
            >
              <span>↻ Refresh</span>
            </button>
          </div>
          {burndownModel
            ? <SprintBurndownChart model={burndownModel} />
            : <p className="text-size-90">{burndownLoading ? "Loading burndown…" : "No burndown data for this sprint yet."}</p>}
        </Panel>
```

- [ ] **Step 4: Typecheck + lint (page rules: PageDescription, no raw h2, etc.)**

Run: `npm run lint:tsc && npm run lint` (verify script names in package.json)
Expected: no errors. The new Panel uses `title=` (no raw `<h2>`), page still has its `<PageDescription>`.

- [ ] **Step 5: Browser verification (real data, dev)**

Start the Next dev server (`<npm>`). Navigate to the exact PoC URL:
`http://localhost:5101/value-sprint-review?meg=cdaf77ab-a361-4186-be42-2ca26a445891`
Expected: the burndown Panel renders above the sprint tree. With no ledger events yet it shows the empty state. Then: in another tab, move a work item in that sprint INTO an accepted state → within 60s (or instantly via push) the burndown updates with a real burn. Take a screenshot to confirm.

- [ ] **Step 6: Commit**

```bash
git add "app/(user)/value-sprint-review/page.tsx"
git diff --cached --stat
git commit -m "feat(sprintmetrics): place live burndown on value-sprint-review

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Regenerate SY003 (substrate changed — HARD RULE)

**Files:**
- None (regenerates the system report)

- [ ] **Step 1: Regenerate SY003**

The migration added a table + new SQL touchpoints. Per the SY003 HARD RULE, run:
```
<report> -sy "current state of the Vector databases (vector_artefacts, mmff_library) — complete table inventory grouped by role, with row counts, cross-DB soft refs against mmff_library, dead-weight candidates, and every SQL touchpoint in the codebase. Sourced from live pg_stat_user_tables + information_schema introspection."
```
Expected: SY003 re-POSTed with `sprint_burn_events` in the inventory + the new sprintmetrics SQL touchpoints. Change Log auto-prepends.

- [ ] **Step 2: Verify SY003 lists the new table**

```bash
curl -s -H "Authorization: Bearer $DEV_API_KEY" http://localhost:5100/_site/admin/dev/reporting/SY003 | grep -i sprint_burn_events
```
Expected: the table appears.

---

## Task 14: Full verification pass

- [ ] **Step 1: Backend tests + build**

Run: `cd backend && go build ./... && go test ./internal/sprintmetrics/ -v`
Expected: builds clean; all sprintmetrics tests PASS.

- [ ] **Step 2: Frontend tests + typecheck + lint**

Run: `npx vitest run app/components/charts/sprint/ && npm run lint:tsc && npm run lint`
Expected: all PASS, no type/lint errors.

- [ ] **Step 3: End-to-end on the live page**

Confirm on `http://localhost:5101/value-sprint-review?meg=cdaf77ab-a361-4186-be42-2ca26a445891`:
- burndown renders;
- accepting an item burns it down;
- pulling an accepted item back to in_progress raises the line (unaccepted);
- adding an item to the sprint bumps scope + drops a pin (if mid-sprint);
- the ↻ button refetches; the 60s poll / push auto-updates.

Screenshot each for the record.

- [ ] **Step 4: Update the scope tracker**

Run `<scope> -u` to mark this work item's state in `Vector_Scope.md`.

---

## Notes for the implementer

- **HARD RULES that bite here:** (1) inspect `git diff --cached --stat` before every commit; (2) never assume a DB — this is all `vector_artefacts` (vaPool); (3) server is the gate — the `/metrics` handler's Sentinel clamp is the authority, the client is dumb; (4) no hacks — the in-tx capture is deliberate correctness, don't "simplify" it to post-commit; (5) regenerate SY003 after the migration.
- **The idealA/idealB reconciliation** (Task 10 Step 3 note) is the one place where the plan defers a small shape decision to implementation — resolve it by emitting two ideal arrays from the engine rather than a NaN-break, and keep both the Go and TS tests green.
- **Topic alignment** (Task 7 ↔ Task 8): the pg_notify→hub topic string and the hook's `topic` MUST match exactly, or auto-refresh silently won't fire. Verify by triggering a write and watching the network tab refetch.
