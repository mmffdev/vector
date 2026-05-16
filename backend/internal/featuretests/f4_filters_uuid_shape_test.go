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
// list shapes for the multi-select fields. ItemType / Status / Priority
// / OwnerID are all []uuid.UUID — UUIDs on the wire so gadmin display-
// name renames and tenant-added custom rows (PLA-0055 Showstopper)
// flow through without code changes.
//
// History: Priority started this PR as []string (project-locked
// vocabulary). PLA-0055 promoted Priority to a per-workspace
// catalogue so it joins the UUID-list shape; this assertion reflects
// that final state.
func TestF4_Filters_ShapeIsMultiValue(t *testing.T) {
	id := uuid.New()

	f := artefactitems.Filters{
		ItemType: []uuid.UUID{id},
		Status:   []uuid.UUID{id, uuid.New()},
		Priority: []uuid.UUID{id, uuid.New()},
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
