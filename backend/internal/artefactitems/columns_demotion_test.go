package artefactitems

// Core-field demotion (2026-05-29, migration 147) — pin the 18 new
// first-class columns into the column-spec catalogue and into the wire
// shape. Unit tests; no DB, no HTTP.
//
// Spec: docs/superpowers/specs/2026-05-29-core-field-demotion-design.md
//
// These tests are the canary that catches a regression of the wire
// contract — if any rename, accidental delete, or json-tag drift
// happens, CI fails before the change ships.

import (
	"encoding/json"
	"reflect"
	"testing"
)

// demotedCoreColumns is the canonical wire-key list shipped by mig 147
// plus its backend ColumnSpec entries. The order here is illustrative;
// the assertions just check membership.
//
// One entry per new wire-key — the test pins the same set on BOTH the
// ColumnSpec catalogue AND the WorkItem struct's json tags, so the two
// can't drift independently.
var demotedCoreColumns = []string{
	"defect_severity",
	"defect_status",
	"environment",
	"estimate_hours",
	"estimate_remaining",
	"estimate_initial",
	"estimate_updated",
	"is_expedite",
	"is_ready",
	"affects_doc",
	"count_child_test_cases",
	"notes",
	"notes_doc",
	"planned_start_date",
	"planned_finish_date",
	"actual_start_date",
	"flow_state_changed_at",
	"strategic_investment_group",
}

// TestDemotedCoreColumns_InCatalogue asserts every new wire-key from
// mig 147 is present in ArtefactItemColumns. Without this, /work-items/
// columns wouldn't surface the new fields and the picker would silently
// miss them.
func TestDemotedCoreColumns_InCatalogue(t *testing.T) {
	for _, name := range demotedCoreColumns {
		t.Run(name, func(t *testing.T) {
			if !IsKnownArtefactItemColumn(name) {
				t.Errorf("ColumnSpec missing for %q — column-picker won't surface it (mig 147 ColumnSpec parity violation)", name)
			}
		})
	}
}

// TestDemotedCoreColumns_HaveLabelAndGroup asserts every new column
// carries a non-empty Label + Group. The frontend column-picker buckets
// columns by Group and falls back to Name for Label when empty — leaving
// either blank is technically valid but the spec calls for proper
// labels, so pin them here.
func TestDemotedCoreColumns_HaveLabelAndGroup(t *testing.T) {
	want := make(map[string]bool, len(demotedCoreColumns))
	for _, n := range demotedCoreColumns {
		want[n] = true
	}
	seen := map[string]ColumnSpec{}
	for _, c := range ArtefactItemColumns {
		if want[c.Name] {
			seen[c.Name] = c
		}
	}
	for _, n := range demotedCoreColumns {
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
				t.Errorf("column %q is DefaultVisible=true — spec says opt-in only", n)
			}
		})
	}
}

// TestDemotedCoreColumns_OnWorkItemStruct asserts every wire-key has a
// matching json tag on the WorkItem struct. Reflection: walk the fields
// once, build the json-tag set, then check membership.
func TestDemotedCoreColumns_OnWorkItemStruct(t *testing.T) {
	rt := reflect.TypeOf(WorkItem{})
	tagSet := make(map[string]bool, rt.NumField())
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		tag := f.Tag.Get("json")
		// Strip ",omitempty" and friends.
		for j := 0; j < len(tag); j++ {
			if tag[j] == ',' {
				tag = tag[:j]
				break
			}
		}
		if tag != "" && tag != "-" {
			tagSet[tag] = true
		}
	}
	for _, name := range demotedCoreColumns {
		t.Run(name, func(t *testing.T) {
			if !tagSet[name] {
				t.Errorf("WorkItem struct has no json:%q field — wire shape will silently drop the column", name)
			}
		})
	}
}

