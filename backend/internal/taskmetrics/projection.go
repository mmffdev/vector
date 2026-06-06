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
