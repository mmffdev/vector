package artefactitems

// Fourth-wave demotion batch (2026-05-29, migration 162) — pin the 4
// new core columns into the column-spec catalogue, the wire shape, and
// the SQL projections. Unit tests; no DB, no HTTP.
//
// Spec: handovers/a_customFields_coreDemotion.md (fourth-wave section).
//
// Mirrors columns_demotion_test.go (mig 147) + columns_rally_screenshots_test.go
// (migs 150-155). This wave adds:
//   - artefacts_defect_browser                       (defect-only, gated)
//   - artefacts_work_accepted_date                   (universal)
//   - artefacts_strategic_value_stream_identifier    (strategy-only, gated)
//   - artefacts_strategic_investment_weight          (strategy-only, gated;
//                                                      vocab undefined — see
//                                                      TD-STRATEGIC-INVESTMENT-WEIGHT-VOCAB)
//
// No CHECK-vocab maps to mirror — strategic_investment_weight's vocab is
// deferred to a follow-up migration once Rick locks the value-store mechanism.
// The slot-gate trigger (extended in mig 162) handles per-type writeability
// server-side; handler-side validation only ensures the wire shape stays sane.

import (
	"reflect"
	"strings"
	"testing"
)

// fourthWaveColumns is the canonical wire-key list shipped by mig 162.
var fourthWaveColumns = []string{
	"defect_browser",
	"work_accepted_date",
	"strategic_value_stream_identifier",
	"strategic_investment_weight",
}

// TestFourthWave_InCatalogue asserts every new wire-key from mig 162
// is present in ArtefactItemColumns. Without this, /work-items/columns
// wouldn't surface the new fields and the picker would silently miss them.
func TestFourthWave_InCatalogue(t *testing.T) {
	for _, name := range fourthWaveColumns {
		t.Run(name, func(t *testing.T) {
			if !IsKnownArtefactItemColumn(name) {
				t.Errorf("ColumnSpec missing for %q — column-picker won't surface it (mig 162 ColumnSpec parity violation)", name)
			}
		})
	}
}

// TestFourthWave_HaveLabelAndGroup asserts each new column has non-empty
// Label + Group, is Addable, and is DefaultVisible=false (opt-in only —
// matches the wave-1/2 conventions).
func TestFourthWave_HaveLabelAndGroup(t *testing.T) {
	want := make(map[string]bool, len(fourthWaveColumns))
	for _, n := range fourthWaveColumns {
		want[n] = true
	}
	seen := map[string]ColumnSpec{}
	for _, c := range ArtefactItemColumns {
		if want[c.Name] {
			seen[c.Name] = c
		}
	}
	for _, n := range fourthWaveColumns {
		t.Run(n, func(t *testing.T) {
			spec, ok := seen[n]
			if !ok {
				t.Fatalf("column %q not found in catalogue", n)
			}
			if spec.Label == "" {
				t.Errorf("column %q has empty Label — picker will fall back to Name", n)
			}
			if spec.Group == "" {
				t.Errorf("column %q has empty Group — picker will bucket under Other", n)
			}
			if !spec.Addable {
				t.Errorf("column %q is not Addable — frontend can't toggle it on", n)
			}
			if spec.DefaultVisible {
				t.Errorf("column %q is DefaultVisible=true — wave convention is opt-in only", n)
			}
		})
	}
}

// TestFourthWave_OnWorkItemStruct asserts every wire-key has a matching
// json tag on the WorkItem struct. Reflection: walk the fields, build
// the json-tag set, then check membership.
func TestFourthWave_OnWorkItemStruct(t *testing.T) {
	rt := reflect.TypeOf(WorkItem{})
	tagSet := make(map[string]bool, rt.NumField())
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		tag := f.Tag.Get("json")
		if comma := strings.Index(tag, ","); comma >= 0 {
			tag = tag[:comma]
		}
		if tag != "" && tag != "-" {
			tagSet[tag] = true
		}
	}
	for _, name := range fourthWaveColumns {
		t.Run(name, func(t *testing.T) {
			if !tagSet[name] {
				t.Errorf("WorkItem struct has no json:%q field — wire shape will silently drop the column", name)
			}
		})
	}
}

