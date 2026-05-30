package formlayouts

import (
	"strings"
	"testing"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

func strptr(s string) *string { return &s }

// validateDoc is the SERVER IS THE GATE check. These tests pin the
// contract without needing a DB: malformed templates, unknown field
// keys, and missing mandatory core fields must all be rejected; a
// well-formed layout placing the mandatory set must pass.

func TestValidateDoc_RejectsMissingMandatoryCore(t *testing.T) {
	// Places title only — omits flow_state_name + owner.
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template100, Cells: []Cell{{ID: "c1", FieldKey: strptr("title"), Span: 100}}},
	}}
	err := validateDoc(doc, nil, artefactitems.SlotStory, artefactitems.ScopeWork)
	if err == nil {
		t.Fatal("expected validation error for missing mandatory core fields")
	}
	ve, ok := err.(*ValidationError)
	if !ok {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if len(ve.Missing) != 2 {
		t.Fatalf("expected 2 missing fields, got %v", ve.Missing)
	}
}

func TestValidateDoc_AcceptsAllMandatoryPlaced(t *testing.T) {
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template100, Cells: []Cell{{ID: "c1", FieldKey: strptr("title"), Span: 100}}},
		{ID: "r2", Template: Template5050, Cells: []Cell{
			{ID: "c2", FieldKey: strptr("flow_state_name"), Span: 50},
			{ID: "c3", FieldKey: strptr("owner"), Span: 50},
		}},
	}}
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
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template3070, Cells: []Cell{
			{ID: "c1", FieldKey: nil, Span: 30}, // empty slot
			{ID: "c2", FieldKey: strptr("title"), Span: 70},
		}},
		{ID: "r2", Template: Template5050, Cells: []Cell{
			{ID: "c3", FieldKey: strptr("flow_state_name"), Span: 50},
			{ID: "c4", FieldKey: strptr("owner"), Span: 50},
		}},
	}}
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
	doc := LayoutDoc{Rows: []Row{
		{ID: "r1", Template: Template100, Cells: []Cell{{ID: "c1", FieldKey: strptr("title"), Span: 100}}},
		{ID: "r2", Template: Template5050, Cells: []Cell{
			{ID: "c2", FieldKey: strptr("flow_state_name"), Span: 50},
			{ID: "c3", FieldKey: strptr("owner"), Span: 50},
		}},
		{ID: "r3", Template: Template100, Cells: []Cell{{ID: "c4", FieldKey: strptr("defect_severity"), Span: 100}}},
	}}
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
