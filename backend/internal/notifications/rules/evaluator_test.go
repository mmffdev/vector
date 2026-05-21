package rules

// B11.4 — evaluator unit tests. Table-driven coverage of the
// per-operator matcher (matchOne / matchConditions / coercion
// helpers). No DB required — these are pure-function tests on
// the matcher, exactly the layer that's cheapest to pin and most
// prone to silent regressions when the operator vocabulary grows.
//
// Run:
//
//	go test ./internal/notifications/rules/...
//
// Tracker group: backend-platform (Go feature suite).

import (
	"testing"

	"github.com/google/uuid"
)

// mkEvent builds a one-field ArtefactChangedEvent — keeps the table
// rows compact. Multi-field cases use mkEventFields below.
func mkEvent(field string, before, after any) ArtefactChangedEvent {
	return ArtefactChangedEvent{
		SubscriptionID: uuid.Nil,
		WorkspaceID:    uuid.Nil,
		ArtefactID:     uuid.Nil,
		ArtefactType:   "Defect",
		Fields:         map[string]FieldChange{field: {Before: before, After: after}},
	}
}

func mkEventFields(m map[string]FieldChange) ArtefactChangedEvent {
	return ArtefactChangedEvent{
		SubscriptionID: uuid.Nil,
		WorkspaceID:    uuid.Nil,
		ArtefactID:     uuid.Nil,
		ArtefactType:   "Defect",
		Fields:         m,
	}
}

