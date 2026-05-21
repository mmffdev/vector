package artefactitems

import (
	"testing"

	"github.com/mmffdev/vector-backend/internal/notifications/rules"
)

// Pin the type-routing contract between custom-field writes and the
// notification-rules evaluator. The producer (UpsertFieldValue /
// DeleteFieldValue) builds ArtefactChangedEvent.Fields[name] from
// the four nullable value columns; the matcher reads it via
// sameValue / containsValue / compareNumeric. If pickFieldValue ever
// drifts from those expectations, rules silently stop firing — exactly
// the failure mode the `is_blocked`→`blocked` fix in a695e5b caught.
//
// Unit tests; no DB.

func sp(s string) *string { return &s }

func TestPickFieldValue_NumericCoercesToFloat(t *testing.T) {
	got := pickFieldValue("integer", nil, sp("42"), nil, nil)
	f, ok := got.(float64)
	if !ok || f != 42 {
		t.Fatalf("integer: want float64(42), got %T(%v)", got, got)
	}
	got = pickFieldValue("decimal", nil, sp("3.14"), nil, nil)
	f, ok = got.(float64)
	if !ok || f != 3.14 {
		t.Fatalf("decimal: want float64(3.14), got %T(%v)", got, got)
	}
}

func TestPickFieldValue_BooleanCoercesToBool(t *testing.T) {
	if got := pickFieldValue("boolean", sp("true"), nil, nil, nil); got != true {
		t.Fatalf("boolean true: want bool(true), got %T(%v)", got, got)
	}
	if got := pickFieldValue("boolean", sp("false"), nil, nil, nil); got != false {
		t.Fatalf("boolean false: want bool(false), got %T(%v)", got, got)
	}
	if got := pickFieldValue("boolean", sp(""), nil, nil, nil); got != nil {
		t.Fatalf("boolean empty: want nil, got %T(%v)", got, got)
	}
}

func TestPickFieldValue_DateAsString(t *testing.T) {
	if got := pickFieldValue("date", nil, nil, nil, sp("2026-05-21")); got != "2026-05-21" {
		t.Fatalf("date: want string(2026-05-21), got %T(%v)", got, got)
	}
}

func TestPickFieldValue_TextboxAndRichtext(t *testing.T) {
	// Textbox lives in string_value (matches WorkItemDetailPanel +
	// sqlListFieldValuesForArtefact); only richtext uses text_value.
	if got := pickFieldValue("textbox", sp("hi"), nil, nil, nil); got != "hi" {
		t.Fatalf("textbox: want string(hi), got %T(%v)", got, got)
	}
	if got := pickFieldValue("textbox", nil, nil, sp("ignored"), nil); got != nil {
		t.Fatalf("textbox text_value column should be ignored: got %T(%v)", got, got)
	}
	if got := pickFieldValue("richtext", nil, nil, sp("<p>hi</p>"), nil); got != "<p>hi</p>" {
		t.Fatalf("richtext: want string(<p>hi</p>), got %T(%v)", got, got)
	}
}

func TestPickFieldValue_SelectAndUser(t *testing.T) {
	uid := "ec2a5e3e-7c4f-4f4c-9e9b-1a4f8d5b8c91"
	if got := pickFieldValue("select", sp(uid), nil, nil, nil); got != uid {
		t.Fatalf("select: want string(uid), got %T(%v)", got, got)
	}
	if got := pickFieldValue("user", sp(uid), nil, nil, nil); got != uid {
		t.Fatalf("user: want string(uid), got %T(%v)", got, got)
	}
}

func TestPickFieldValue_MultiselectParsesJSONArray(t *testing.T) {
	got := pickFieldValue("multiselect", sp(`["urgent","ux"]`), nil, nil, nil)
	arr, ok := got.([]any)
	if !ok {
		t.Fatalf("multiselect JSON: want []any, got %T(%v)", got, got)
	}
	if len(arr) != 2 || arr[0] != "urgent" || arr[1] != "ux" {
		t.Fatalf("multiselect JSON: want [urgent ux], got %v", arr)
	}
}

func TestPickFieldValue_MultiselectMalformedFallsBackToRaw(t *testing.T) {
	got := pickFieldValue("multiselect", sp("not-json"), nil, nil, nil)
	if got != "not-json" {
		t.Fatalf("multiselect raw fallback: want string(not-json), got %T(%v)", got, got)
	}
}

func TestPickFieldValue_MultiselectEmptyIsNil(t *testing.T) {
	if got := pickFieldValue("multiselect", sp(""), nil, nil, nil); got != nil {
		t.Fatalf("multiselect empty: want nil, got %T(%v)", got, got)
	}
	if got := pickFieldValue("multiselect", nil, nil, nil, nil); got != nil {
		t.Fatalf("multiselect unset: want nil, got %T(%v)", got, got)
	}
}

func TestPickFieldValue_NilWhenColumnUnset(t *testing.T) {
	if got := pickFieldValue("integer", nil, nil, nil, nil); got != nil {
		t.Fatalf("integer unset: want nil, got %T(%v)", got, got)
	}
	if got := pickFieldValue("textbox", nil, nil, nil, nil); got != nil {
		t.Fatalf("textbox unset: want nil, got %T(%v)", got, got)
	}
}

func TestFieldChangeIsNoop(t *testing.T) {
	cases := []struct {
		name string
		c    rules.FieldChange
		want bool
	}{
		{"both nil", rules.FieldChange{Before: nil, After: nil}, true},
		{"nil → value", rules.FieldChange{Before: nil, After: "x"}, false},
		{"value → nil", rules.FieldChange{Before: "x", After: nil}, false},
		{"same string", rules.FieldChange{Before: "x", After: "x"}, true},
		{"diff string", rules.FieldChange{Before: "x", After: "y"}, false},
		{"same float", rules.FieldChange{Before: 3.14, After: 3.14}, true},
		{"diff float", rules.FieldChange{Before: 3.14, After: 2.71}, false},
		{"same bool", rules.FieldChange{Before: true, After: true}, true},
		{"diff bool", rules.FieldChange{Before: true, After: false}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := fieldChangeIsNoop(tc.c); got != tc.want {
				t.Fatalf("want %v, got %v", tc.want, got)
			}
		})
	}
}
