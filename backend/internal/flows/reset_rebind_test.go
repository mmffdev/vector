package flows

import "testing"

func TestPickSuccessor_walksBackToHighestSurvivingLower(t *testing.T) {
	pills := []pillRow{
		{ID: "backlog", Name: "Backlog", SortOrder: 10, Survives: true},
		{ID: "stake",   Name: "With Stakeholder", SortOrder: 20, Survives: true},
		{ID: "signoff", Name: "With Sign Off", SortOrder: 30, Survives: false}, // removed
		{ID: "done",    Name: "Completed", SortOrder: 40, Survives: true},
	}
	removed := pills[2]
	id, name := pickSuccessor(removed, pills)
	if id != "stake" || name != "With Stakeholder" {
		t.Fatalf("expected walk-back to stake/With Stakeholder, got %s/%s", id, name)
	}
}

func TestPickSuccessor_skipsOtherRemovedOnWalkBack(t *testing.T) {
	pills := []pillRow{
		{ID: "backlog", Name: "Backlog", SortOrder: 10, Survives: true},
		{ID: "review",  Name: "In Review", SortOrder: 20, Survives: false}, // also removed
		{ID: "signoff", Name: "With Sign Off", SortOrder: 30, Survives: false}, // removed
		{ID: "done",    Name: "Completed", SortOrder: 40, Survives: true},
	}
	removed := pills[2]
	id, _ := pickSuccessor(removed, pills)
	if id != "backlog" {
		t.Fatalf("expected walk-back to backlog (skipping in-review), got %s", id)
	}
}

func TestPickSuccessor_fallsForwardWhenNothingBelow(t *testing.T) {
	pills := []pillRow{
		{ID: "removed1", Name: "Removed1", SortOrder: 10, Survives: false},
		{ID: "removed2", Name: "Removed2", SortOrder: 20, Survives: false},
		{ID: "doing",    Name: "Doing", SortOrder: 30, Survives: true},
	}
	removed := pills[0]
	id, _ := pickSuccessor(removed, pills)
	if id != "doing" {
		t.Fatalf("expected fallback forward to doing, got %s", id)
	}
}

func TestPickSuccessor_returnsEmptyWhenNoSurvivors(t *testing.T) {
	pills := []pillRow{
		{ID: "a", Name: "A", SortOrder: 10, Survives: false},
		{ID: "b", Name: "B", SortOrder: 20, Survives: false},
	}
	id, name := pickSuccessor(pills[0], pills)
	if id != "" || name != "" {
		t.Fatalf("expected empty result with no survivors, got %s/%s", id, name)
	}
}

func TestPickSuccessor_orderingIsStableRegardlessOfInputOrder(t *testing.T) {
	a := []pillRow{
		{ID: "stake", Name: "Stake",   SortOrder: 20, Survives: true},
		{ID: "done",  Name: "Done",    SortOrder: 40, Survives: true},
		{ID: "back",  Name: "Backlog", SortOrder: 10, Survives: true},
	}
	removed := pillRow{ID: "x", Name: "X", SortOrder: 30, Survives: false}
	all := append(a, removed)
	id, _ := pickSuccessor(removed, all)
	if id != "stake" {
		t.Fatalf("expected stake regardless of input order, got %s", id)
	}
}
