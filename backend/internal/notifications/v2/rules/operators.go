package rules

import (
	"fmt"
	"strings"
)

// evalCondition evaluates a single Condition against the value resolved
// from data via cond.Field using resolvePath.
//
// Returns (true, nil) on match, (false, nil) on no-match, and
// (false, error) on a type-mismatch or unrecognised operator.
//
// Operator semantics:
//
//	eq          — deep equality between field value and cond.Value.
//	              Both nil → true. Type-sensitive: "1" != 1.
//	neq         — logical inverse of eq.
//	gte         — numeric (float64) or string lexicographic >=.
//	              Returns false (not an error) on type mismatch.
//	lte         — numeric (float64) or string lexicographic <=.
//	in          — field value is contained in cond.Value ([]any).
//	              Uses eq semantics for each element comparison.
//	contains    — both field value and cond.Value must be strings;
//	              returns true iff field contains cond.Value as substring.
//	exists      — field path is present in data and resolves to any value
//	              (including nil — the key must exist).
//	not_exists  — field path is absent (key does not exist in data).
func evalCondition(data map[string]any, cond Condition) (bool, error) {
	switch cond.Operator {
	case OperatorExists:
		_, found := resolvePath(data, cond.Field)
		return found, nil

	case OperatorNotExists:
		_, found := resolvePath(data, cond.Field)
		return !found, nil
	}

	// All remaining operators need a resolved field value.
	fieldVal, found := resolvePath(data, cond.Field)

	switch cond.Operator {
	case OperatorEq:
		return opEq(fieldVal, cond.Value), nil

	case OperatorNeq:
		return !opEq(fieldVal, cond.Value), nil

	case OperatorGte:
		return opGte(fieldVal, cond.Value), nil

	case OperatorLte:
		return opLte(fieldVal, cond.Value), nil

	case OperatorIn:
		return opIn(fieldVal, found, cond.Value)

	case OperatorContains:
		return opContains(fieldVal, found, cond.Value)

	default:
		return false, fmt.Errorf("%w: %q", ErrInvalidOperator, cond.Operator)
	}
}

// ── operator helpers ─────────────────────────────────────────────────────────

// opEq returns true iff a and b are deeply equal.
// Type-sensitive: string "1" does NOT equal float64(1).
// Both nil → true.
func opEq(a, b any) bool {
	return fmt.Sprintf("%T:%v", a, a) == fmt.Sprintf("%T:%v", b, b)
}

// opGte returns true iff a >= b.
// Compares float64 numerically; falls back to string lexicographic order.
// Returns false on type mismatch (not an error).
func opGte(a, b any) bool {
	switch av := a.(type) {
	case float64:
		bv, ok := b.(float64)
		if !ok {
			return false
		}
		return av >= bv
	case string:
		bv, ok := b.(string)
		if !ok {
			return false
		}
		return av >= bv
	}
	return false
}

// opLte returns true iff a <= b.
// Mirrors opGte semantics.
func opLte(a, b any) bool {
	switch av := a.(type) {
	case float64:
		bv, ok := b.(float64)
		if !ok {
			return false
		}
		return av <= bv
	case string:
		bv, ok := b.(string)
		if !ok {
			return false
		}
		return av <= bv
	}
	return false
}

// opIn returns true iff fieldVal appears in condValue (which must be []any).
// Returns (false, error) if condValue is not []any or if the field was not found.
func opIn(fieldVal any, found bool, condValue any) (bool, error) {
	list, ok := condValue.([]any)
	if !ok {
		return false, fmt.Errorf("rules: operator 'in' requires value to be a JSON array, got %T", condValue)
	}
	if !found {
		return false, nil
	}
	for _, item := range list {
		if opEq(fieldVal, item) {
			return true, nil
		}
	}
	return false, nil
}

// opContains returns true iff the field value (string) contains condValue (string)
// as a substring.
// Returns (false, error) on type mismatch.
func opContains(fieldVal any, found bool, condValue any) (bool, error) {
	if !found {
		return false, nil
	}
	s, ok := fieldVal.(string)
	if !ok {
		return false, fmt.Errorf("rules: operator 'contains' requires string field, got %T", fieldVal)
	}
	sub, ok := condValue.(string)
	if !ok {
		return false, fmt.Errorf("rules: operator 'contains' requires string value, got %T", condValue)
	}
	return strings.Contains(s, sub), nil
}
