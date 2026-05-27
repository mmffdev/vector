package rules

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the CRUD surface over notifications_rules_v2.
// All SQL in this package follows the column naming rule:
// every column is prefixed with the full table name (notifications_rules_v2_*).
type Service interface {
	// Create inserts a new rule. Returns the created Rule on success.
	Create(ctx context.Context, input CreateInput) (Rule, error)

	// Get returns the rule for the given ID, or ErrRuleNotFound.
	Get(ctx context.Context, id uuid.UUID) (Rule, error)

	// Update applies partial updates to an existing rule and returns the
	// updated Rule. Returns ErrRuleNotFound when id does not exist.
	Update(ctx context.Context, id uuid.UUID, input UpdateInput) (Rule, error)

	// Delete removes the rule. Returns ErrRuleNotFound when id does not exist.
	Delete(ctx context.Context, id uuid.UUID) error

	// List returns rules matching the filter. The subscription in the filter
	// is required. Returns an empty (non-nil) slice when no rules match.
	List(ctx context.Context, filter ListFilter) ([]Rule, error)
}

// pgService is the Postgres implementation of Service.
type pgService struct {
	pool *pgxpool.Pool
}

// NewService creates a Service backed by the given pool.
// The pool must target the vector_artefacts database.
func NewService(pool *pgxpool.Pool) Service {
	return &pgService{pool: pool}
}

// ── Create ───────────────────────────────────────────────────────────────────

const sqlCreate = `
	INSERT INTO notifications_rules_v2 (
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
		notifications_rules_v2_enabled
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	RETURNING
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
		notifications_rules_v2_updated_at`

func (s *pgService) Create(ctx context.Context, input CreateInput) (Rule, error) {
	if err := input.Validate(); err != nil {
		return Rule{}, err
	}

	condJSON, err := json.Marshal(input.Conditions)
	if err != nil {
		return Rule{}, fmt.Errorf("rules.Service.Create: marshal conditions: %w", err)
	}

	chanStrs := make([]string, len(input.Channels))
	for i, ch := range input.Channels {
		chanStrs[i] = string(ch)
	}
	chanJSON, err := json.Marshal(chanStrs)
	if err != nil {
		return Rule{}, fmt.Errorf("rules.Service.Create: marshal channels: %w", err)
	}

	var prioStr *string
	if input.PriorityOverride != nil {
		s := string(*input.PriorityOverride)
		prioStr = &s
	}

	row := s.pool.QueryRow(ctx, sqlCreate,
		input.SubscriptionID,
		input.WorkspaceID,
		input.UserID,
		input.Name,
		input.EventType,
		string(input.LogicalOp),
		condJSON,
		chanJSON,
		prioStr,
		input.TemplateOverrideID,
		string(input.Schedule),
		input.Enabled,
	)

	r, err := scanRule(row)
	if err != nil {
		return Rule{}, fmt.Errorf("rules.Service.Create: scan: %w", err)
	}
	return r, nil
}

// ── Get ──────────────────────────────────────────────────────────────────────

const sqlGet = `
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
	WHERE notifications_rules_v2_id = $1`

func (s *pgService) Get(ctx context.Context, id uuid.UUID) (Rule, error) {
	row := s.pool.QueryRow(ctx, sqlGet, id)
	r, err := scanRule(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Rule{}, ErrRuleNotFound
		}
		return Rule{}, fmt.Errorf("rules.Service.Get: %w", err)
	}
	return r, nil
}

// ── Update ───────────────────────────────────────────────────────────────────

