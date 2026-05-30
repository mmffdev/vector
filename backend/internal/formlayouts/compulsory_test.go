package formlayouts

import (
	"testing"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// Drift-pin test for the compulsory-field locked-group set. For every
// (slot, scope) artefact-type family, every key returned by
// artefactitems.CompulsoryFieldsForType MUST:
//
//	(1) resolve to a real ColumnSpec in the catalogue, and
//	(2) pass AppliesToType(slot, scope), and
//	(3) NOT be skipFromBuilder'd (the builder can actually place it).
//
// CompulsoryFieldsForType already enforces (1) and (2) by construction (it
// filters the raw rubric lists against the catalogue). This test re-asserts
// them as a regression guard AND pins (3): the save validator filters
// compulsory keys through skipFromBuilder before demanding them, so a
// compulsory key that is skipFromBuilder'd would be silently un-demandable
// and is therefore a rubric bug — drop it from the raw list in columns.go.
//
// Mirrors the style of artefactitems/columns_slot_gate_test.go.
func TestCompulsoryFieldsResolveApplyAndArePlaceable(t *testing.T) {
	cases := []struct {
		name  string
		slot  string
		scope string
	}{
		{"Defect", artefactitems.SlotDefect, artefactitems.ScopeWork},
		{"Risk", artefactitems.SlotRisk, artefactitems.ScopeWork},
		{"Task", artefactitems.SlotTask, artefactitems.ScopeWork},
		{"Story", artefactitems.SlotStory, artefactitems.ScopeWork},
		{"Epic", artefactitems.SlotEpic, artefactitems.ScopeWork},
		{"Strategy", "", artefactitems.ScopeStrategy},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compulsory := artefactitems.CompulsoryFieldsForType(tc.slot, tc.scope)
			if len(compulsory) == 0 {
				t.Fatalf("%s: CompulsoryFieldsForType returned an empty set", tc.name)
			}
			for key := range compulsory {
				spec, ok := artefactitems.CoreColumnSpecForName(key)
				if !ok {
					t.Errorf("%s: compulsory key %q does not resolve to a ColumnSpec", tc.name, key)
					continue
				}
				if !spec.AppliesToType(tc.slot, tc.scope) {
					t.Errorf("%s: compulsory key %q does not pass AppliesToType(slot=%q, scope=%q)", tc.name, key, tc.slot, tc.scope)
				}
				if skipFromBuilder(key) {
					t.Errorf("%s: compulsory key %q is skipFromBuilder'd — the builder cannot place it, so it must not be compulsory; drop it from the raw list in columns.go", tc.name, key)
				}
			}
		})
	}
}
