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
// task_burn_events_event_type in migration 179.
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

// forecastDays is the rolling window (in actual days) over which the per-day
// completion velocities are sampled for the forecast. 3 matches the KPI rate
// window and the brokenbuild Jira-replica's default "forecast days count: 3".
const forecastDays = 3

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
// The arrays carry the per-day projected remaining for each velocity tier,
// indexed from `today` (point i = day today+i), drawn to the right plot edge.
type Cone struct {
	Optimistic  []float64 `json:"optimistic"`
	Pessimistic []float64 `json:"pessimistic"`
}

// Forecast holds the researched completion projection (see the spec's
// "Forecast cone — researched formula" addendum). The canonical formula is
// daysToComplete = remaining / dailyVelocity; three velocity tiers (max/mean/min
// of the per-day completed amounts over the FORECAST_DAYS window) give three
// landing days. Lines extend PAST sprint-end — a landing day may exceed
// sprint_days. A velocity <= 0 never lands (LandingDay = -1).
type Forecast struct {
	OptimisticVelocity  float64 `json:"optimistic_velocity"`  // max recent daily completion → soonest
	AverageVelocity     float64 `json:"average_velocity"`     // mean recent daily completion
	PessimisticVelocity float64 `json:"pessimistic_velocity"` // min recent daily completion → latest

	// Landing day = today + remaining/velocity. May exceed sprint_days (late).
	// -1 means "never lands at this velocity" (velocity <= 0).
	OptLandingDay  float64 `json:"opt_landing_day"`
	AvgLandingDay  float64 `json:"avg_landing_day"`
	PessLandingDay float64 `json:"pess_landing_day"`

	// PessLandingDate is the calendar date the pessimistic line hits zero,
	// "YYYY-MM-DD". Empty when it never lands. Drives the past-end banner.
	PessLandingDate string `json:"pess_landing_date"`

	// ProjectedPastEnd is true when the pessimistic line lands after sprint-end
	// (pess_landing_day > sprint_days) — the trigger for the banner.
	ProjectedPastEnd bool `json:"projected_past_end"`
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
	Forecast      Forecast      `json:"forecast"`
	ScopeChanges  []ScopeChange `json:"scope_changes"`
	KPIs          KPIs          `json:"kpis"`
}