// TestDemotedCoreColumns_OnPatchInputStruct asserts each new column is
// patchable. Without a matching PatchWorkItemInput field the PATCH
// handler would silently drop the value.
func TestDemotedCoreColumns_OnPatchInputStruct(t *testing.T) {
	rt := reflect.TypeOf(PatchWorkItemInput{})
	// PatchWorkItemInput uses unexported Go field names that match the
	// camel-cased wire-key (DefectSeverity ↔ defect_severity). Snake to
	// camel for each known column, then check membership.
	want := map[string]bool{
		"DefectSeverity":           true,
		"DefectStatus":             true,
		"Environment":              true,
		"EstimateHours":            true,
		"EstimateRemaining":        true,
		"EstimateInitial":          true,
		"EstimateUpdated":          true,
		"IsExpedite":               true,
		"IsReady":                  true,
		"AffectsDoc":               true,
		"CountChildTestCases":      true,
		"Notes":                    true,
		"NotesDoc":                 true,
		"PlannedStartDate":         true,
		"PlannedFinishDate":        true,
		"ActualStartDate":          true,
		"StrategicInvestmentGroup": true,
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

// TestValidDefectSeverities mirrors the artefacts_defect_severity_chk
// constraint added in migration 147. Pin the allowed set so a future
// rename of the constraint doesn't drift from the Go validator.
func TestValidDefectSeverities(t *testing.T) {
	want := []string{"low", "medium", "high", "critical"}
	for _, v := range want {
		if !validDefectSeverities[v] {
			t.Errorf("validDefectSeverities missing %q — bad CHECK mirror", v)
		}
	}
	if validDefectSeverities["bogus"] {
		t.Error("validDefectSeverities accepts unknown value")
	}
	if len(validDefectSeverities) != len(want) {
		t.Errorf("validDefectSeverities has %d entries; want %d", len(validDefectSeverities), len(want))
	}
}

// TestValidDefectStatuses mirrors the artefacts_defect_status_chk
// constraint added in migration 147.
func TestValidDefectStatuses(t *testing.T) {
	want := []string{"open", "triaged", "in_progress", "fixed", "verified", "closed", "wontfix", "duplicate"}
	for _, v := range want {
		if !validDefectStatuses[v] {
			t.Errorf("validDefectStatuses missing %q — bad CHECK mirror", v)
		}
	}
	if validDefectStatuses["bogus"] {
		t.Error("validDefectStatuses accepts unknown value")
	}
	if len(validDefectStatuses) != len(want) {
		t.Errorf("validDefectStatuses has %d entries; want %d", len(validDefectStatuses), len(want))
	}
}

// TestWorkItem_DemotedColumns_JSONShape sanity-checks that a WorkItem
// with the new fields populated round-trips through json.Marshal without
// dropping or panicking on any of the new keys. Defensive — pgx maps
// json.RawMessage to JSONB and we want to be sure the wire shape
// re-marshals cleanly when the new columns carry data.
func TestWorkItem_DemotedColumns_JSONShape(t *testing.T) {
	sev := "high"
	stat := "open"
	env := "production"
	est := "12.5"
	notes := "post-mortem notes"
	pStart := "2027-01-01"
	pFinish := "2027-02-01"
	aStart := "2027-01-15"
	sig := "Q1-2027-platform"
	rawNotes := json.RawMessage(`{"type":"doc","content":[]}`)
	count := 3

	wi := WorkItem{
		ID:                       "abc",
		Title:                    "test",
		DefectSeverity:           &sev,
		DefectStatus:             &stat,
		Environment:              &env,
		EstimateHours:            &est,
		EstimateRemaining:        &est,
		EstimateInitial:          &est,
		EstimateUpdated:          &est,
		IsExpedite:               true,
		IsReady:                  true,
		AffectsDoc:               true,
		CountChildTestCases:      count,
		Notes:                    &notes,
		NotesDoc:                 &rawNotes,
		PlannedStartDate:         &pStart,
		PlannedFinishDate:        &pFinish,
		ActualStartDate:          &aStart,
		StrategicInvestmentGroup: &sig,
	}

	bs, err := json.Marshal(wi)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(bs, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, name := range demotedCoreColumns {
		if _, ok := back[name]; !ok {
			t.Errorf("wire payload missing %q after marshal round-trip", name)
		}
	}
}
