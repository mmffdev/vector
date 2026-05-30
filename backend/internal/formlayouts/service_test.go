package formlayouts

import (
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

func strptr(s string) *string { return &s }

// validateDoc is the SERVER IS THE GATE check. These tests pin the
// contract without needing a DB: malformed templates, unknown field
// keys, and missing compulsory core fields must all be rejected; a
// well-formed layout placing the full compulsory set must pass.
//
// NOTE (2026-05-30): the save gate was broadened from the 3-key mandatory
// set (title / flow_state_name / owner) to the per-type COMPULSORY locked
// group (artefactitems.CompulsoryFieldsForType). The compulsory set is a
// superset of the old mandatory set, so a layout placing only the 3
// mandatory fields is no longer sufficient — every compulsory field for the
// type must be placed. These tests were updated accordingly.

// compulsoryLayout builds a LayoutDoc that places every compulsory core
// field for (slot, scope), one per 100% row, so a "valid layout passes"
// assertion exercises the broadened gate. Optionally appends extraKeys
// (e.g. a family field under test) as additional rows.
func compulsoryLayout(slot, scope string, extraKeys ...string) LayoutDoc {
	compulsory := artefactitems.CompulsoryFieldsForType(slot, scope)
	keys := make([]string, 0, len(compulsory)+len(extraKeys))
	for k := range compulsory {
		if skipFromBuilder(k) {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	keys = append(keys, extraKeys...)
	rows := make([]Row, 0, len(keys))
	for i, k := range keys {
		kk := k
		rows = append(rows, Row{
			ID:       "r" + strconv.Itoa(i),
			Template: Template100,
			Cells:    []Cell{{ID: "c" + strconv.Itoa(i), FieldKey: &kk, Span: 100}},
		})
	}
	return LayoutDoc{Rows: rows}
}

func TestValidateDoc_RejectsMissingMandatoryCore(t *testing.T) {
	// Places title only — omits every other compulsory field.
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template100, Cells: []Cell{{ID: "c1", FieldKey: strptr("title"), Span: 100}}},
	}}
	err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork)
	if err == nil {
		t.Fatal("expected validation error for missing compulsory core fields")
	}
	ve, ok := err.(*ValidationError)
	if !ok {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if ve.Err != ErrMissingMandatory {
		t.Fatalf("expected ErrMissingMandatory, got %v", ve.Err)
	}
	// Every placeable compulsory field except the placed `title` must be
	// reported missing.
	wantMissing := 0
	for k := range artefactitems.CompulsoryFieldsForType(artefactitems.SlotStory, artefactitems.ScopeWork) {
		if !skipFromBuilder(k) && k != "title" {
			wantMissing++
		}
	}
	if len(ve.Missing) != wantMissing {
		t.Fatalf("expected %d missing fields, got %d: %v", wantMissing, len(ve.Missing), ve.Missing)
	}
}

func TestValidateDoc_AcceptsAllMandatoryPlaced(t *testing.T) {
	// A layout placing the FULL compulsory set for a Story must pass.
	doc := compulsoryLayout(artefactitems.SlotStory, artefactitems.ScopeWork)
	if err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork); err != nil {
		t.Fatalf("expected valid layout to pass, got %v", err)
	}
}

func TestValidateDoc_RejectsUnknownCoreField(t *testing.T) {
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template100, Cells: []Cell{{ID: "c1", FieldKey: strptr("not_a_real_column"), Span: 100}}},
	}}
	err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork)
	if err == nil {
		t.Fatal("expected error for unknown core field")
	}
	if ve, ok := err.(*ValidationError); !ok || ve.Err != ErrUnknownField {
		t.Fatalf("expected ErrUnknownField, got %v", err)
	}
}

func TestValidateDoc_RejectsUnknownCustomField(t *testing.T) {
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template100, Cells: []Cell{{ID: "c1", FieldKey: strptr("custom:deadbeef"), Span: 100}}},
	}}
	// customKeys does not contain the referenced key.
	err := validateDoc(doc, map[string]bool{"custom:abc": true}, artefactitems.SlotStory, artefactitems.ScopeWork)
	if err == nil {
		t.Fatal("expected error for unknown custom field")
	}
	if ve, ok := err.(*ValidationError); !ok || ve.Err != ErrUnknownField {
		t.Fatalf("expected ErrUnknownField, got %v", err)
	}
}

