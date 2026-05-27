// Package rules implements the notifications v2 rules engine.
//
// A Rule is a row from notifications_rules_v2. It carries a set of
// Conditions that are combined via LogicalOp (AND / OR). The Evaluator
// tests an incoming domain.Event against all enabled rules for the event's
// subscription+type, returning every matching rule.
//
// Column naming follows the project hard rule: every column is prefixed
// with the full table name (notifications_rules_v2_*).
package rules

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// ── Sentinel errors ──────────────────────────────────────────────────────────

var (
	// ErrRuleNotFound is returned when a rule ID does not exist.
	ErrRuleNotFound = errors.New("rules: rule not found")

	// ErrInvalidLogicalOp is returned when a LogicalOp is neither AND nor OR.
	ErrInvalidLogicalOp = errors.New("rules: invalid logical_op (must be AND or OR)")

	// ErrInvalidOperator is returned when a Condition.Operator is unrecognised.
	ErrInvalidOperator = errors.New("rules: invalid operator")

	// ErrInvalidSchedule is returned when a Schedule value is unrecognised.
	ErrInvalidSchedule = errors.New("rules: invalid schedule (must be immediate, next_quiet_hours_end, or digest)")

	// ErrMissingName is returned when a rule has an empty name.
	ErrMissingName = errors.New("rules: name must not be empty")

	// ErrMissingEventType is returned when a rule has an empty event_type.
	ErrMissingEventType = errors.New("rules: event_type must not be empty")
)

// ── LogicalOp ────────────────────────────────────────────────────────────────

// LogicalOp controls how multiple Conditions are combined.
//
// Vacuous-truth semantics (deliberate design choice):
//   - AND with zero conditions → true  (no conditions = always match)
//   - OR  with zero conditions → false (no conditions = never match)
//
// This mirrors SQL WHERE clause conventions and is tested explicitly.
type LogicalOp string

const (
	LogicalOpAND LogicalOp = "AND"
	LogicalOpOR  LogicalOp = "OR"
)

// Valid reports whether l is a recognised LogicalOp.
func (l LogicalOp) Valid() bool {
	return l == LogicalOpAND || l == LogicalOpOR
}

// ── Operator ─────────────────────────────────────────────────────────────────

// Operator is the comparison function applied in a Condition.
//
// The eight operators map directly to the spec (S07 locked decisions):
//
//	eq          — field == value (type-sensitive)
//	neq         — field != value
//	gte         — field >= value (numerics; string lex order as fallback)
//	lte         — field <= value
//	in          — value is in a list (Value must decode to []any)
//	contains    — string field contains substring (both must be strings)
//	exists      — field path is present and non-nil
//	not_exists  — field path is absent or nil
type Operator string

const (
	OperatorEq        Operator = "eq"
	OperatorNeq       Operator = "neq"
	OperatorGte       Operator = "gte"
	OperatorLte       Operator = "lte"
	OperatorIn        Operator = "in"
	OperatorContains  Operator = "contains"
	OperatorExists    Operator = "exists"
	OperatorNotExists Operator = "not_exists"
)

// Valid reports whether op is a recognised Operator.
func (op Operator) Valid() bool {
	switch op {
	case OperatorEq, OperatorNeq, OperatorGte, OperatorLte,
		OperatorIn, OperatorContains, OperatorExists, OperatorNotExists:
		return true
	}
	return false
}

// ── Condition ─────────────────────────────────────────────────────────────────

// Condition is a single predicate evaluated against a domain.Event.
//
// Field is a dot-path into Event.Data (e.g. "actor.role", "item.priority").
// Value is the RHS of the comparison; its type depends on Operator:
//   - eq/neq/gte/lte/contains: scalar (string, float64, bool)
//   - in: []any (JSON array)
//   - exists/not_exists: ignored (Value may be nil)
type Condition struct {
	Field    string   `json:"field"`
	Operator Operator `json:"op"`
	Value    any      `json:"value,omitempty"`
}

// ── Schedule ─────────────────────────────────────────────────────────────────

// Schedule mirrors the CHECK constraint in migration 128.
type Schedule string

const (
	ScheduleImmediate         Schedule = "immediate"
	ScheduleNextQuietHoursEnd Schedule = "next_quiet_hours_end"
	ScheduleDigest            Schedule = "digest"
)

