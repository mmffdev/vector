package rules

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns CRUD on users_notification_rules.
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Create persists a new rule. Validates the name + at least one
// condition (a rule with zero predicates would match every write).
//
// Admin-scoped rules (UserID == uuid.Nil) are explicitly rejected
// — the column exists for a future iteration; see migration 236
// header comment + the ErrAdminScopeUnwired sentinel.
func (s *Service) Create(ctx context.Context, in CreateInput) (*Rule, error) {
	if in.UserID == uuid.Nil {
		return nil, ErrAdminScopeUnwired
	}
	if in.WorkspaceID == uuid.Nil {
		return nil, fmt.Errorf("%w: workspace_id is required", ErrInvalidInput)
	}
	if err := validateCreate(in); err != nil {
		return nil, err
	}
	condBytes, err := json.Marshal(in.Conditions)
	if err != nil {
		return nil, fmt.Errorf("marshal conditions: %w", err)
	}
	row := s.pool.QueryRow(ctx, sqlInsertRule,
		in.SubscriptionID, in.UserID, in.WorkspaceID,
		in.Name, string(in.Type), in.Target, condBytes,
	)
	return scanRule(row)
}

// ListForUser returns the rules owned by userID, newest-edit-first.
func (s *Service) ListForUser(ctx context.Context, userID, subscriptionID uuid.UUID) ([]Rule, error) {
	rows, err := s.pool.Query(ctx, sqlSelectRulesByUser, userID, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("list rules: %w", err)
	}
	defer rows.Close()
	out := []Rule{}
	for rows.Next() {
		r, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// Get returns one rule, ownership-checked.
func (s *Service) Get(ctx context.Context, ruleID, userID uuid.UUID) (*Rule, error) {
	row := s.pool.QueryRow(ctx, sqlSelectRuleByID, ruleID, userID)
	r, err := scanRule(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return r, nil
}

// Update applies a partial update. Caller must own the rule.
func (s *Service) Update(ctx context.Context, ruleID, userID uuid.UUID, in UpdateInput) (*Rule, error) {
	sets := []string{}
	args := []any{}
	n := 1
	add := func(col string, v any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, n))
		args = append(args, v)
		n++
	}
	if in.Name != nil {
		if strings.TrimSpace(*in.Name) == "" {
			return nil, fmt.Errorf("%w: name required", ErrInvalidInput)
		}
		add("users_notification_rules_name", *in.Name)
	}
	if in.Conditions != nil {
		if len(*in.Conditions) == 0 {
			return nil, fmt.Errorf("%w: at least one condition required", ErrInvalidInput)
		}
		b, err := json.Marshal(*in.Conditions)
		if err != nil {
			return nil, fmt.Errorf("marshal conditions: %w", err)
		}
		add("users_notification_rules_conditions", b)
	}
	if in.Enabled != nil {
		add("users_notification_rules_enabled", *in.Enabled)
	}
	if len(sets) == 0 {
		return s.Get(ctx, ruleID, userID)
	}
	args = append(args, ruleID, userID)
	q := fmt.Sprintf(sqlUpdateRuleTemplate, strings.Join(sets, ", "), n, n+1)
	row := s.pool.QueryRow(ctx, q, args...)
	r, err := scanRule(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return r, nil
}

// Delete removes a rule. Caller must own the rule.
func (s *Service) Delete(ctx context.Context, ruleID, userID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, sqlDeleteRule, ruleID, userID)
	if err != nil {
		return fmt.Errorf("delete rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func validateCreate(in CreateInput) error {
	if strings.TrimSpace(in.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	if !in.Type.Valid() {
		return fmt.Errorf("%w: invalid type", ErrInvalidInput)
	}
	if in.Type != TypeArtefact {
		// Strawman only wires artefact rules end-to-end. We refuse
		// to create rules of unsupported types rather than persist
		// them and silently never fire — that's worse UX than a 400.
		return fmt.Errorf("%w: %s", ErrUnsupportedType, in.Type)
	}
	if in.Target == nil || strings.TrimSpace(*in.Target) == "" {
		return fmt.Errorf("%w: artefact rules require a target", ErrInvalidInput)
	}
	if len(in.Conditions) == 0 {
		return fmt.Errorf("%w: at least one condition required", ErrInvalidInput)
	}
	for i, c := range in.Conditions {
		if strings.TrimSpace(c.Field) == "" {
			return fmt.Errorf("%w: condition[%d] missing field", ErrInvalidInput, i)
		}
		if !validOperator(c.Operator) {
			return fmt.Errorf("%w: condition[%d] invalid operator %q", ErrInvalidInput, i, c.Operator)
		}
	}
	return nil
}

func validOperator(o Operator) bool {
	switch o {
	case OpEquals, OpNotEquals, OpGreaterThan, OpLessThan, OpGTE, OpLTE,
		OpContains, OpChanged, OpChangedFrom, OpChangedTo,
		OpWas, OpWasNot, OpWasIn, OpWasNotIn:
		return true
	}
	return false
}

type scannable interface {
	Scan(dest ...any) error
}

func scanRule(row scannable) (*Rule, error) {
	var r Rule
	var typ string
	var condRaw []byte
	if err := row.Scan(
		&r.ID, &r.SubscriptionID, &r.UserID, &r.WorkspaceID, &r.Name,
		&typ, &r.Target, &condRaw, &r.Enabled, &r.CreatedAt, &r.UpdatedAt,
	); err != nil {
		return nil, err
	}
	r.Type = RuleType(typ)
	if len(condRaw) > 0 {
		if err := json.Unmarshal(condRaw, &r.Conditions); err != nil {
			return nil, fmt.Errorf("unmarshal conditions: %w", err)
		}
	}
	if r.Conditions == nil {
		r.Conditions = []Condition{}
	}
	return &r, nil
}
