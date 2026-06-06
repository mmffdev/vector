package taskmetrics

import (
	"math"
	"testing"
)

// TestProjectForecast pins the researched forecast formula (see the spec's
// "Forecast cone — researched formula" addendum):
//
//	daysToComplete = remaining / dailyVelocity
//	landingDay     = today + daysToComplete
//	optimistic velocity = max per-day completion over last 3 actual days
//	pessimistic velocity = min per-day completion over the same window
//
// Dataset: 24-task sprint, today=4 (of 14 days). Per-day completed (earned
// deltas) over days 1..4 = [2, 6, 4, 0]. The 3-day window is days 2,3,4 →
// completions [6, 4, 0]:
//
//	optimistic velocity = max(6,4,0) = 6/day
//	average    velocity = mean(6,4,0) = 3.333/day
//	pessimistic velocity = min(6,4,0) = 0/day  (never lands)
//
// remaining today = 24 - (2+6+4+0) = 12.
//
//	optLandingDay  = 4 + 12/6      = 6
//	avgLandingDay  = 4 + 12/3.333  = 7.6
//	pessLandingDay = -1            (velocity 0 → never lands)
func TestProjectForecast(t *testing.T) {
	win := Window{Start: "2026-01-01", End: "2026-01-15", Today: 4, SprintDays: 14}

	events := []TaskBurnEvent{
		{ArtefactID: "c", EventType: EventAdded, RemainingDelta: 24, ScopeDelta: 24, OccurredAt: "2026-01-01"},
	}
	// done counts per day 1..4 = [2,6,4,0]
	dones := map[int]int{1: 2, 2: 6, 3: 4, 4: 0}
	dates := map[int]string{1: "2026-01-02", 2: "2026-01-03", 3: "2026-01-04", 4: "2026-01-05"}
	for d := 1; d <= 4; d++ {
		if dones[d] == 0 {
			continue
		}
		events = append(events, TaskBurnEvent{ArtefactID: "t", EventType: EventDone, RemainingDelta: -dones[d], OccurredAt: dates[d]})
	}

	m := Project(ProjectInput{Window: win, Events: events})
	f := m.Forecast

	if got := m.KPIs.Remaining; got != 12 {
		t.Fatalf("remaining = %d, want 12", got)
	}
	if math.Abs(f.OptimisticVelocity-6) >= 0.01 {
		t.Errorf("OptimisticVelocity = %v, want 6", f.OptimisticVelocity)
	}
	if math.Abs(f.AverageVelocity-3.333) >= 0.01 {
		t.Errorf("AverageVelocity = %v, want ~3.333", f.AverageVelocity)
	}
	if math.Abs(f.PessimisticVelocity-0) >= 0.01 {
		t.Errorf("PessimisticVelocity = %v, want 0", f.PessimisticVelocity)
	}
	if math.Abs(f.OptLandingDay-6) >= 0.01 {
		t.Errorf("OptLandingDay = %v, want 6", f.OptLandingDay)
	}
	if math.Abs(f.AvgLandingDay-7.6) >= 0.01 {
		t.Errorf("AvgLandingDay = %v, want 7.6", f.AvgLandingDay)
	}
	if f.PessLandingDay != -1 {
		t.Errorf("PessLandingDay = %v, want -1 (velocity 0 never lands)", f.PessLandingDay)
	}
	// pess never lands → not "past end" in the banner sense, and no date.
	if f.ProjectedPastEnd {
		t.Errorf("ProjectedPastEnd = true, want false when pess never lands")
	}
	if f.PessLandingDate != "" {
		t.Errorf("PessLandingDate = %q, want empty when never lands", f.PessLandingDate)
	}
}

// TestProjectForecastPastEnd pins the past-sprint-end case: a slow-but-nonzero
// pessimistic velocity lands AFTER sprint-end, so the banner fires with a date.
//
// Dataset: 10-task sprint, 8 days, today=4. Per-day completed days 1..4 =
// [1,1,1,1] → 3-day window days 2,3,4 = [1,1,1]. All velocities = 1/day.
// remaining = 10-4 = 6. landingDay = 4 + 6/1 = 10 > sprintDays(8) → past end.
// Day 10 from start 2026-01-01 = 2026-01-11.
func TestProjectForecastPastEnd(t *testing.T) {
	win := Window{Start: "2026-01-01", End: "2026-01-09", Today: 4, SprintDays: 8}
	events := []TaskBurnEvent{
		{ArtefactID: "c", EventType: EventAdded, RemainingDelta: 10, ScopeDelta: 10, OccurredAt: "2026-01-01"},
	}
	dates := map[int]string{1: "2026-01-02", 2: "2026-01-03", 3: "2026-01-04", 4: "2026-01-05"}
	for d := 1; d <= 4; d++ {
		events = append(events, TaskBurnEvent{ArtefactID: "t", EventType: EventDone, RemainingDelta: -1, OccurredAt: dates[d]})
	}

	f := Project(ProjectInput{Window: win, Events: events}).Forecast

	if math.Abs(f.PessLandingDay-10) >= 0.01 {
		t.Errorf("PessLandingDay = %v, want 10", f.PessLandingDay)
	}
	if !f.ProjectedPastEnd {
		t.Errorf("ProjectedPastEnd = false, want true (lands day 10 > sprint 8)")
	}
	if f.PessLandingDate != "2026-01-11" {
		t.Errorf("PessLandingDate = %q, want 2026-01-11 (day 10 from 2026-01-01)", f.PessLandingDate)
	}
}
