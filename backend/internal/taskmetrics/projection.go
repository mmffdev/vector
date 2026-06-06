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
	// remToday is clamped to >= 0: remaining tasks can never be physically
	// negative. A negative value can only mean a corrupt ledger (more 'done'
	// than 'added' for a task — e.g. a backfill that double-counted against live
	// emission). Clamping keeps the KPIs honest (Completed <= Total, Remaining
	// >= 0) rather than rendering an impossible "-1 remaining"; the underlying
	// ledger corruption is a separate data-reconcile concern, not a chart bug.
	remToday := remaining[today]
	if remToday < 0 {
		remToday = 0
	}
	daysLeft := days - today

	// ── Researched forecast (spec: "Forecast cone — researched formula").
	// Sample the per-day completed amounts over the last `forecastDays` actual
	// days; the velocity tiers are the max / mean / min of those daily amounts.
	// daysToComplete = remaining / velocity; landingDay = today + daysToComplete.
	// A velocity <= 0 never lands (landingDay -1). Lines extend past sprint-end.
	dailyCompletions := []float64{}
	if today >= 1 {
		from := today - (forecastDays - 1)
		if from < 1 {
			from = 1
		}
		for d := from; d <= today; d++ {
			dailyCompletions = append(dailyCompletions, earned[d]-earned[d-1])
		}
	}
	optV, avgV, pessV := velocityTiers(dailyCompletions)

	land := func(v float64) float64 {
		if v <= 0 {
			return -1 // never lands at this rate
		}
		return float64(today) + remToday/v
	}
	optLand := land(optV)
	avgLand := land(avgV)
	pessLand := land(pessV)

	pessPastEnd := pessLand > float64(days)
	optDate := ""
	if optLand >= 0 {
		optDate = addDays(in.Window.Start, int(math.Round(optLand)))
	}
	pessDate := ""
	if pessLand >= 0 {
		// Calendar date of the (possibly past-end) pessimistic landing day.
		pessDate = addDays(in.Window.Start, int(math.Round(pessLand)))
	}

	forecast := Forecast{
		OptimisticVelocity:  optV,
		AverageVelocity:     avgV,
		PessimisticVelocity: pessV,
		OptLandingDay:       optLand,
		AvgLandingDay:       avgLand,
		PessLandingDay:      pessLand,
		OptLandingDate:      optDate,
		PessLandingDate:     pessDate,
		ProjectedPastEnd:    pessPastEnd,
	}

	// Cone draw-arrays: each tier's projected remaining for days today..end,
	// at its true slope (remToday falling by `velocity` per day), floored at 0
	// and drawn only to the right plot edge. A tier that never lands (velocity
	// <= 0) stays flat at remToday. point i = day today+i.
	optimistic := coneLine(remToday, optV, daysLeft)
	pessimistic := coneLine(remToday, pessV, daysLeft)

	// On-track = the AVERAGE trend lands on or before sprint-end. ProjectedShort
	// = remaining the pessimistic line still has at sprint-end (0 if it lands by
	// then), the "you may be N short at the deadline" figure.
	onTrack := avgLand >= 0 && avgLand <= float64(days)
	pessAtEnd := remToday - pessV*float64(daysLeft)
	if pessAtEnd < 0 {
		pessAtEnd = 0
	}

	kpis := KPIs{
		Total:          int(scope[days]),
		Completed:      int(scope[today] - remToday),
		Remaining:      int(remToday),
		DaysLeft:       daysLeft,
		OnTrack:        onTrack,
		ProjectedShort: int(math.Round(pessAtEnd)),
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
		Forecast:      forecast,
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

// velocityTiers returns the max / mean / min of the per-day completion amounts.
// Empty input → all zero (no recent progress; nothing lands). This is the
// tool-convention min/avg/max derivation documented in the spec.
func velocityTiers(daily []float64) (optimistic, average, pessimistic float64) {
	if len(daily) == 0 {
		return 0, 0, 0
	}
	mx, mn, sum := daily[0], daily[0], 0.0
	for _, v := range daily {
		if v > mx {
			mx = v
		}
		if v < mn {
			mn = v
		}
		sum += v
	}
	return mx, sum / float64(len(daily)), mn
}

// coneLine projects `remToday` falling by `velocity` per day for `daysLeft`
// days (index 0 = today). Floored at 0. A velocity <= 0 stays flat at remToday
// (the honest "at this rate it never falls" line). This draws ONLY to the right
// plot edge — the landing day (which may be past the edge) is carried separately
// in Forecast.*LandingDay for the off-grid date label + banner.
func coneLine(remToday, velocity float64, daysLeft int) []float64 {
	out := make([]float64, daysLeft+1)
	for i := 0; i <= daysLeft; i++ {
		v := remToday - velocity*float64(i)
		if v < 0 {
			v = 0
		}
		out[i] = v
	}
	return out
}

// addDays returns the "YYYY-MM-DD" date `n` whole days after `start`.
func addDays(start string, n int) string {
	s := parseYMD(start)
	if s.IsZero() {
		return ""
	}
	return s.AddDate(0, 0, n).Format("2006-01-02")
}
