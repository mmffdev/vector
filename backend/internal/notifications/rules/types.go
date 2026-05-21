// Package rules is the user-defined notification-rule engine.
//
// PRIOR ART: this models JIRA's "filter subscription" / Rally's
// "notification rule" pattern. A rule is a {type, target,
// conditions[]} predicate authored by a user (today) or, in a future
// iteration, by a tenant admin as a baseline default. When an
// artefact (or other event source) writes, the evaluator scans the
// matching rule set, AND-combines each rule's conditions, and fans
// every match into the notifications outbox. AND across a rule's
// conditions; OR across rules (any match fires its own notification).
//
// The operator catalogue is borrowed from JQL — including the WAS /
// WAS_IN family (point-in-time history queries), which we surface
// today but only fully evaluate once the artefact-history feature
// lands (see ArtefactChangedEvent's history hook).
//
// Conditions persist as JSONB so adding operators or field types is
// a code-only change, no migration. The downside (less queryable)
// is mitigated by the fact that we only ever read all of a user's
// rules at once (small N), never filter SQL on a single predicate.
//
// File map:
//   - types.go    — wire + storage types
//   - service.go  — CRUD surface
//   - schema.go   — /notifications/rule-schema endpoint (UI catalogue)
//   - evaluator.go — write-time matcher (currently a stub)
//   - sql.go      — query constants
//   - handler.go  — HTTP surface
package rules

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound          = errors.New("rule not found")
	ErrInvalidInput      = errors.New("invalid rule input")
	ErrUnsupportedType   = errors.New("rule type not yet supported")
	ErrAdminScopeUnwired = errors.New("admin-scoped rules (id_user=NULL) are not yet wired")
)

// RuleType is the coarse bucket the rule belongs to. Mirrors the
// users_notifications_tag column so notifications fired by a rule
// inherit the rule's tag automatically.
//
// Only "artefact" is wired in the strawman; the others appear in the
// type list + schema endpoint as placeholders so the UI can render
// them disabled or hidden behind a flag.
type RuleType string

const (
	TypeArtefact      RuleType = "artefact"
	TypeMention       RuleType = "mention"
	TypeNote          RuleType = "note"
	TypeComment       RuleType = "comment"
	TypeOwnerProposed RuleType = "owner_proposed"
)

func (t RuleType) Valid() bool {
	switch t {
	case TypeArtefact, TypeMention, TypeNote, TypeComment, TypeOwnerProposed:
		return true
	}
	return false
}

// Operator is the underlying comparison verb. Vocabulary is borrowed
// from JQL (JIRA Query Language) so users coming from Jira/Rally
// recognise the semantics. Human labels live in schema.go (the UI
// renders the label; the wire value stays the short symbolic form).
type Operator string

const (
	// Value comparisons — applicable to numeric/date/text/state fields
	OpEquals      Operator = "="
	OpNotEquals   Operator = "!="
	OpGreaterThan Operator = ">"
	OpLessThan    Operator = "<"
	OpGTE         Operator = ">="
	OpLTE         Operator = "<="
	OpContains    Operator = "contains"

	// Change-detection — fires on state transitions. `changed` ignores
	// the value; `changed_from` / `changed_to` pin one side. These
	// require a history feed; today's evaluator stubs them.
	OpChanged     Operator = "changed"
	OpChangedFrom Operator = "changed_from"
	OpChangedTo   Operator = "changed_to"

	// Point-in-time history (borrowed from JQL). "Was assigned to X
	// at any point in the last 7 days" / "was in 'In Progress' before".
	// Surfaced in the schema today; evaluator wires them when the
	// artefact-history feature lands.
	OpWas      Operator = "was"
	OpWasNot   Operator = "was_not"
	OpWasIn    Operator = "was_in"
	OpWasNotIn Operator = "was_not_in"
)

// Condition is one predicate in a rule's `conditions` array. Stored
// as JSONB; the evaluator type-asserts Value based on the field's
// declared field_type at schema-fetch time.
type Condition struct {
	Field    string   `json:"field"`
	Operator Operator `json:"operator"`
	// Value is intentionally `any` — number, string, bool, or null
	// depending on the field type + operator. `changed` ignores it.
	Value any `json:"value,omitempty"`
}

// Rule is the persisted entity + the wire shape returned by the API.
type Rule struct {
	ID             uuid.UUID   `json:"users_notification_rules_id"`
	SubscriptionID uuid.UUID   `json:"users_notification_rules_id_subscription"`
	// UserID is nullable in the schema for FUTURE admin-defaults
	// support. The service rejects nil today; this field stays
	// pointer-typed so the wire shape doesn't lie about nullability.
	UserID     *uuid.UUID  `json:"users_notification_rules_id_user,omitempty"`
	Name       string      `json:"users_notification_rules_name"`
	Type       RuleType    `json:"users_notification_rules_type"`
	Target     *string     `json:"users_notification_rules_target,omitempty"`
	Conditions []Condition `json:"users_notification_rules_conditions"`
	Enabled    bool        `json:"users_notification_rules_enabled"`
	CreatedAt  time.Time   `json:"users_notification_rules_created_at"`
	UpdatedAt  time.Time   `json:"users_notification_rules_updated_at"`
}

// CreateInput / UpdateInput separate the service-layer payload from
// the wire shape so handler-side type-assertions stay narrow.
type CreateInput struct {
	SubscriptionID uuid.UUID
	UserID         uuid.UUID
	Name           string
	Type           RuleType
	Target         *string
	Conditions     []Condition
}

type UpdateInput struct {
	Name       *string
	Conditions *[]Condition
	Enabled    *bool
}
