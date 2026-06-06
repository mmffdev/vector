package sprintmetrics

import (
	"testing"
	"time"
)

// asOf anchor for the tests — all sprint end dates are expressed relative to it.
var vAsOf = time.Date(2026, 6, 6, 0, 0, 0, 0, time.UTC)

func daysAgo(n int) time.Time   { return vAsOf.Add(-time.Duration(n) * 24 * time.Hour) }
func daysAhead(n int) time.Time { return vAsOf.Add(time.Duration(n) * 24 * time.Hour) }

func TestComputeVelocity(t *testing.T) {
	t.Run("no eligible sprints → not enough data", func(t *testing.T) {
		// All future-dated (not yet ended).
		got := ComputeVelocity([]SprintAcceptance{
			{SprintID: "a", EndDate: daysAhead(5), AcceptedPts: 20},
			{SprintID: "b", EndDate: daysAhead(19), AcceptedPts: 30},
		}, vAsOf)
		if got.HasData {
			t.Fatalf("expected HasData=false, got %+v", got)
		}
		if got.PointsPerSprint != 0 {
			t.Errorf("PointsPerSprint = %v, want 0", got.PointsPerSprint)
		}
	})

	t.Run("only past-dated sprints count", func(t *testing.T) {
		got := ComputeVelocity([]SprintAcceptance{
			{SprintID: "past1", EndDate: daysAgo(3), AcceptedPts: 20},
			{SprintID: "future", EndDate: daysAhead(10), AcceptedPts: 999}, // excluded
		}, vAsOf)
		if got.EligibleSprints != 1 {
			t.Fatalf("EligibleSprints = %d, want 1", got.EligibleSprints)
		}
		if got.PointsPerSprint != 20 {
			t.Errorf("PointsPerSprint = %v, want 20 (future sprint must be excluded)", got.PointsPerSprint)
		}
	})

	t.Run("short window (history < 6 weeks) uses last 3", func(t *testing.T) {
		// 4 eligible sprints, all within ~4 weeks → window = 3, newest three.
		got := ComputeVelocity([]SprintAcceptance{
			{SprintID: "s1", EndDate: daysAgo(28), AcceptedPts: 10}, // oldest, dropped
			{SprintID: "s2", EndDate: daysAgo(14), AcceptedPts: 20},
			{SprintID: "s3", EndDate: daysAgo(7), AcceptedPts: 22},
			{SprintID: "s4", EndDate: daysAgo(1), AcceptedPts: 18},
		}, vAsOf)
		if got.WindowSize != 3 {
			t.Fatalf("WindowSize = %d, want 3 (history < 6wk)", got.WindowSize)
		}
		// (20+22+18)/3 = 20 — matches the user's worked example.
		if got.PointsPerSprint != 20 {
			t.Errorf("PointsPerSprint = %v, want 20", got.PointsPerSprint)
		}
		if got.SampledSprintIDs[0] != "s4" || got.SampledSprintIDs[2] != "s2" {
			t.Errorf("sampled (most-recent-first) = %v, want [s4 s3 s2]", got.SampledSprintIDs)
		}
		if got.LowConfidence {
			t.Errorf("LowConfidence should be false with 3 sprints")
		}
	})

	t.Run("long window (history ≥ 6 weeks) uses last 6", func(t *testing.T) {
		// Oldest eligible sprint ended 50 days (>6 weeks=42d) ago → window = 6.
		all := []SprintAcceptance{
			{SprintID: "s1", EndDate: daysAgo(50), AcceptedPts: 100}, // >6wk → triggers long window; but dropped from the last-6
			{SprintID: "s2", EndDate: daysAgo(40), AcceptedPts: 12},
			{SprintID: "s3", EndDate: daysAgo(33), AcceptedPts: 12},
			{SprintID: "s4", EndDate: daysAgo(26), AcceptedPts: 12},
			{SprintID: "s5", EndDate: daysAgo(19), AcceptedPts: 12},
			{SprintID: "s6", EndDate: daysAgo(12), AcceptedPts: 12},
			{SprintID: "s7", EndDate: daysAgo(5), AcceptedPts: 12},
		}
		got := ComputeVelocity(all, vAsOf)
		if got.WindowSize != 6 {
			t.Fatalf("WindowSize = %d, want 6 (history ≥ 6wk)", got.WindowSize)
		}
		// last 6 are s2..s7, all 12 → mean 12. s1 (the 100) is outside the window.
		if got.PointsPerSprint != 12 {
			t.Errorf("PointsPerSprint = %v, want 12 (oldest excluded by window)", got.PointsPerSprint)
		}
		if got.EligibleSprints != 7 {
			t.Errorf("EligibleSprints = %d, want 7", got.EligibleSprints)
		}
	})

	t.Run("fewer than 3 eligible → low confidence but still computes", func(t *testing.T) {
		got := ComputeVelocity([]SprintAcceptance{
			{SprintID: "only", EndDate: daysAgo(2), AcceptedPts: 7},
		}, vAsOf)
		if !got.HasData || !got.LowConfidence {
			t.Fatalf("want HasData=true, LowConfidence=true, got %+v", got)
		}
		if got.WindowSize != 1 || got.PointsPerSprint != 7 {
			t.Errorf("got n=%d v=%v, want n=1 v=7", got.WindowSize, got.PointsPerSprint)
		}
	})

	t.Run("net accepted (accepted − unaccepted) is the caller's responsibility but flows through", func(t *testing.T) {
		// A sprint that accepted 20 then un-accepted 5 → caller passes 15.
		got := ComputeVelocity([]SprintAcceptance{
			{SprintID: "s1", EndDate: daysAgo(14), AcceptedPts: 15},
			{SprintID: "s2", EndDate: daysAgo(7), AcceptedPts: 15},
			{SprintID: "s3", EndDate: daysAgo(1), AcceptedPts: 15},
		}, vAsOf)
		if got.PointsPerSprint != 15 {
			t.Errorf("PointsPerSprint = %v, want 15", got.PointsPerSprint)
		}
	})
}
