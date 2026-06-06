package sprintmetrics

import "time"

// Cross-sprint team velocity — the standard agile metric: the mean story points
// COMPLETED across the last n sprints. This is deliberately SEPARATE from the
// burndown's intra-sprint "recent rate" KPI (mean accepted/day over the last 3
// days); they share a name in agile parlance but answer different questions:
//
//   • burndown velocity  → pts/DAY, 3-day rolling, drives the forecast cone.
//   • team velocity (here)→ pts/SPRINT, rolling over n completed sprints, the
//                           capacity-planning number a PM quotes.
//
// This file is a STANDALONE, DB-free unit on purpose. ComputeVelocity is a pure
// function over a slice of per-sprint acceptance facts, so any consumer (the
// burndown KPI strip today; a velocity chart, capacity planner, or report
// tomorrow) reuses the SAME maths without re-reading the ledger its own way.
// The service layer (velocity_service.go) is the only place that touches the DB.

// VelocityWindowWeeks is the calendar age at which the rolling window grows from
// VelocityWindowShort to VelocityWindowLong. Origin: user spec 2026-06-06 —
// "initial 3 sprints, then 6 once history spans >6 weeks". Until the oldest
// eligible sprint is at least this old, a 3-sprint window is used (it reacts
// faster with little history); past it, a 6-sprint window steadies the average.
const (
	VelocityWindowWeeks = 6
	VelocityWindowShort = 3
	VelocityWindowLong  = 6
)

// SprintAcceptance is one finished sprint's contribution to velocity: its end
// date and the NET story points accepted in it (accepted minus unaccepted).
// DB-free — the service builds these from the ledger; tests build them inline.
type SprintAcceptance struct {
	SprintID    string
	Name        string
	EndDate     time.Time // sprint end (calendar)
	AcceptedPts int       // net accepted points (accepted − unaccepted)
}

// VelocityResult is the computed team velocity plus the provenance a UI needs to
// label it honestly: which basis/window was used and how confident it is.
type VelocityResult struct {
	// PointsPerSprint is the mean net-accepted points over the window. 0 when
	// no eligible sprints exist.
	PointsPerSprint float64 `json:"points_per_sprint"`
	// WindowSize is the n actually used (≤ the eligible count).
	WindowSize int `json:"window_size"`
	// EligibleSprints is how many past-dated sprints were available.
	EligibleSprints int `json:"eligible_sprints"`
	// SampledSprintIDs are the sprint ids that fed the average (most recent
	// first), so the UI can show "based on Sprint X, Y, Z".
	SampledSprintIDs []string `json:"sampled_sprint_ids"`
	// LowConfidence is true when fewer than VelocityWindowShort sprints fed the
	// average — the number exists but is noisy. UI may caveat it.
	LowConfidence bool `json:"low_confidence"`
	// HasData is false when there are zero eligible sprints — the UI should show
	// "—" / "not enough data" rather than "0".
	HasData bool `json:"has_data"`
}

// ComputeVelocity is the pure, reusable core. Given every sprint's acceptance
// fact and the "as of" instant, it:
//
//  1. keeps only PAST-DATED sprints (EndDate < asOf) — the agreed "completed"
//     basis (status-based closing isn't required in this product yet);
//  2. orders them most-recent-first;
//  3. picks the window n by history age (≥ VelocityWindowWeeks → 6, else 3);
//  4. averages the net accepted points of the last n.
//
// No DB, no clock of its own (asOf is injected) — fully testable and shareable.
func ComputeVelocity(all []SprintAcceptance, asOf time.Time) VelocityResult {
	// 1. Eligible = past-dated.
	eligible := make([]SprintAcceptance, 0, len(all))
	for _, s := range all {
		if s.EndDate.Before(asOf) {
			eligible = append(eligible, s)
		}
	}
	if len(eligible) == 0 {
		return VelocityResult{HasData: false}
	}

	// 2. Most-recent-first by end date (stable on ties by sprint id).
	sortByEndDateDesc(eligible)

	// 3. Window by history age — span from the OLDEST eligible sprint to asOf.
	oldest := eligible[len(eligible)-1].EndDate
	windowCap := VelocityWindowShort
	if asOf.Sub(oldest) >= time.Duration(VelocityWindowWeeks)*7*24*time.Hour {
		windowCap = VelocityWindowLong
	}
	n := windowCap
	if n > len(eligible) {
		n = len(eligible)
	}

	// 4. Mean net accepted over the last n.
	sum := 0
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		sum += eligible[i].AcceptedPts
		ids = append(ids, eligible[i].SprintID)
	}

	return VelocityResult{
		PointsPerSprint:  float64(sum) / float64(n),
		WindowSize:       n,
		EligibleSprints:  len(eligible),
		SampledSprintIDs: ids,
		LowConfidence:    n < VelocityWindowShort,
		HasData:          true,
	}
}

// sortByEndDateDesc orders most-recent-first; ties broken by SprintID so the
// result is deterministic (important for the contract test).
func sortByEndDateDesc(s []SprintAcceptance) {
	// Small slices (a handful of sprints) — insertion sort keeps it dependency-
	// free and stable without pulling in sort.Slice's reflection.
	for i := 1; i < len(s); i++ {
		j := i
		for j > 0 && lessRecent(s[j-1], s[j]) {
			s[j-1], s[j] = s[j], s[j-1]
			j--
		}
	}
}

// lessRecent reports whether a should sort AFTER b in most-recent-first order.
func lessRecent(a, b SprintAcceptance) bool {
	if a.EndDate.Equal(b.EndDate) {
		return a.SprintID > b.SprintID
	}
	return a.EndDate.Before(b.EndDate)
}
