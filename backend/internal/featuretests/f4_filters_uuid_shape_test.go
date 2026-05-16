//go:build f4_filters_uuid_shape
// +build f4_filters_uuid_shape

// F4 — Filters shape assertion (compile-time). Gated behind
// `f4_filters_uuid_shape` build tag.
//
// Story 00586 reshapes artefactitems.Filters from per-field *string
// (single-value, slug-friendly) to []uuid.UUID (multi-value, UUID-only)
// for ItemType, Status, Priority, OwnerID. Until that lands, the
// references below are TYPE errors that would block the entire
// featuretests package.
//
// Tag OFF on main: this file is excluded; the rest of the suite builds.
// Implementer of story 00586 removes the tag once the shape lands.
//
// Tracker group: `frontend-chip-foundation`, feature `F4`.

package featuretests_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// TestF4_Filters_ShapeIsUUIDList asserts the Filters struct carries
// []uuid.UUID for the multi-select fields. The TYPE assertion at
// compile time IS the red signal — once story 00586 reshapes the
// struct, this file participates in the runtime test set.
func TestF4_Filters_ShapeIsUUIDList(t *testing.T) {
	id := uuid.New()

	// These four assignments will only compile once Filters carries
	// []uuid.UUID for each field. On main today they are *string and
	// the assignment is a type error.
	f := artefactitems.Filters{
		ItemType: []uuid.UUID{id},
		Status:   []uuid.UUID{id, uuid.New()},
		Priority: []uuid.UUID{id},
		OwnerID:  []uuid.UUID{id},
	}

	if len(f.ItemType) != 1 {
		t.Errorf("Filters.ItemType: want 1 element, got %d", len(f.ItemType))
	}
	if len(f.Status) != 2 {
		t.Errorf("Filters.Status: want 2 elements, got %d", len(f.Status))
	}
}
