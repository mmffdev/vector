// F4 — Filters shape assertion. Promoted to the default test set once
// story 00586 reshaped artefactitems.Filters from per-field *string
// to multi-value list types (ItemType/Status/OwnerID = []uuid.UUID,
// Priority = []string).
//
// History: this file was gated behind the `f4_filters_uuid_shape`
// build tag while Filters still carried *string single-values (the
// list-literal references below would have been compile errors that
// blocked every test in the featuretests package). The tag is removed
// now that the new shape is the default.
//
// Tracker group: `frontend-chip-foundation`, feature `F4`.

package featuretests_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// TestF4_Filters_ShapeIsMultiValue asserts the Filters struct carries
// list shapes for the multi-select fields. ItemType / Status / OwnerID
// move to []uuid.UUID (UUIDs on the wire). Priority stays a text list
// ([]string) — priority is a project-locked enum, not a per-tenant
// UUID — so the multi-select reshape is the only contract there.
//
// The TYPE assertions at compile time IS the red signal — once story
// 00586 reshapes the struct, this file participates in the runtime
// test set.
func TestF4_Filters_ShapeIsMultiValue(t *testing.T) {
	id := uuid.New()

	// These assignments only compile once Filters carries list types
	// for each field. On main today they are *string (single-value)
	// and the assignment is a type error.
	f := artefactitems.Filters{
		ItemType: []uuid.UUID{id},
		Status:   []uuid.UUID{id, uuid.New()},
		Priority: []string{"critical", "high"},
		OwnerID:  []uuid.UUID{id},
	}

	if len(f.ItemType) != 1 {
		t.Errorf("Filters.ItemType: want 1 element, got %d", len(f.ItemType))
	}
	if len(f.Status) != 2 {
		t.Errorf("Filters.Status: want 2 elements, got %d", len(f.Status))
	}
	if len(f.Priority) != 2 {
		t.Errorf("Filters.Priority: want 2 elements, got %d", len(f.Priority))
	}
	if len(f.OwnerID) != 1 {
		t.Errorf("Filters.OwnerID: want 1 element, got %d", len(f.OwnerID))
	}
}
