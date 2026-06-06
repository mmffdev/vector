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
	// Non-nil so the wire carries `[]` not `null` when there are no
	// mid-sprint scope changes — the frontend view-shaper also guards
	// against null, but emitting [] keeps the JSON contract honest.
	scopeChanges := []ScopeChange{}

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

	// 8. Researched forecast (spec: "Forecast cone — researched formula").
	// remToday clamped >= 0 (negative remaining is physically impossible — a
	// corrupt ledger; never surface it). Velocity tiers = max/mean/min of the
	// per-day accepted amounts over the forecast window. daysToComplete =
	// remaining / velocity; landingDay = today + daysToComplete; lines extend
	// past sprint-end; velocity <= 0 never lands (-1).
	remToday := remaining[today]
	if remToday < 0 {
		remToday = 0
	}
	daysLeft := days - today

	dailyAccepted := []float64{}
	if today >= 1 {
		from := today - (forecastDays - 1)
		if from < 1 {
			from = 1
		}
		for d := from; d <= today; d++ {
			dailyAccepted = append(dailyAccepted, earned[d]-earned[d-1])
		}
	}
	optV, avgV, pessV := velocityTiers(dailyAccepted)

	land := func(v float64) float64 {
		if v <= 0 {
			return -1
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

	optimistic := coneLine(remToday, optV, daysLeft)
	pessimistic := coneLine(remToday, pessV, daysLeft)

	onTrack := avgLand >= 0 && avgLand <= float64(days)
	pessAtEnd := remToday - pessV*float64(daysLeft)
	if pessAtEnd < 0 {
		pessAtEnd = 0
	}

	// 9. KPIs. Velocity stays the 3-day rolling mean (the existing KPI-strip
	// figure); the forecast tiers are carried separately in Forecast.
	kpis := KPIs{
		Committed:      int(scope[days]),
		Remaining:      int(remToday),
		Velocity:       velocity,
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
		Velocity:      velocity,
		Forecast:      forecast,
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

// velocityTiers returns the max / mean / min of the per-day amounts. Kept in
// parity with taskmetrics.velocityTiers. Empty input → all zero.
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

// coneLine projects remToday falling by velocity per day for daysLeft days
// (index 0 = today), floored at 0, drawn only to the right plot edge. A
// velocity <= 0 stays flat. Parity with taskmetrics.coneLine.
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

// addDays returns the "YYYY-MM-DD" date n whole days after start.
func addDays(start string, n int) string {
	s := parseYMD(start)
	if s.IsZero() {
		return ""
	}
	return s.AddDate(0, 0, n).Format("2006-01-02")
}
