package rules

import (
	"testing"
)

// makeData is a helper that builds a test data map.
func makeData(key string, val any) map[string]any {
	return map[string]any{key: val}
}

func TestEvalCondition(t *testing.T) {
	tests := []struct {
		name      string
		data      map[string]any
		cond      Condition
		wantMatch bool
		wantErr   bool
	}{
		// ── eq ──────────────────────────────────────────────────────────────
		{
			name:      "eq: string match",
			data:      makeData("status", "active"),
			cond:      Condition{Field: "status", Operator: OperatorEq, Value: "active"},
			wantMatch: true,
		},
		{
			name:      "eq: string no-match",
			data:      makeData("status", "active"),
			cond:      Condition{Field: "status", Operator: OperatorEq, Value: "inactive"},
			wantMatch: false,
		},
		{
			name:      "eq: type mismatch string vs float",
			data:      makeData("count", "1"),
			cond:      Condition{Field: "count", Operator: OperatorEq, Value: float64(1)},
			wantMatch: false,
		},
		{
			name:      "eq: float match",
			data:      makeData("score", float64(42)),
			cond:      Condition{Field: "score", Operator: OperatorEq, Value: float64(42)},
			wantMatch: true,
		},
		{
			name:      "eq: missing field vs nil value",
			data:      map[string]any{},
			cond:      Condition{Field: "missing", Operator: OperatorEq, Value: nil},
			wantMatch: true, // both nil
		},

		// ── neq ─────────────────────────────────────────────────────────────
		{
			name:      "neq: values differ",
			data:      makeData("role", "user"),
			cond:      Condition{Field: "role", Operator: OperatorNeq, Value: "gadmin"},
			wantMatch: true,
		},
		{
			name:      "neq: values equal",
			data:      makeData("role", "gadmin"),
			cond:      Condition{Field: "role", Operator: OperatorNeq, Value: "gadmin"},
			wantMatch: false,
		},
		{
			name:      "neq: type mismatch is not-equal",
			data:      makeData("n", float64(1)),
			cond:      Condition{Field: "n", Operator: OperatorNeq, Value: "1"},
			wantMatch: true,
		},

		// ── gte ─────────────────────────────────────────────────────────────
		{
			name:      "gte: float above threshold",
			data:      makeData("score", float64(10)),
			cond:      Condition{Field: "score", Operator: OperatorGte, Value: float64(5)},
			wantMatch: true,
		},
		{
			name:      "gte: float equal threshold",
			data:      makeData("score", float64(5)),
			cond:      Condition{Field: "score", Operator: OperatorGte, Value: float64(5)},
			wantMatch: true,
		},
		{
			name:      "gte: float below threshold",
			data:      makeData("score", float64(3)),
			cond:      Condition{Field: "score", Operator: OperatorGte, Value: float64(5)},
			wantMatch: false,
		},
		{
			name:      "gte: type mismatch returns false (not error)",
			data:      makeData("score", "ten"),
			cond:      Condition{Field: "score", Operator: OperatorGte, Value: float64(5)},
			wantMatch: false,
		},
		{
			name:      "gte: string lex order",
			data:      makeData("name", "beta"),
			cond:      Condition{Field: "name", Operator: OperatorGte, Value: "alpha"},
			wantMatch: true,
		},

		// ── lte ─────────────────────────────────────────────────────────────
		{
			name:      "lte: float below threshold",
			data:      makeData("score", float64(3)),
			cond:      Condition{Field: "score", Operator: OperatorLte, Value: float64(5)},
			wantMatch: true,
		},
		{
			name:      "lte: float equal threshold",
			data:      makeData("score", float64(5)),
			cond:      Condition{Field: "score", Operator: OperatorLte, Value: float64(5)},
			wantMatch: true,
		},
		{
			name:      "lte: float above threshold",
			data:      makeData("score", float64(10)),
			cond:      Condition{Field: "score", Operator: OperatorLte, Value: float64(5)},
			wantMatch: false,
		},
		{
			name:      "lte: type mismatch returns false (not error)",
			data:      makeData("score", true),
			cond:      Condition{Field: "score", Operator: OperatorLte, Value: float64(5)},
			wantMatch: false,
		},

		// ── in ──────────────────────────────────────────────────────────────
		{
			name:      "in: value in list",
			data:      makeData("tier", "premium"),
			cond:      Condition{Field: "tier", Operator: OperatorIn, Value: []any{"free", "premium", "enterprise"}},
			wantMatch: true,
		},
		{
			name:      "in: value not in list",
			data:      makeData("tier", "trial"),
			cond:      Condition{Field: "tier", Operator: OperatorIn, Value: []any{"free", "premium"}},
			wantMatch: false,
		},
		{
			name:    "in: value is not a list",
			data:    makeData("tier", "premium"),
			cond:    Condition{Field: "tier", Operator: OperatorIn, Value: "premium"},
			wantErr: true,
		},
		{
			name:      "in: missing field not in list",
			data:      map[string]any{},
			cond:      Condition{Field: "missing", Operator: OperatorIn, Value: []any{"a", "b"}},
			wantMatch: false,
		},

		// ── contains ────────────────────────────────────────────────────────
		{
			name:      "contains: substring present",
			data:      makeData("title", "critical security incident"),
			cond:      Condition{Field: "title", Operator: OperatorContains, Value: "security"},
			wantMatch: true,
		},
		{
			name:      "contains: substring absent",
			data:      makeData("title", "routine update"),
			cond:      Condition{Field: "title", Operator: OperatorContains, Value: "security"},
			wantMatch: false,
		},
		{
			name:    "contains: field is not a string",
			data:    makeData("count", float64(42)),
			cond:    Condition{Field: "count", Operator: OperatorContains, Value: "4"},
			wantErr: true,
		},
		{
			name:    "contains: value is not a string",
			data:    makeData("title", "hello world"),
			cond:    Condition{Field: "title", Operator: OperatorContains, Value: float64(1)},
			wantErr: true,
		},

		// ── exists ──────────────────────────────────────────────────────────
		{
			name:      "exists: key present",
			data:      makeData("actor", "someone"),
			cond:      Condition{Field: "actor", Operator: OperatorExists},
			wantMatch: true,
		},
		{
			name:      "exists: key present with nil value",
			data:      makeData("actor", nil),
			cond:      Condition{Field: "actor", Operator: OperatorExists},
			wantMatch: true, // key exists even though value is nil
		},
		{
			name:      "exists: key absent",
			data:      map[string]any{},
			cond:      Condition{Field: "actor", Operator: OperatorExists},
			wantMatch: false,
		},
		{
			name:      "exists: nested key present",
			data:      map[string]any{"item": map[string]any{"id": "abc"}},
			cond:      Condition{Field: "item.id", Operator: OperatorExists},
			wantMatch: true,
		},

		// ── not_exists ──────────────────────────────────────────────────────
		{
			name:      "not_exists: key absent",
			data:      map[string]any{},
			cond:      Condition{Field: "actor", Operator: OperatorNotExists},
			wantMatch: true,
		},
		{
			name:      "not_exists: key present",
			data:      makeData("actor", "someone"),
			cond:      Condition{Field: "actor", Operator: OperatorNotExists},
			wantMatch: false,
		},
		{
			name:      "not_exists: key present with nil value is still present",
			data:      makeData("actor", nil),
			cond:      Condition{Field: "actor", Operator: OperatorNotExists},
			wantMatch: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			match, err := evalCondition(tc.data, tc.cond)
			if tc.wantErr {
				if err == nil {
					t.Errorf("evalCondition: expected error, got nil (match=%v)", match)
				}
				return
			}
			if err != nil {
				t.Errorf("evalCondition: unexpected error: %v", err)
				return
			}
			if match != tc.wantMatch {
				t.Errorf("evalCondition: got match=%v, want %v", match, tc.wantMatch)
			}
		})
	}
}
