package sprintmetrics

import (
	"math"
	"testing"
)

// TestProjectHandoffReference pins the canonical handoff dataset for the
// on-demand burndown projection. See the package doc comment for the model
// semantics (value is earned only at flow kind "accepted").
func TestProjectHandoffReference(t *testing.T) {
	win := Window{Start: "2026-01-01", End: "2026-01-11", Today: 7, SprintDays: 10}

	// Day 0: commit 80 points of scope.
	events := []BurnEvent{
		{ArtefactID: "a-commit", EventType: EventAdded, PointsDelta: 80, ScopeDelta: 80, OccurredAt: "2026-01-01"},
	}

	// accepted burns per day 1..7 = [_,4,6,8,7,5,9,9]
	burns := map[int]int{1: 4, 2: 6, 3: 8, 4: 7, 5: 5, 6: 9, 7: 9}
	dates := map[int]string{
		1: "2026-01-02",
		2: "2026-01-03",
		3: "2026-01-04",
		4: "2026-01-05",
		5: "2026-01-06",
		6: "2026-01-07",
		7: "2026-01-08",
	}
	for d := 1; d <= 7; d++ {
		events = append(events, BurnEvent{
			ArtefactID:  "a-burn",
			EventType:   EventAccepted,
			PointsDelta: -burns[d],
			ScopeDelta:  0,
			OccurredAt:  dates[d],
		})
	}

	// Day 5 (-> 2026-01-06): +12 scope creep.
	events = append(events, BurnEvent{
		ArtefactID:  "a-creep",
		EventType:   EventAdded,
		PointsDelta: 12,
		ScopeDelta:  12,
		OccurredAt:  "2026-01-06",
	})

	m := Project(ProjectInput{Window: win, Events: events})

	if got := m.Remaining[7]; got != 44 {
		t.Errorf("remaining[7] = %v, want 44", got)
	}
	if got := m.Scope[4]; got != 80 {
		t.Errorf("scope[4] = %v, want 80", got)
	}
	if got := m.Scope[5]; got != 92 {
		t.Errorf("scope[5] = %v, want 92", got)
	}
	if got := m.Remaining[5]; got != 62 {
		t.Errorf("remaining[5] = %v, want 62", got)
	}
	if got := m.Velocity; math.Abs(got-7.667) >= 0.01 {
		t.Errorf("velocity = %v, want ~7.667", got)
	}
	// ProjectedShort now uses the PESSIMISTIC (min recent day) velocity, per the
	// researched forecast formula — a shortfall warning should reflect the
	// worst-case recent pace, not the average. Forecast window = days 5,6,7,
	// accepted [5,9,9] → pessV = min = 5/day. remToday(44) - 5*3 = 29. (Was 21
	// under the old average-velocity formula, which understated the risk.)
	if got := m.KPIs.ProjectedShort; got != 29 {
		t.Errorf("KPIs.ProjectedShort = %v, want 29 (pessimistic velocity 5/day)", got)
	}
	if got := m.KPIs.OnTrack; got != false {
		t.Errorf("KPIs.OnTrack = %v, want false", got)
	}
	// Forecast tiers: window days 5,6,7 accepted [5,9,9].
	if got := m.Forecast.OptimisticVelocity; math.Abs(got-9) >= 0.01 {
		t.Errorf("Forecast.OptimisticVelocity = %v, want 9", got)
	}
	if got := m.Forecast.AverageVelocity; math.Abs(got-7.667) >= 0.01 {
		t.Errorf("Forecast.AverageVelocity = %v, want ~7.667", got)
	}
	if got := m.Forecast.PessimisticVelocity; math.Abs(got-5) >= 0.01 {
		t.Errorf("Forecast.PessimisticVelocity = %v, want 5", got)
	}
	// optLand = 7 + 44/9 = 11.89; avgLand = 7 + 44/7.667 = 12.74;
	// pessLand = 7 + 44/5 = 15.8 — all past sprint-end (day 10).
	if got := m.Forecast.OptLandingDay; math.Abs(got-11.889) >= 0.01 {
		t.Errorf("Forecast.OptLandingDay = %v, want ~11.889", got)
	}
	if got := m.Forecast.PessLandingDay; math.Abs(got-15.8) >= 0.01 {
		t.Errorf("Forecast.PessLandingDay = %v, want 15.8", got)
	}
	if !m.Forecast.ProjectedPastEnd {
		t.Errorf("Forecast.ProjectedPastEnd = false, want true (pess lands day 15.8 > 10)")
	}
	if got := m.IdealB[0]; got != 52 {
		t.Errorf("IdealB[0] = %v, want 52", got)
	}
	if len(m.ScopeChanges) != 1 {
		t.Fatalf("len(ScopeChanges) = %d, want 1", len(m.ScopeChanges))
	}
	if m.ScopeChanges[0].Day != 5 || m.ScopeChanges[0].Delta != 12 {
		t.Errorf("ScopeChanges[0] = %+v, want {Day:5 Delta:12}", m.ScopeChanges[0])
	}
	if got := len(m.IdealA); got != 6 {
		t.Errorf("len(IdealA) = %d, want 6 (days 0..5 inclusive)", got)
	}
}
