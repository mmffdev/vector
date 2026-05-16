package artefactitems

// TD-WORKITEMS-GENERIC contract — backfill test, 2026-05-16.
//
// 2026-05-16 commit `a1ef5d7` deleted every per-type fixed-shape field
// from WorkItemsSummary (Epics/Stories/Tasks/Defects/Risks) in favour
// of the generic ByType map. This test pins the post-cleanup shape so
// a future "let me just add .Risks back, it's quick" reintroduction
// fails CI before it ships.
//
// Tests written red-first (verified by temporarily restoring a single
// per-type field on WorkItemsSummary — TestWorkItemsSummary_HasOnlyGenericShape
// failed; restored to the clean shape and confirmed green). Filed as a
// backfill per the red-green-always discipline.
//
// Note the file is `package artefactitems` (not `_test`) so reflection
// can iterate the struct's fields directly without going through an
// exported alias.

import (
	"reflect"
	"sort"
	"testing"
)

// TestWorkItemsSummary_HasOnlyGenericShape asserts WorkItemsSummary
// has exactly three fields: Total (int), Blocked (int), ByType
// (map[string]int). The whole point of TD-WORKITEMS-GENERIC is that
// adding a new artefact type does NOT add a Go field; this test is
// the canary that catches a regression of that contract.
func TestWorkItemsSummary_HasOnlyGenericShape(t *testing.T) {
	rt := reflect.TypeOf(WorkItemsSummary{})

	got := make([]string, 0, rt.NumField())
	for i := 0; i < rt.NumField(); i++ {
		got = append(got, rt.Field(i).Name)
	}
	sort.Strings(got)

	want := []string{"Blocked", "ByType", "Total"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf(
			"WorkItemsSummary fields changed: got %v, want %v.\n"+
				"TD-WORKITEMS-GENERIC (commit a1ef5d7) deleted every per-type fixed-shape field — adding one back forces a Go change on every new artefact type. Add to ByType instead.",
			got, want,
		)
	}

	// Spot-check the field types so a rename without a shape change
	// still falls out.
	checkFieldKind := func(name string, want reflect.Kind) {
		f, ok := rt.FieldByName(name)
		if !ok {
			t.Errorf("field %q missing", name)
			return
		}
		if f.Type.Kind() != want {
			t.Errorf("field %q kind = %v, want %v", name, f.Type.Kind(), want)
		}
	}
	checkFieldKind("Total", reflect.Int)
	checkFieldKind("Blocked", reflect.Int)
	checkFieldKind("ByType", reflect.Map)

	bt, _ := rt.FieldByName("ByType")
	if bt.Type.Key().Kind() != reflect.String {
		t.Errorf("ByType key kind = %v, want String", bt.Type.Key().Kind())
	}
	if bt.Type.Elem().Kind() != reflect.Int {
		t.Errorf("ByType value kind = %v, want Int", bt.Type.Elem().Kind())
	}
}

// TestWorkItemsSummary_JSONTagsLocked pins the wire-shape JSON keys so
// a rename without a corresponding frontend update fails the suite.
func TestWorkItemsSummary_JSONTagsLocked(t *testing.T) {
	rt := reflect.TypeOf(WorkItemsSummary{})
	wantTags := map[string]string{
		"Total":   `total`,
		"Blocked": `blocked`,
		"ByType":  `by_type`,
	}
	for goName, jsonName := range wantTags {
		f, ok := rt.FieldByName(goName)
		if !ok {
			t.Errorf("field %q missing", goName)
			continue
		}
		got := f.Tag.Get("json")
		if got != jsonName {
			t.Errorf("field %q JSON tag = %q, want %q (frontend reads this key)", goName, got, jsonName)
		}
	}
}
