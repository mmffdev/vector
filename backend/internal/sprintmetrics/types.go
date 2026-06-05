// Package sprintmetrics is the shared, on-demand projection engine for sprint
// charts. It replays the append-only sprint_burn_events ledger into a neutral,
// chart-agnostic model whenever asked — there is NO daemon, NO background
// worker, and NO cache. Every call to the service re-reads the ledger and
// recomputes from scratch.
//
// The model is deliberately chart-agnostic: it carries raw numbers (scope,
// remaining, earned, ideal guidelines, a forecast cone, KPIs) and knows nothing
// about SVG, gradients, cone styling, or any other rendering concern. The same
// model feeds a burndown chart today and burnup/velocity charts later.
//
// Value semantics: value is earned ONLY at flow kind "accepted"; the reversal
// is "unaccepted". The word "completed" is deliberately absent from this
// package — work being done is not the same as value being accepted.
package sprintmetrics

// Event-type string constants, matching the CHECK constraint on
// sprint_burn_events_event_type in migration 177.
const (
	EventAdded         = "added"
	EventRemoved       = "removed"
	EventAccepted      = "accepted"
	EventUnaccepted    = "unaccepted"
	EventPointsChanged = "points_changed"
)

// BurnEvent is one row of the replayed ledger, normalised for projection.
// OccurredAt is a "YYYY-MM-DD" date string.
type BurnEvent struct {
	ArtefactID  string `json:"artefact_id"`
	EventType   string `json:"event_type"`
	PointsDelta int    `json:"points_delta"`
	ScopeDelta  int    `json:"scope_delta"`
	OccurredAt  string `json:"occurred_at"`
}

// Window describes the sprint's calendar span and where "now" sits within it.
type Window struct {
	Start      string `json:"start"`
	End        string `json:"end"`
	Today      int    `json:"today"`
	SprintDays int    `json:"sprint_days"`
}

// ScopeChange records a mid-sprint commitment change (scope creep or cut).
type ScopeChange struct {
	Day   int `json:"day"`
	Delta int `json:"delta"`
}

// Cone is the forecast envelope between optimistic and pessimistic finishes.
type Cone struct {
	Optimistic  []float64 `json:"optimistic"`
	Pessimistic []float64 `json:"pessimistic"`
}

// KPIs is the at-a-glance scoreboard derived from the projection.
type KPIs struct {
	Committed      int     `json:"committed"`
	Remaining      int     `json:"remaining"`
	Velocity       float64 `json:"velocity"`
	DaysLeft       int     `json:"days_left"`
	OnTrack        bool    `json:"on_track"`
	ProjectedShort int     `json:"projected_short"`
}

// Model is the neutral, chart-agnostic projection result.
type Model struct {
	Window Window `json:"window"`

	// Scope is committed points per day, index 0..SprintDays.
	Scope []float64 `json:"scope"`

	// Remaining is unearned points per day. For days past `today` the value
	// is the sentinel -1 ("no actual value"); NaN is NOT used because it does
	// not survive JSON encoding.
	Remaining []float64 `json:"remaining"`

	// Earned is scope-minus-remaining for days 0..today.
	Earned []float64 `json:"earned"`

	// IdealA is the ideal guideline segment A (days 0..scopeDay), or the full
	// line when there is no scope change.
	IdealA []float64 `json:"ideal_a"`

	// IdealB is segment B (scopeDay..end); empty when there is no scope change.
	IdealB []float64 `json:"ideal_b"`

	// IdealOriginal is the faint pre-change ideal line (base -> 0).
	IdealOriginal []float64 `json:"ideal_original"`

	Cone         Cone          `json:"cone"`
	Velocity     float64       `json:"velocity"`
	ScopeChanges []ScopeChange `json:"scope_changes"`
	KPIs         KPIs          `json:"kpis"`
}