// Valid reports whether s is a recognised Schedule.
func (s Schedule) Valid() bool {
	switch s {
	case ScheduleImmediate, ScheduleNextQuietHoursEnd, ScheduleDigest:
		return true
	}
	return false
}

// ── Rule ─────────────────────────────────────────────────────────────────────

// Rule is the Go representation of a notifications_rules_v2 row.
//
// Field names map directly to the column naming convention
// (notifications_rules_v2_*) for clarity at SQL scan sites.
type Rule struct {
	// ID is notifications_rules_v2_id.
	ID uuid.UUID

	// SubscriptionID is notifications_rules_v2_id_subscription (required).
	SubscriptionID uuid.UUID

	// WorkspaceID is notifications_rules_v2_id_workspace (optional).
	WorkspaceID *uuid.UUID

	// UserID is notifications_rules_v2_id_user (optional).
	UserID *uuid.UUID

	// Name is notifications_rules_v2_name.
	Name string

	// EventType is notifications_rules_v2_event_type (e.g. "artefact.created").
	EventType string

	// LogicalOp is notifications_rules_v2_logical_op.
	LogicalOp LogicalOp

	// Conditions is notifications_rules_v2_conditions (JSONB decoded).
	Conditions []Condition

	// Channels is notifications_rules_v2_channels (JSONB decoded).
	// Contains domain.Channel values.
	Channels []domain.Channel

	// PriorityOverride is notifications_rules_v2_priority_override (optional).
	PriorityOverride *domain.Priority

	// TemplateOverrideID is notifications_rules_v2_template_override_id (optional).
	TemplateOverrideID *uuid.UUID

	// Schedule is notifications_rules_v2_schedule.
	Schedule Schedule

	// Enabled is notifications_rules_v2_enabled.
	Enabled bool

	// CreatedAt is notifications_rules_v2_created_at.
	CreatedAt time.Time

	// UpdatedAt is notifications_rules_v2_updated_at.
	UpdatedAt time.Time
}

// ── ListFilter ────────────────────────────────────────────────────────────────

// ListFilter narrows the rules returned by Service.List.
// Zero-value = no filter (return all rules for the subscription).
type ListFilter struct {
	// SubscriptionID is required.
	SubscriptionID uuid.UUID

	// EventType filters by event_type when non-empty.
	EventType string

	// EnabledOnly, when true, filters out disabled rules.
	EnabledOnly bool

	// WorkspaceID, when non-nil, filters rules to those scoped to the workspace
	// OR those with no workspace scope (nil workspace = applies to all workspaces).
	WorkspaceID *uuid.UUID

	// UserID, when non-nil, filters rules to those scoped to the user
	// OR those with no user scope.
	UserID *uuid.UUID
}

// ── CreateInput / UpdateInput ─────────────────────────────────────────────────

// CreateInput is the validated payload for Service.Create.
type CreateInput struct {
	SubscriptionID     uuid.UUID
	WorkspaceID        *uuid.UUID
	UserID             *uuid.UUID
	Name               string
	EventType          string
	LogicalOp          LogicalOp
	Conditions         []Condition
	Channels           []domain.Channel
	PriorityOverride   *domain.Priority
	TemplateOverrideID *uuid.UUID
	Schedule           Schedule
	Enabled            bool
}

// Validate returns the first validation error, or nil.
func (c CreateInput) Validate() error {
	if c.Name == "" {
		return ErrMissingName
	}
	if c.EventType == "" {
		return ErrMissingEventType
	}
	if !c.LogicalOp.Valid() {
		return ErrInvalidLogicalOp
	}
	if !c.Schedule.Valid() {
		return ErrInvalidSchedule
	}
	for _, cond := range c.Conditions {
		if !cond.Operator.Valid() {
			return ErrInvalidOperator
		}
	}
	return nil
}

// UpdateInput carries the fields that may be mutated by Service.Update.
// Only non-nil pointer fields are applied (partial update semantics).
type UpdateInput struct {
	Name               *string
	EventType          *string
	LogicalOp          *LogicalOp
	Conditions         *[]Condition
	Channels           *[]domain.Channel
	PriorityOverride   *domain.Priority // set to zero-value string to clear
	TemplateOverrideID *uuid.UUID       // set to uuid.Nil to clear
	Schedule           *Schedule
	Enabled            *bool
}
