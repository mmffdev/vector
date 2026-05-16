// F3 — DTO Slot field assertion. Promoted to the default test set
// once story 00584 added artefacttypes.ArtefactType.Slot.
//
// History: this file was gated behind the `f3_dto_landed` build tag
// while the Slot field did not exist (a `t.Slot` reference would have
// blocked every test in the featuretests package from compiling). The
// tag is removed now that the DTO carries the field.
//
// Tracker group: `frontend-chip-foundation`, feature `F3`.

package featuretests_test

import (
	"context"
	"testing"
	"time"

	"github.com/mmffdev/vector-backend/internal/artefacttypes"
)

// TestF3_DTO_IncludesSlot asserts story 00584 surfaced the slot field
// on the ArtefactType DTO. Reads via the service so we go through the
// real SELECT list.
func TestF3_DTO_IncludesSlot(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !f3SlotColumnExists(ctx, t, pool) {
		t.Skip("artefacts_types_slot missing — story 00582 prerequisite")
	}

	a, _, err := f1FindTwoDistinctWorkspaces(ctx, pool)
	if err != nil {
		t.Skipf("dev DB has no usable (sub, ws) fixture: %v", err)
	}

	svc := artefacttypes.NewService(pool)
	types, err := svc.ListByWorkspace(ctx, a.subID, a.wsID)
	if err != nil {
		t.Fatalf("ListByWorkspace: %v", err)
	}
	if len(types) == 0 {
		t.Skipf("workspace %s has zero live artefact_types", a.wsID)
	}

	// At least one of the workspace's system types should have a slot.
	gotSlot := false
	for _, tp := range types {
		if f3TypeHasSlot(tp) {
			gotSlot = true
			break
		}
	}
	if !gotSlot {
		t.Errorf("no artefact_type in workspace %s exposes a Slot field — story 00584 must add it to the DTO + SELECT", a.wsID)
	}
}

// f3TypeHasSlot reports whether the ArtefactType DTO exposes a non-empty
// Slot field. The slot is the project-locked handle the catalogue uses
// to resolve types across gadmin renames.
func f3TypeHasSlot(t artefacttypes.ArtefactType) bool {
	if t.Slot == nil {
		return false
	}
	return *t.Slot != ""
}
