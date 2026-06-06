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
