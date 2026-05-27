package rules

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// Evaluator tests a domain.Event against the active rules in the DB and
// returns every rule that matches the event.
//
// Callers (the broadcast pipeline filter step) receive the matching rules
// and use them to override channels, priority, template, or schedule.
type Evaluator interface {
	// MatchEvent loads all enabled rules for e.Type in e.SubscriptionID and
	// evaluates each rule's conditions against e.Data. Returns the slice of
	// rules whose conditions (combined via the rule's LogicalOp) all match.
	//
	// A rule with zero conditions evaluates to:
	//   - LogicalOpAND → true  (vacuous truth — no conditions = always match)
	//   - LogicalOpOR  → false (vacuous falsity — no conditions = never match)
	//
	// Returns an empty (non-nil) slice when no rules match.
	// Returns an error only on DB failure or JSON decode failure.
	MatchEvent(ctx context.Context, e domain.Event) ([]Rule, error)
}

// pgEvaluator is the Postgres implementation of Evaluator.
type pgEvaluator struct {
	pool *pgxpool.Pool
}

// NewEvaluator creates an Evaluator backed by the given pool.
// The pool must target the vector_artefacts database.
func NewEvaluator(pool *pgxpool.Pool) Evaluator {
	return &pgEvaluator{pool: pool}
}

// MatchEvent loads enabled rules for the event's subscription + event type,
// then evaluates each rule's conditions against the event data.
//
// Vacuous-truth semantics are documented on the Evaluator interface.
func (ev *pgEvaluator) MatchEvent(ctx context.Context, e domain.Event) ([]Rule, error) {
	if e.SubscriptionID == nil {
		// Platform events (FanoutPlatform) have no subscription scope.
		// Rules are subscription-scoped; no subscription = no applicable rules.
		return []Rule{}, nil
	}

	const q = `
		SELECT
			notifications_rules_v2_id,
			notifications_rules_v2_id_subscription,
			notifications_rules_v2_id_workspace,
			notifications_rules_v2_id_user,
			notifications_rules_v2_name,
			notifications_rules_v2_event_type,
			notifications_rules_v2_logical_op,
			notifications_rules_v2_conditions,
			notifications_rules_v2_channels,
			notifications_rules_v2_priority_override,
			notifications_rules_v2_template_override_id,
			notifications_rules_v2_schedule,
			notifications_rules_v2_enabled,
			notifications_rules_v2_created_at,
			notifications_rules_v2_updated_at
		FROM notifications_rules_v2
		WHERE notifications_rules_v2_id_subscription = $1
		  AND notifications_rules_v2_event_type      = $2
		  AND notifications_rules_v2_enabled         = true
		ORDER BY notifications_rules_v2_created_at ASC`

	rows, err := ev.pool.Query(ctx, q, *e.SubscriptionID, e.Type.String())
	if err != nil {
		return nil, fmt.Errorf("rules.Evaluator.MatchEvent: query: %w", err)
	}
	defer rows.Close()

	var matched []Rule

	for rows.Next() {
		r, err := scanRule(rows)
		if err != nil {
			return nil, fmt.Errorf("rules.Evaluator.MatchEvent: scan: %w", err)
		}

		ok, err := matchConditions(e.Data, r.LogicalOp, r.Conditions)
		if err != nil {
			return nil, fmt.Errorf("rules.Evaluator.MatchEvent: evaluate conditions for rule %s: %w", r.ID, err)
		}
		if ok {
			matched = append(matched, r)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rules.Evaluator.MatchEvent: rows iteration: %w", err)
	}

	if matched == nil {
		matched = []Rule{}
	}
	return matched, nil
}

// matchConditions evaluates all conditions against data using logicalOp.
//
// Vacuous-truth semantics:
//   - AND with zero conditions → true  (no conditions = always match)
//   - OR  with zero conditions → false (no conditions = never match)
func matchConditions(data map[string]any, op LogicalOp, conditions []Condition) (bool, error) {
	if len(conditions) == 0 {
		return op == LogicalOpAND, nil
	}

	for _, cond := range conditions {
		match, err := evalCondition(data, cond)
		if err != nil {
			return false, err
		}

		switch op {
		case LogicalOpAND:
			// Short-circuit: first false → whole expression is false.
			if !match {
				return false, nil
			}
		case LogicalOpOR:
			// Short-circuit: first true → whole expression is true.
			if match {
				return true, nil
			}
		}
	}

	// For AND: all conditions matched.
	// For OR: no condition matched.
	return op == LogicalOpAND, nil
}

// ── row scanner ──────────────────────────────────────────────────────────────

// pgxScanner is satisfied by pgx.Rows and pgx.Row.
type pgxScanner interface {
	Scan(dest ...any) error
}

// scanRule scans a notifications_rules_v2 row into a Rule.
// conditionsJSON and channelsJSON are decoded from JSONB bytes.
func scanRule(row pgxScanner) (Rule, error) {
	var (
		r              Rule
		conditionsJSON []byte
		channelsJSON   []byte
		prioOverride   *string
	)

	err := row.Scan(
		&r.ID,
		&r.SubscriptionID,
		&r.WorkspaceID,
		&r.UserID,
		&r.Name,
		&r.EventType,
		&r.LogicalOp,
		&conditionsJSON,
		&channelsJSON,
		&prioOverride,
		&r.TemplateOverrideID,
		&r.Schedule,
		&r.Enabled,
		&r.CreatedAt,
		&r.UpdatedAt,
	)
	if err != nil {
		return Rule{}, err
	}

	if err := json.Unmarshal(conditionsJSON, &r.Conditions); err != nil {
		return Rule{}, fmt.Errorf("decode conditions: %w", err)
	}

	var rawChannels []string
	if err := json.Unmarshal(channelsJSON, &rawChannels); err != nil {
		return Rule{}, fmt.Errorf("decode channels: %w", err)
	}
	for _, ch := range rawChannels {
		r.Channels = append(r.Channels, domain.Channel(ch))
	}

	if prioOverride != nil {
		p := domain.Priority(*prioOverride)
		r.PriorityOverride = &p
	}

	return r, nil
}
