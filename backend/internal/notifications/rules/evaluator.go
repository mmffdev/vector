package rules

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Evaluator is the write-time matcher. Wire callers (today: future
// artefactitems hook; tomorrow: notes / comments / owner-change-proposed)
// hand it an event; it loads the enabled rules whose (type, target,
// subscription) tuple matches and returns the rules that fire.
//
// CURRENT STATE — STUB:
//   The matching logic in MatchEvent() is intentionally a no-op. It
//   loads the candidate rule set so we exercise the query, logs how
//   many rules would have been considered, and returns an empty
//   slice. The settings UI + CRUD + schema endpoint can be exercised
//   end-to-end against this stub; no notifications actually fire from
//   rules yet.
//
//   Replacing the stub is a single function (matchConditions below)
//   plus the per-operator switch — no caller changes.
//
// CALL SITES (planned, not wired):
//   - artefactitems.Service.Update — emit ArtefactChangedEvent
//   - mentions.Service.Create — already wired to the @-mention surface
//     directly; rules-engine integration for mention-typed rules is
//     future work (when the rule type goes from disabled → enabled).
type Evaluator struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func NewEvaluator(pool *pgxpool.Pool, logger *slog.Logger) *Evaluator {
	if logger == nil {
		logger = slog.Default()
	}
	return &Evaluator{pool: pool, logger: logger}
}

// ArtefactChangedEvent is the shape an artefact writer hands the
// evaluator. Includes before/after snapshots so `changed`-family
// operators have the data they need to fire.
//
// Fields is a map of field_name → {Before, After}. NULL Before means
// "this is a Create"; identical Before+After means "the writer
// touched the row but didn't change this field" (still fires for
// audit-only / write-touch rules in future).
type ArtefactChangedEvent struct {
	SubscriptionID uuid.UUID
	WorkspaceID    uuid.UUID
	ArtefactID     uuid.UUID
	// ArtefactType is the type NAME (e.g. "Defect"), matching the
	// Rule.Target column post mig 237. Producer reads the type name
	// from the artefact_types row, not the UUID.
	ArtefactType string
	AuthorUserID uuid.UUID
	Fields       map[string]FieldChange
}

// FieldChange captures one field's before/after for a single write.
type FieldChange struct {
	Before any
	After  any
}

// MatchEvent returns the rules that fire for this event. Each
// returned rule is one (recipient_user, payload) producer — the
// caller is responsible for fanning out to the notifications outbox
// via its Notifier (the rules package can't import notifications
// without a cycle).
//
// Matching is AND across a rule's conditions; OR across rules (any
// matching rule produces its own notification).
func (e *Evaluator) MatchEvent(ctx context.Context, ev ArtefactChangedEvent) ([]Rule, error) {
	rows, err := e.pool.Query(ctx, sqlSelectActiveRulesForTarget,
		ev.SubscriptionID, ev.WorkspaceID, string(TypeArtefact), ev.ArtefactType,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	candidates := []Rule{}
	for rows.Next() {
		r, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, *r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	matches := make([]Rule, 0, len(candidates))
	for _, r := range candidates {
		if matchConditions(r.Conditions, ev) {
			matches = append(matches, r)
		}
	}
	e.logger.Debug("notifications.rules.evaluator: evaluated",
		"subscription_id", ev.SubscriptionID,
		"workspace_id", ev.WorkspaceID,
		"artefact_type", ev.ArtefactType,
		"artefact_id", ev.ArtefactID,
		"candidates", len(candidates),
		"matches", len(matches),
	)
	return matches, nil
}

// matchConditions evaluates a rule's predicates against one event.
// AND-combined — every condition must hold. Empty conditions = true
// (defensively, but the service validates len>=1 at create time).
func matchConditions(conds []Condition, ev ArtefactChangedEvent) bool {
	for _, c := range conds {
		if !matchOne(c, ev) {
			return false
		}
	}
	return true
}

// matchOne evaluates a single condition. Returns false on any of:
//   - field not present in the event
//   - operator-vs-value-type incompatibility (e.g. > on a string)
//   - the predicate is genuinely false
//
// "WAS" / "WAS_IN" point-in-time operators always return false
// today — they need an artefact-history feed (TD when history lands).
func matchOne(c Condition, ev ArtefactChangedEvent) bool {
	change, present := ev.Fields[c.Field]
	if !present {
		// Field wasn't touched in this event; the rule doesn't fire.
		// "changed" operators rely on the field being present even if
		// before==after; the producer is responsible for including
		// every field the rule cares about, but the safe default for
		// an absent field is no-match.
		return false
	}
	switch c.Operator {
	case OpChanged:
		return !sameValue(change.Before, change.After)
	case OpChangedFrom:
		return sameValue(change.Before, c.Value) && !sameValue(change.Before, change.After)
	case OpChangedTo:
		return sameValue(change.After, c.Value) && !sameValue(change.Before, change.After)
	case OpEquals:
		return sameValue(change.After, c.Value)
	case OpNotEquals:
		return !sameValue(change.After, c.Value)
	case OpContains:
		return containsValue(change.After, c.Value)
	case OpGreaterThan, OpLessThan, OpGTE, OpLTE:
		return compareNumeric(change.After, c.Value, c.Operator)
	case OpWas, OpWasNot, OpWasIn, OpWasNotIn:
		// Point-in-time history operators — need a history feed.
		// Returning false today is the safe default; users see no
		// notifications rather than incorrect ones.
		return false
	}
	return false
}

// sameValue is a loose equality that copes with the any-typed
// JSONB values. Coerces numbers to float64 so int/float comparisons
// behave; everything else falls back to fmt.Sprint to handle the
// long tail (strings, bools, nil).
func sameValue(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	if af, aok := toFloat(a); aok {
		if bf, bok := toFloat(b); bok {
			return af == bf
		}
	}
	if ab, aok := a.(bool); aok {
		if bb, bok := b.(bool); bok {
			return ab == bb
		}
	}
	return fmt.Sprint(a) == fmt.Sprint(b)
}

// containsValue: substring for strings, element-present for slices.
func containsValue(haystack, needle any) bool {
	if hs, ok := haystack.(string); ok {
		if ns, ok := needle.(string); ok {
			return strings.Contains(strings.ToLower(hs), strings.ToLower(ns))
		}
	}
	if hl, ok := haystack.([]any); ok {
		for _, el := range hl {
			if sameValue(el, needle) {
				return true
			}
		}
	}
	return false
}

// compareNumeric returns the result of a vs b under op. Anything
// that doesn't coerce to a number returns false (rule misses safely).
func compareNumeric(a, b any, op Operator) bool {
	af, aok := toFloat(a)
	bf, bok := toFloat(b)
	if !aok || !bok {
		return false
	}
	switch op {
	case OpGreaterThan:
		return af > bf
	case OpLessThan:
		return af < bf
	case OpGTE:
		return af >= bf
	case OpLTE:
		return af <= bf
	}
	return false
}

// toFloat coerces a JSON value to float64 for numeric comparison.
// Handles float64 (the JSON default), json.Number, int variants,
// and strings that look like numbers.
func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case string:
		// Strings can carry numeric values when the UI binds an int
		// field to a text input (numeric input always serialises as
		// number, but defensive).
		var f float64
		if _, err := fmt.Sscanf(x, "%g", &f); err == nil {
			return f, true
		}
	}
	return 0, false
}

// RuleHook is the surface artefactitems (and future producers) use
// to fire the engine on a write. Keeps the rules package out of any
// import cycle — artefactitems imports rules and notifications
// directly, but rules never imports notifications or artefactitems.
//
// Implementation lives in the caller (a small adapter in main.go's
// wire-up that holds both the Evaluator and the Notifier).
type RuleHook interface {
	OnArtefactChanged(ctx context.Context, ev ArtefactChangedEvent)
}
