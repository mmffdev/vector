//go:build f3_dto_landed
// +build f3_dto_landed

// F3 — DTO Slot field assertion. Gated behind `f3_dto_landed` build tag.
//
// Why a separate file with a build tag:
// Story 00584 adds a `Slot *string` field to artefacttypes.ArtefactType.
// Until that field exists, referencing `t.Slot` is a compile error that
// would block EVERY test in the featuretests package — F1, F2, the other
// F3 tests, all of them. The compile failure IS the red signal we want
// for story 00584, but it should not break green tests for other features.
//
// On main: tag OFF, this file is excluded, the rest of the package builds
// and runs. Trying to run F3-DTO explicitly via
//   go test -tags f3_dto_landed ./internal/featuretests/...
// fails to compile — that IS the RED signal.
//
// When story 00584 lands and the DTO has Slot:
//   1. The implementer removes the `//go:build f3_dto_landed` lines.
//   2. This file joins the default test set and the runtime assertion
//      becomes the GREEN gate.
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
// Slot field. The reference to `t.Slot` is what makes this file fail to
// compile on main — story 00584 adds the field and unblocks it.
func f3TypeHasSlot(t artefacttypes.ArtefactType) bool {
	if t.Slot == nil {
		return false
	}
	return *t.Slot != ""
}

// silence unused-import vet noise if the test body is ever stubbed out.
var _ = context.Background
var _ = time.Now
