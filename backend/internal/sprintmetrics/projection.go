package sprintmetrics

import (
	"math"
	"time"
)

// ProjectInput is the pure, DB-free input to Project.
type ProjectInput struct {
	Window Window
	Events []BurnEvent
}

// Project replays the ledger into a neutral Model. It is a pure function: no
// DB, no HTTP, no clock. This is the testable core — a port of the reference
// burndown algorithm.
func Project(in ProjectInput) Model {
	days := in.Window.SprintDays
	today := in.Window.Today

	// 2. Bucket events by whole-day offset from the window start.
	byDay := make(map[int][]BurnEvent)
	for _, e := range in.Events {
		d := dayOffset(in.Window.Start, e.OccurredAt)
		byDay[d] = append(byDay[d], e)
	}

	scope := make([]float64, days+1)
	remaining := make([]float64, days+1)
	var scopeChanges []ScopeChange

	// 3 + 4. Replay day by day, accumulating scope and remaining.
	curScope := 0
	curRem := 0
	for d := 0; d <= days; d++ {
		for _, e := range byDay[d] {
			curScope += e.ScopeDelta
			curRem += e.PointsDelta
			if e.EventType == EventAdded && d > 0 && e.ScopeDelta != 0 {
				scopeChanges = append(scopeChanges, ScopeChange{Day: d, Delta: e.ScopeDelta})
			}
		}
		scope[d] = float64(curScope)
		if d <= today {
			remaining[d] = float64(curRem)
		} else {
			remaining[d] = -1 // sentinel: no actual value
		}
	}

	// 5. Earned for actual days only.
	earned := make([]float64, today+1)
	for d := 0; d <= today; d++ {
		earned[d] = scope[d] - remaining[d]
	}

	// 6. Velocity = mean daily earned delta over the last up-to-3 actual days.
	velocity := 0.0
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
			velocity = sum / float64(n)
		}
	}

	// 7. Ideal guidelines.
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
		// Use the LAST / largest scope change.
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

	// 8. Forecast cone.
	remToday := remaining[today]
	daysLeft := days - today
	pessEnd := remToday - velocity*float64(daysLeft)
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

	// 9. KPIs.
	kpis := KPIs{
		Committed:      int(scope[days]),
		Remaining:      int(remToday),
		Velocity:       velocity,
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
		Velocity:      velocity,
		ScopeChanges:  scopeChanges,
		KPIs:          kpis,
	}
}

// parseYMD parses a "YYYY-MM-DD" date. On error it returns the zero time.
func parseYMD(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// dayOffset returns the whole-day difference between start and occ, both
// "YYYY-MM-DD". Guards against short occ strings.
func dayOffset(start, occ string) int {
	if len(occ) < 10 {
		return 0
	}
	s := parseYMD(start)
	o := parseYMD(occ[:10])
	return int(o.Sub(s).Hours() / 24)
}