func (s *pgService) Update(ctx context.Context, id uuid.UUID, input UpdateInput) (Rule, error) {
	// Fetch current to apply partial update semantics.
	current, err := s.Get(ctx, id)
	if err != nil {
		return Rule{}, err
	}

	// Apply only non-nil fields.
	if input.Name != nil {
		current.Name = *input.Name
	}
	if input.EventType != nil {
		current.EventType = *input.EventType
	}
	if input.LogicalOp != nil {
		if !input.LogicalOp.Valid() {
			return Rule{}, ErrInvalidLogicalOp
		}
		current.LogicalOp = *input.LogicalOp
	}
	if input.Conditions != nil {
		current.Conditions = *input.Conditions
	}
	if input.Channels != nil {
		current.Channels = *input.Channels
	}
	if input.PriorityOverride != nil {
		current.PriorityOverride = input.PriorityOverride
	}
	if input.TemplateOverrideID != nil {
		if *input.TemplateOverrideID == uuid.Nil {
			current.TemplateOverrideID = nil
		} else {
			current.TemplateOverrideID = input.TemplateOverrideID
		}
	}
	if input.Schedule != nil {
		if !input.Schedule.Valid() {
			return Rule{}, ErrInvalidSchedule
		}
		current.Schedule = *input.Schedule
	}
	if input.Enabled != nil {
		current.Enabled = *input.Enabled
	}

	condJSON, err := json.Marshal(current.Conditions)
	if err != nil {
		return Rule{}, fmt.Errorf("rules.Service.Update: marshal conditions: %w", err)
	}

	chanStrs := make([]string, len(current.Channels))
	for i, ch := range current.Channels {
		chanStrs[i] = string(ch)
	}
	chanJSON, err := json.Marshal(chanStrs)
	if err != nil {
		return Rule{}, fmt.Errorf("rules.Service.Update: marshal channels: %w", err)
	}

	var prioStr *string
	if current.PriorityOverride != nil {
		s := string(*current.PriorityOverride)
		prioStr = &s
	}

	const sqlUpdate = `
		UPDATE notifications_rules_v2 SET
			notifications_rules_v2_name                 = $2,
			notifications_rules_v2_event_type           = $3,
			notifications_rules_v2_logical_op           = $4,
			notifications_rules_v2_conditions           = $5,
			notifications_rules_v2_channels             = $6,
			notifications_rules_v2_priority_override    = $7,
			notifications_rules_v2_template_override_id = $8,
			notifications_rules_v2_schedule             = $9,
			notifications_rules_v2_enabled              = $10,
			notifications_rules_v2_updated_at           = $11
		WHERE notifications_rules_v2_id = $1
		RETURNING
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
			notifications_rules_v2_updated_at`

	row := s.pool.QueryRow(ctx, sqlUpdate,
		id,
		current.Name,
		current.EventType,
		string(current.LogicalOp),
		condJSON,
		chanJSON,
		prioStr,
		current.TemplateOverrideID,
		string(current.Schedule),
		current.Enabled,
		time.Now().UTC(),
	)

	updated, err := scanRule(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Rule{}, ErrRuleNotFound
		}
		return Rule{}, fmt.Errorf("rules.Service.Update: scan: %w", err)
	}
	return updated, nil
}

// ── Delete ───────────────────────────────────────────────────────────────────

const sqlDelete = `
	DELETE FROM notifications_rules_v2
	WHERE notifications_rules_v2_id = $1`

func (s *pgService) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, sqlDelete, id)
	if err != nil {
		return fmt.Errorf("rules.Service.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrRuleNotFound
	}
	return nil
}

// ── List ─────────────────────────────────────────────────────────────────────

func (s *pgService) List(ctx context.Context, filter ListFilter) ([]Rule, error) {
	// Base query always scopes by subscription.
	q := `
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
		WHERE notifications_rules_v2_id_subscription = $1`

	args := []any{filter.SubscriptionID}
	argIdx := 2

	if filter.EventType != "" {
		q += fmt.Sprintf(" AND notifications_rules_v2_event_type = $%d", argIdx)
		args = append(args, filter.EventType)
		argIdx++
	}
	if filter.EnabledOnly {
		q += fmt.Sprintf(" AND notifications_rules_v2_enabled = $%d", argIdx)
		args = append(args, true)
		argIdx++
	}
	if filter.WorkspaceID != nil {
		q += fmt.Sprintf(" AND (notifications_rules_v2_id_workspace = $%d OR notifications_rules_v2_id_workspace IS NULL)", argIdx)
		args = append(args, *filter.WorkspaceID)
		argIdx++
	}
	if filter.UserID != nil {
		q += fmt.Sprintf(" AND (notifications_rules_v2_id_user = $%d OR notifications_rules_v2_id_user IS NULL)", argIdx)
		args = append(args, *filter.UserID)
		argIdx++
	}

	_ = argIdx
	q += " ORDER BY notifications_rules_v2_created_at ASC"

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("rules.Service.List: query: %w", err)
	}
	defer rows.Close()

	var result []Rule
	for rows.Next() {
		r, err := scanRule(rows)
		if err != nil {
			return nil, fmt.Errorf("rules.Service.List: scan: %w", err)
		}
		result = append(result, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rules.Service.List: rows: %w", err)
	}

	if result == nil {
		result = []Rule{}
	}
	return result, nil
}