func TestValidateDoc_RejectsBadTemplateCellCount(t *testing.T) {
	// 50-50 template declared but only one cell present.
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template5050, Cells: []Cell{{ID: "c1", FieldKey: strptr("title"), Span: 50}}},
	}}
	err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork)
	if err == nil {
		t.Fatal("expected error for template/cell-count mismatch")
	}
	if ve, ok := err.(*ValidationError); !ok || ve.Err != ErrBadTemplate {
		t.Fatalf("expected ErrBadTemplate, got %v", err)
	}
}

func TestValidateDoc_RejectsUnknownTemplate(t *testing.T) {
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: "60-40", Cells: []Cell{{ID: "c1", FieldKey: strptr("title"), Span: 60}}},
	}}
	err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork)
	if err == nil {
		t.Fatal("expected error for unknown template")
	}
	if ve, ok := err.(*ValidationError); !ok || !strings.Contains(ve.Reason, "unknown template") {
		t.Fatalf("expected unknown-template reason, got %v", err)
	}
}

func TestValidateDoc_EmptyCellsAllowedAlongsideMandatory(t *testing.T) {
	// Full compulsory set placed, PLUS a row carrying an explicit empty slot.
	doc := compulsoryLayout(artefactitems.SlotStory, artefactitems.ScopeWork)
	doc.Rows = append(doc.Rows, Row{
		ID: "rEmpty", Template: Template3070, Cells: []Cell{
			{ID: "cEmpty", FieldKey: nil, Span: 30}, // empty slot
			{ID: "cFilled", FieldKey: strptr("status"), Span: 70},
		},
	})
	if err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork); err != nil {
		t.Fatalf("expected empty slot to be allowed, got %v", err)
	}
}

// Per-type gate: a core field gated to one family must be REJECTED when the
// layout's type is a different family. This is the save-side mirror of the
// slot-gate trigger — the layout can never reference a field the DB would
// refuse to store on that type.
func TestValidateDoc_RejectsDefectFieldOnStoryForm(t *testing.T) {
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template100, Cells: []Cell{{ID: "c1", FieldKey: strptr("title"), Span: 100}}},
		{ID: "r2", Template: Template5050, Cells: []Cell{
			{ID: "c2", FieldKey: strptr("flow_state_name"), Span: 50},
			{ID: "c3", FieldKey: strptr("owner"), Span: 50},
		}},
		// defect_severity is FamilyDefect — invalid on a wrk_story form.
		{ID: "r3", Template: Template100, Cells: []Cell{{ID: "c4", FieldKey: strptr("defect_severity"), Span: 100}}},
	}}
	err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork)
	if err == nil {
		t.Fatal("expected rejection of defect field on a story form")
	}
	ve, ok := err.(*ValidationError)
	if !ok || ve.Err != ErrUnknownField {
		t.Fatalf("expected ErrUnknownField, got %v", err)
	}
	if !strings.Contains(ve.Reason, "does not apply") {
		t.Fatalf("expected does-not-apply reason, got %q", ve.Reason)
	}
}

func TestValidateDoc_AcceptsDefectFieldOnDefectForm(t *testing.T) {
	// Full compulsory set for a Defect (which already includes defect_severity
	// as a compulsory field) must pass.
	doc := compulsoryLayout(artefactitems.SlotDefect, artefactitems.ScopeWork)
	if err := validateDoc(doc, nil, artefactitems.SlotDefect, artefactitems.ScopeWork); err != nil {
		t.Fatalf("expected defect field to be allowed on a defect form, got %v", err)
	}
}

// Strategy fields are scope-gated (slot is "" for strategy types).
func TestValidateDoc_RejectsStrategicFieldOnWorkForm(t *testing.T) {
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template100, Cells: []Cell{{ID: "c1", FieldKey: strptr("title"), Span: 100}}},
		{ID: "r2", Template: Template5050, Cells: []Cell{
			{ID: "c2", FieldKey: strptr("flow_state_name"), Span: 50},
			{ID: "c3", FieldKey: strptr("owner"), Span: 50},
		}},
		{ID: "r3", Template: Template100, Cells: []Cell{{ID: "c4", FieldKey: strptr("strategic_job_size"), Span: 100}}},
	}}
	err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork)
	if err == nil {
		t.Fatal("expected rejection of strategic field on a work form")
	}
	if ve, ok := err.(*ValidationError); !ok || ve.Err != ErrUnknownField {
		t.Fatalf("expected ErrUnknownField, got %v", err)
	}
}