// TestFourthWave_OnPatchInputStruct asserts each patchable fourth-wave
// column has a matching field on PatchWorkItemInput. Without it the
// PATCH handler would silently drop the value.
func TestFourthWave_OnPatchInputStruct(t *testing.T) {
	rt := reflect.TypeOf(PatchWorkItemInput{})
	want := map[string]bool{
		"DefectBrowser":                  true,
		"WorkAcceptedDate":               true,
		"StrategicValueStreamIdentifier": true,
		"StrategicInvestmentWeight":      true,
	}
	have := make(map[string]bool, rt.NumField())
	for i := 0; i < rt.NumField(); i++ {
		have[rt.Field(i).Name] = true
	}
	for name := range want {
		t.Run(name, func(t *testing.T) {
			if !have[name] {
				t.Errorf("PatchWorkItemInput missing %q — handler cannot PATCH the column", name)
			}
		})
	}
}

// TestFourthWave_InSelectProjection asserts every new wire-key appears
// in the shared sqlWorkItemColumns SELECT. Without this the row hydrator
// can't populate the field (the SELECT would be missing the column and
// scanWorkItemRow would scan from the wrong offset).
func TestFourthWave_InSelectProjection(t *testing.T) {
	for _, name := range fourthWaveColumns {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(sqlWorkItemColumns, " AS "+name) {
				t.Errorf("sqlWorkItemColumns missing alias %q — SELECT/Scan order will drift", name)
			}
		})
	}
}

// TestFourthWave_InListSelectProjection asserts every new wire-key also
// appears in sqlWorkItemColumnsListTemplate (the LIST-path variant).
// The two projections MUST stay in lockstep — a drift would cause List
// rows to scan differently from Get rows.
func TestFourthWave_InListSelectProjection(t *testing.T) {
	for _, name := range fourthWaveColumns {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(sqlWorkItemColumnsListTemplate, " AS "+name) {
				t.Errorf("sqlWorkItemColumnsListTemplate missing alias %q — List/Get scan drift", name)
			}
		})
	}
}

// TestFourthWave_WhitelistParity asserts the two SQL projections stay
// in step on every new wire-key — a column that appears in one but not
// the other is a class-of-bug we want CI to catch.
func TestFourthWave_WhitelistParity(t *testing.T) {
	for _, name := range fourthWaveColumns {
		inA := strings.Contains(sqlWorkItemColumns, " AS "+name)
		inB := strings.Contains(sqlWorkItemColumnsListTemplate, " AS "+name)
		t.Run(name, func(t *testing.T) {
			if inA != inB {
				t.Errorf("projection drift on %q: sqlWorkItemColumns=%v sqlWorkItemColumnsListTemplate=%v", name, inA, inB)
			}
		})
	}
}

// TestFourthWave_UnderlyingColumnsPresent pins the underlying
// `artefacts_*` column names (matching the mig 162 ALTER TABLE) into
// the SELECT projection. A future rename or accidental delete is caught.
func TestFourthWave_UnderlyingColumnsPresent(t *testing.T) {
	underlying := []string{
		"artefacts_defect_browser",
		"artefacts_work_accepted_date",
		"artefacts_strategic_value_stream_identifier",
		"artefacts_strategic_investment_weight",
	}
	for _, col := range underlying {
		t.Run(col, func(t *testing.T) {
			if !strings.Contains(sqlWorkItemColumns, col) {
				t.Errorf("sqlWorkItemColumns missing underlying column %q — wire scan will fail at runtime", col)
			}
			if !strings.Contains(sqlWorkItemColumnsListTemplate, col) {
				t.Errorf("sqlWorkItemColumnsListTemplate missing underlying column %q — List wire scan will fail at runtime", col)
			}
		})
	}
}