func TestMatchOne_Equals(t *testing.T) {
	cases := []struct {
		name string
		ev   ArtefactChangedEvent
		cond Condition
		want bool
	}{
		{
			"string equal",
			mkEvent("status", "open", "closed"),
			Condition{Field: "status", Operator: OpEquals, Value: "closed"},
			true,
		},
		{
			"string not equal",
			mkEvent("status", "open", "closed"),
			Condition{Field: "status", Operator: OpEquals, Value: "open"},
			false,
		},
		{
			"int equals via coercion",
			mkEvent("estimate", 5, 8),
			Condition{Field: "estimate", Operator: OpEquals, Value: float64(8)},
			true,
		},
		{
			"int → string equals coerces both sides numerically",
			mkEvent("estimate", 5, 8),
			Condition{Field: "estimate", Operator: OpEquals, Value: "8"},
			true,
		},
		{
			"bool equal",
			mkEvent("is_blocked", false, true),
			Condition{Field: "is_blocked", Operator: OpEquals, Value: true},
			true,
		},
		{
			"field absent — no match",
			mkEvent("status", "x", "y"),
			Condition{Field: "missing", Operator: OpEquals, Value: "x"},
			false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchOne(tc.cond, tc.ev); got != tc.want {
				t.Errorf("matchOne(=) = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMatchOne_NotEquals(t *testing.T) {
	cases := []struct {
		name string
		ev   ArtefactChangedEvent
		cond Condition
		want bool
	}{
		{"after differs from value", mkEvent("status", "x", "y"), Condition{Field: "status", Operator: OpNotEquals, Value: "x"}, true},
		{"after equals value (negated false)", mkEvent("status", "y", "x"), Condition{Field: "status", Operator: OpNotEquals, Value: "x"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchOne(tc.cond, tc.ev); got != tc.want {
				t.Errorf("matchOne(!=) = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMatchOne_Contains(t *testing.T) {
	cases := []struct {
		name string
		ev   ArtefactChangedEvent
		cond Condition
		want bool
	}{
		{"substring case-insensitive", mkEvent("title", "old", "Login Fails on Safari"), Condition{Field: "title", Operator: OpContains, Value: "fails"}, true},
		{"substring missing", mkEvent("title", "x", "Login works"), Condition{Field: "title", Operator: OpContains, Value: "fails"}, false},
		{"multiselect element-present", mkEvent("labels", nil, []any{"urgent", "ux"}), Condition{Field: "labels", Operator: OpContains, Value: "urgent"}, true},
		{"multiselect element-absent", mkEvent("labels", nil, []any{"a", "b"}), Condition{Field: "labels", Operator: OpContains, Value: "urgent"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchOne(tc.cond, tc.ev); got != tc.want {
				t.Errorf("matchOne(contains) = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMatchOne_Numeric(t *testing.T) {
	cases := []struct {
		name string
		ev   ArtefactChangedEvent
		cond Condition
		want bool
	}{
		{">  true", mkEvent("estimate", 3, 9), Condition{Field: "estimate", Operator: OpGreaterThan, Value: float64(8)}, true},
		{">  false", mkEvent("estimate", 3, 5), Condition{Field: "estimate", Operator: OpGreaterThan, Value: float64(8)}, false},
		{">  equal counts as not-greater", mkEvent("estimate", 3, 8), Condition{Field: "estimate", Operator: OpGreaterThan, Value: float64(8)}, false},
		{"<  true", mkEvent("estimate", 9, 3), Condition{Field: "estimate", Operator: OpLessThan, Value: float64(5)}, true},
		{"<= true on equal", mkEvent("estimate", 3, 5), Condition{Field: "estimate", Operator: OpLTE, Value: float64(5)}, true},
		{">= true on equal", mkEvent("estimate", 3, 5), Condition{Field: "estimate", Operator: OpGTE, Value: float64(5)}, true},
		{"non-numeric after misses safely", mkEvent("title", "a", "b"), Condition{Field: "title", Operator: OpGreaterThan, Value: float64(0)}, false},
		{"int vs float coerce", mkEvent("estimate", 0, int64(10)), Condition{Field: "estimate", Operator: OpGreaterThan, Value: float64(8)}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchOne(tc.cond, tc.ev); got != tc.want {
				t.Errorf("matchOne(numeric) = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMatchOne_Changed(t *testing.T) {
	cases := []struct {
		name string
		ev   ArtefactChangedEvent
		cond Condition
		want bool
	}{
		{"changed: before != after", mkEvent("status", "open", "closed"), Condition{Field: "status", Operator: OpChanged}, true},
		{"changed: before == after — no change", mkEvent("status", "open", "open"), Condition{Field: "status", Operator: OpChanged}, false},
		{"changed: nil → value (create case)", mkEvent("status", nil, "open"), Condition{Field: "status", Operator: OpChanged}, true},
		{"changed: value → nil (clear)", mkEvent("sprint_id", "abc", nil), Condition{Field: "sprint_id", Operator: OpChanged}, true},
		{"changed: nil → nil", mkEvent("sprint_id", nil, nil), Condition{Field: "sprint_id", Operator: OpChanged}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchOne(tc.cond, tc.ev); got != tc.want {
				t.Errorf("matchOne(changed) = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMatchOne_ChangedFromTo(t *testing.T) {
	cases := []struct {
		name string
		ev   ArtefactChangedEvent
		cond Condition
		want bool
	}{
		{"changed_to matches after + before differs", mkEvent("status", "open", "closed"), Condition{Field: "status", Operator: OpChangedTo, Value: "closed"}, true},
		{"changed_to matches after but no change — false", mkEvent("status", "closed", "closed"), Condition{Field: "status", Operator: OpChangedTo, Value: "closed"}, false},
		{"changed_to value mismatch", mkEvent("status", "open", "closed"), Condition{Field: "status", Operator: OpChangedTo, Value: "deferred"}, false},
		{"changed_from matches before + change happened", mkEvent("status", "open", "closed"), Condition{Field: "status", Operator: OpChangedFrom, Value: "open"}, true},
		{"changed_from before mismatch", mkEvent("status", "in_progress", "closed"), Condition{Field: "status", Operator: OpChangedFrom, Value: "open"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchOne(tc.cond, tc.ev); got != tc.want {
				t.Errorf("matchOne(changed_from/to) = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMatchOne_WasFamilyAlwaysFalse(t *testing.T) {
	// History-dependent operators always return false today — they
	// need the artefact-history feed. Pinned so future-Claude
	// remembers to flip this test when wiring history.
	ops := []Operator{OpWas, OpWasNot, OpWasIn, OpWasNotIn}
	for _, op := range ops {
		t.Run(string(op), func(t *testing.T) {
			ev := mkEvent("status", "x", "y")
			got := matchOne(Condition{Field: "status", Operator: op, Value: "y"}, ev)
			if got != false {
				t.Errorf("matchOne(%s) = %v, want false (history feed not wired)", op, got)
			}
		})
	}
}

func TestMatchConditions_ANDCombines(t *testing.T) {
	ev := mkEventFields(map[string]FieldChange{
		"status":      {Before: "open", After: "closed"},
		"is_blocked":  {Before: true, After: false},
		"estimate":    {Before: 3, After: 9},
	})
	cases := []struct {
		name  string
		conds []Condition
		want  bool
	}{
		{
			"all three match",
			[]Condition{
				{Field: "status", Operator: OpEquals, Value: "closed"},
				{Field: "is_blocked", Operator: OpEquals, Value: false},
				{Field: "estimate", Operator: OpGreaterThan, Value: float64(5)},
			},
			true,
		},
		{
			"two match one fails — AND blocks",
			[]Condition{
				{Field: "status", Operator: OpEquals, Value: "closed"},
				{Field: "is_blocked", Operator: OpEquals, Value: true},
				{Field: "estimate", Operator: OpGreaterThan, Value: float64(5)},
			},
			false,
		},
		{
			"empty conditions match — defensive default",
			nil,
			true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchConditions(tc.conds, ev); got != tc.want {
				t.Errorf("matchConditions = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSameValue_CrossTypeNumericCoercion(t *testing.T) {
	cases := []struct {
		a, b any
		want bool
	}{
		{int(5), float64(5), true},
		{int64(5), float64(5), true},
		{float32(5), float64(5), true},
		{"hello", "hello", true},
		{"hello", "Hello", false}, // case-sensitive for non-numeric
		{nil, nil, true},
		{nil, "x", false},
		{"x", nil, false},
		{true, true, true},
		{true, false, false},
	}
	for _, tc := range cases {
		got := sameValue(tc.a, tc.b)
		if got != tc.want {
			t.Errorf("sameValue(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestToFloat_HandlesAllNumericTypes(t *testing.T) {
	cases := []struct {
		v       any
		want    float64
		wantOk  bool
	}{
		{float64(3.14), 3.14, true},
		{float32(3.14), 3.140000104904175, true}, // float32 precision
		{int(42), 42, true},
		{int32(42), 42, true},
		{int64(42), 42, true},
		{"42", 42, true},
		{"3.14", 3.14, true},
		{"notanumber", 0, false},
		{true, 0, false},
		{nil, 0, false},
	}
	for _, tc := range cases {
		got, ok := toFloat(tc.v)
		if ok != tc.wantOk {
			t.Errorf("toFloat(%v): ok = %v, want %v", tc.v, ok, tc.wantOk)
			continue
		}
		// Float comparison: tolerate the float32 precision drift.
		if ok {
			if _, isF32 := tc.v.(float32); isF32 {
				if got < tc.want-0.0001 || got > tc.want+0.0001 {
					t.Errorf("toFloat(float32) = %v, want ~%v", got, tc.want)
				}
				continue
			}
			if got != tc.want {
				t.Errorf("toFloat(%v) = %v, want %v", tc.v, got, tc.want)
			}
		}
	}
}
