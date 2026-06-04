package artefactitems_test

import (
	"context"
	"testing"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// TestListWorkItems_PrioInvariants asserts the derivation rules for the new
// Prio column:
//   - Every top-level non-task row has non-nil Prio.
//   - Every nested row (parent_id != nil) has nil Prio.
//   - Every task row has nil Prio.
//   - Non-nil Prio values are unique and form a contiguous 1..N sequence in
//     ORDER BY artefacts_position ASC.
func TestListWorkItems_PrioInvariants(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")

	items, _, err := svc.ListWorkItems(context.Background(), sub, artefactitems.Filters{Limit: 1000})
	if err != nil {
		t.Fatalf("ListWorkItems: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no items in test subscription — cannot assert Prio invariants")
	}

	seen := make(map[int]string) // prio → item id, for uniqueness check
	maxPrio := 0
	qualifyingCount := 0

	for _, item := range items {
		isTopLevel := item.ParentID == nil
		isTask := item.ItemType == "task"
		qualifies := isTopLevel && !isTask

		if qualifies {
			qualifyingCount++
			if item.Prio == nil {
				t.Errorf("item %s (top-level, type=%s) has nil Prio, want non-nil", item.ID, item.ItemType)
				continue
			}
			if prev, dup := seen[*item.Prio]; dup {
				t.Errorf("Prio %d duplicated: %s and %s", *item.Prio, prev, item.ID)
			}
			seen[*item.Prio] = item.ID
			if *item.Prio > maxPrio {
				maxPrio = *item.Prio
			}
		} else {
			if item.Prio != nil {
				t.Errorf("item %s (top_level=%v, type=%s) has Prio=%d, want nil", item.ID, isTopLevel, item.ItemType, *item.Prio)
			}
		}
	}

	// Contiguous 1..N
	if qualifyingCount > 0 {
		if maxPrio != qualifyingCount {
			t.Errorf("max Prio = %d but qualifying count = %d (expect contiguous 1..N)", maxPrio, qualifyingCount)
		}
		for i := 1; i <= qualifyingCount; i++ {
			if _, ok := seen[i]; !ok {
				t.Errorf("Prio %d missing from sequence 1..%d", i, qualifyingCount)
			}
		}
	}
}
