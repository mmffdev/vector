package rules

import (
	"context"
	"log/slog"

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
	ArtefactID     uuid.UUID
	ArtefactType   string // artefact_type id (matches Rule.Target)
	AuthorUserID   uuid.UUID
	Fields         map[string]FieldChange
}

// FieldChange captures one field's before/after for a single write.
type FieldChange struct {
	Before any
	After  any
}

// MatchEvent returns the rules that would fire for this event.
//
// Today: returns nil after loading the candidate set + logging. The
// fan-out into the notifications outbox is the caller's job —
// keeping that boundary in the caller means the rule engine doesn't
// import the Notifier interface (no circular dep).
func (e *Evaluator) MatchEvent(ctx context.Context, ev ArtefactChangedEvent) ([]Rule, error) {
	rows, err := e.pool.Query(ctx, sqlSelectActiveRulesForTarget,
		ev.SubscriptionID, string(TypeArtefact), ev.ArtefactType,
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

	// STUB — see package doc. Real matching swaps this loop for one
	// that calls matchConditions(rule.Conditions, ev).
	e.logger.Debug("notifications.rules.evaluator: would evaluate",
		"subscription_id", ev.SubscriptionID,
		"artefact_type", ev.ArtefactType,
		"artefact_id", ev.ArtefactID,
		"candidates", len(candidates),
		"impl", "stub",
	)
	return nil, nil
}
