package artefactitems

// Flow State Change Owner promotion (2026-05-30, migration 164) — pin the
// FSCO core column into the column-spec catalogue, the wire shape, the
// patch-input struct, and both SQL projections. Unit tests; no DB, no HTTP.
//
// Mirrors columns_fourth_wave_test.go (mig 162) + columns_rally_screenshots_test.go
// (migs 150-155, the submitted_by user-FK template this column copies).
//
// FSCO is a universal user-FK (uuid → users(users_id) ON DELETE SET NULL),
// valid on every artefact type — NO slot/scope gate, unlike the fourth-wave
// strategy-only columns. Wire key: flow_state_change_owner_user_id; underlying
// column: artefacts_id_user_flow_state_change_owner.

import (
	"reflect"
	"strings"
	"testing"
)

const (
	fscoWireKey         = "flow_state_change_owner_user_id"
	fscoUnderlyingCol   = "artefacts_id_user_flow_state_change_owner"
	fscoPatchInputField = "FlowStateChangeOwnerUserID"
)

// TestFSCO_InCatalogue asserts the FSCO wire-key is in ArtefactItemColumns,
// so /work-items/columns surfaces it to the picker.
func TestFSCO_InCatalogue(t *testing.T) {
	if !IsKnownArtefactItemColumn(fscoWireKey) {
		t.Errorf("ColumnSpec missing for %q — column-picker won't surface it (mig 164 ColumnSpec parity violation)", fscoWireKey)
	}
}

// TestFSCO_HasLabelAndGroup asserts the FSCO column has non-empty Label +
// Group, is Addable, and is DefaultVisible=false (opt-in, per wave convention).
func TestFSCO_HasLabelAndGroup(t *testing.T) {
	var spec ColumnSpec
	var ok bool
	for _, c := range ArtefactItemColumns {
		if c.Name == fscoWireKey {
			spec, ok = c, true
			break
		}
	}
	if !ok {
		t.Fatalf("column %q not found in catalogue", fscoWireKey)
	}
	if spec.Label == "" {
		t.Errorf("column %q has empty Label — picker will fall back to Name", fscoWireKey)
	}
	if spec.Group == "" {
		t.Errorf("column %q has empty Group — picker will bucket under Other", fscoWireKey)
	}
	if !spec.Addable {
		t.Errorf("column %q is not Addable — frontend can't toggle it on", fscoWireKey)
	}
	if spec.DefaultVisible {
		t.Errorf("column %q is DefaultVisible=true — wave convention is opt-in only", fscoWireKey)
	}
}

// TestFSCO_OnWorkItemStruct asserts the wire-key has a matching json tag on
// the WorkItem struct, so the read path doesn't silently drop it.
func TestFSCO_OnWorkItemStruct(t *testing.T) {
	rt := reflect.TypeOf(WorkItem{})
	for i := 0; i < rt.NumField(); i++ {
		tag := rt.Field(i).Tag.Get("json")
		if comma := strings.Index(tag, ","); comma >= 0 {
			tag = tag[:comma]
		}
		if tag == fscoWireKey {
			return
		}
	}
	t.Errorf("WorkItem struct has no json:%q field — wire shape will silently drop the column", fscoWireKey)
}

// TestFSCO_OnPatchInputStruct asserts PatchWorkItemInput carries the FSCO
// field, so the PATCH handler can write it.
func TestFSCO_OnPatchInputStruct(t *testing.T) {
	rt := reflect.TypeOf(PatchWorkItemInput{})
	for i := 0; i < rt.NumField(); i++ {
		if rt.Field(i).Name == fscoPatchInputField {
			return
		}
	}
	t.Errorf("PatchWorkItemInput missing %q — handler cannot PATCH the column", fscoPatchInputField)
}

// TestFSCO_InBothSelectProjections asserts the wire-key alias appears in
// BOTH the Get and List SELECT templates, in lockstep. Drift between the
// two would make List rows scan differently from Get rows.
func TestFSCO_InBothSelectProjections(t *testing.T) {
	inGet := strings.Contains(sqlWorkItemColumns, " AS "+fscoWireKey)
	inList := strings.Contains(sqlWorkItemColumnsListTemplate, " AS "+fscoWireKey)
	if !inGet {
		t.Errorf("sqlWorkItemColumns missing alias %q — SELECT/Scan order will drift", fscoWireKey)
	}
	if !inList {
		t.Errorf("sqlWorkItemColumnsListTemplate missing alias %q — List/Get scan drift", fscoWireKey)
	}
	if inGet != inList {
		t.Errorf("projection drift on %q: get=%v list=%v", fscoWireKey, inGet, inList)
	}
}

// TestFSCO_UnderlyingColumnPresent pins the underlying artefacts_* column
// name (matching the mig 164 ADD COLUMN) into both projections. A rename or
// accidental delete is caught at CI.
func TestFSCO_UnderlyingColumnPresent(t *testing.T) {
	if !strings.Contains(sqlWorkItemColumns, fscoUnderlyingCol) {
		t.Errorf("sqlWorkItemColumns missing underlying column %q — wire scan will fail at runtime", fscoUnderlyingCol)
	}
	if !strings.Contains(sqlWorkItemColumnsListTemplate, fscoUnderlyingCol) {
		t.Errorf("sqlWorkItemColumnsListTemplate missing underlying column %q — List wire scan will fail at runtime", fscoUnderlyingCol)
	}
}
