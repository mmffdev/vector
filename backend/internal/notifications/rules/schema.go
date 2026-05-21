package rules

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Schema exposes the per-tenant rule-builder catalogue. The settings
// UI calls it to populate the type / target / field / operator
// dropdowns. The catalogue is type-aware: a numeric field offers
// different operators than a select/enum field.
//
// Endpoint: GET /notifications/rule-schema
//   - no args     → returns the type list (artefact / mention / note / etc)
//   - ?type=artefact → returns the per-tenant artefact_types list
//                     (id + label, drives the "target" dropdown)
//   - ?type=artefact&target=<artefact_type_id>
//                  → returns the field+operator catalogue for that type
//                    (drives the field/operator/value rows in the UI)
//
// Sources:
//   - Type list  — hard-coded RuleType constants (matches CHECK on table)
//   - Target list — vaPool.artefacts_types filtered by subscription
//   - Field list  — vaPool.artefacts_types_fields JOIN artefacts_fields_library
//     filtered by the requested artefact type
//   - Operators per field type — operatorsByFieldType() below
type Schema struct {
	vaPool *pgxpool.Pool
}

func NewSchema(vaPool *pgxpool.Pool) *Schema {
	return &Schema{vaPool: vaPool}
}

// TypeEntry is one row in the rule-type list. Disabled types
// (everything except 'artefact' today) are surfaced with
// enabled=false so the UI can render them greyed.
type TypeEntry struct {
	Value   string `json:"value"`
	Label   string `json:"label"`
	Enabled bool   `json:"enabled"`
	// Reason is shown next to the option when enabled=false.
	Reason string `json:"reason,omitempty"`
}

// TargetEntry is one selectable target — for 'artefact' rules, this
// is one artefact_type the tenant has (potentially renamed).
type TargetEntry struct {
	Value string `json:"value"` // artefact_type id
	Label string `json:"label"` // tenant's customised name
}

// FieldEntry is one selectable predicate target inside a rule's
// conditions array. The UI uses Operators[] to populate the operator
// dropdown for this field; ValueType drives the value-input choice
// (text / number / date / select / boolean / etc).
type FieldEntry struct {
	Value     string          `json:"value"`             // field_name (stable wire key)
	Label     string          `json:"label"`             // tenant's customised label
	ValueType string          `json:"value_type"`        // boolean | date | decimal | integer | multiselect | richtext | select | textbox | user
	Operators []OperatorEntry `json:"operators"`         // type-aware operator catalogue
	Options   []OptionEntry   `json:"options,omitempty"` // for select/multiselect — populated from options_json
}

// OperatorEntry pairs the underlying Operator symbol with a human
// label the UI renders. Storing both means the wire value stays the
// short symbol (forwards-compat with JQL) while the label can be
// translated / softened later without breaking persisted rules.
type OperatorEntry struct {
	Value     Operator `json:"value"`
	Label     string   `json:"label"`
	NeedsValue bool    `json:"needs_value"` // false for `changed` — UI hides the value field
}

// OptionEntry is one allowed value for select/multiselect fields.
// Populated from artefacts_fields_library.options_json.
type OptionEntry struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// Types — hard-coded list of supported rule types. Mirrors the
// CHECK constraint in migration 236.
func (s *Schema) Types() []TypeEntry {
	return []TypeEntry{
		{Value: string(TypeArtefact), Label: "Artefact", Enabled: true},
		{Value: string(TypeMention), Label: "Mention", Enabled: false, Reason: "Coming soon — @-mentions auto-deliver today; rules will let you filter them."},
		{Value: string(TypeNote), Label: "Note", Enabled: false, Reason: "Coming soon — notes feature isn't wired yet."},
		{Value: string(TypeComment), Label: "Comment", Enabled: false, Reason: "Coming soon — comment threads aren't wired yet."},
		{Value: string(TypeOwnerProposed), Label: "Owner change proposed", Enabled: false, Reason: "Coming soon — needs a propose-before-write hook on the owner field."},
	}
}

// Targets — for type='artefact', returns the tenant's artefact_types.
func (s *Schema) Targets(ctx context.Context, subscriptionID uuid.UUID, ruleType RuleType) ([]TargetEntry, error) {
	if ruleType != TypeArtefact {
		return nil, fmt.Errorf("%w: targets only supported for type='artefact' today", ErrUnsupportedType)
	}
	if s.vaPool == nil {
		// vector_artefacts unavailable — return empty rather than 500.
		return []TargetEntry{}, nil
	}
	rows, err := s.vaPool.Query(ctx, sqlSelectArtefactTypes, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("list artefact types: %w", err)
	}
	defer rows.Close()
	out := []TargetEntry{}
	for rows.Next() {
		var t TargetEntry
		if err := rows.Scan(&t.Value, &t.Label); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Fields — for type='artefact' + target=<artefact_type_id>, returns
// the fields the tenant has bound to that type (including custom and
// renamed-label fields).
func (s *Schema) Fields(ctx context.Context, subscriptionID uuid.UUID, ruleType RuleType, targetID string) ([]FieldEntry, error) {
	if ruleType != TypeArtefact {
		return nil, fmt.Errorf("%w: fields only supported for type='artefact' today", ErrUnsupportedType)
	}
	if targetID == "" {
		return nil, fmt.Errorf("%w: target is required", ErrInvalidInput)
	}
	if s.vaPool == nil {
		return []FieldEntry{}, nil
	}
	targetUUID, err := uuid.Parse(targetID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid target id", ErrInvalidInput)
	}
	rows, err := s.vaPool.Query(ctx, sqlSelectArtefactTypeFields, subscriptionID, targetUUID)
	if err != nil {
		return nil, fmt.Errorf("list fields: %w", err)
	}
	defer rows.Close()
	out := []FieldEntry{}
	for rows.Next() {
		var f FieldEntry
		var optionsRaw []byte
		if err := rows.Scan(&f.Value, &f.Label, &f.ValueType, &optionsRaw); err != nil {
			return nil, err
		}
		f.Operators = operatorsByFieldType(f.ValueType)
		if len(optionsRaw) > 0 {
			// Best-effort parse — silently empty if malformed.
			var raw []struct {
				Value string `json:"value"`
				Label string `json:"label"`
			}
			if err := json.Unmarshal(optionsRaw, &raw); err == nil {
				for _, o := range raw {
					out := OptionEntry{Value: o.Value, Label: o.Label}
					if out.Label == "" {
						out.Label = out.Value
					}
					f.Options = append(f.Options, out)
				}
			}
		}
		// Add built-in "core" fields that aren't in the field library
		// but every artefact has (flow_state, owner, sprint, etc).
		// Deferred — wire when the evaluator needs them.
		out = append(out, f)
	}
	return out, rows.Err()
}

// operatorsByFieldType is the type-aware operator catalogue. The
// label strings are the human-readable form the UI shows; the
// `Value` is the stored Operator symbol (forwards-compat with JQL).
//
// `NeedsValue=false` means the operator is parameter-free (e.g.
// `changed` — the UI hides the value input when this is picked).
func operatorsByFieldType(fieldType string) []OperatorEntry {
	switch fieldType {
	case "textbox", "richtext":
		return []OperatorEntry{
			{OpEquals, "equals", true},
			{OpNotEquals, "does not equal", true},
			{OpContains, "contains", true},
			{OpChanged, "changed", false},
			{OpChangedFrom, "changed from", true},
			{OpChangedTo, "changed to", true},
		}
	case "integer", "decimal":
		return []OperatorEntry{
			{OpEquals, "equals", true},
			{OpNotEquals, "does not equal", true},
			{OpGreaterThan, "greater than", true},
			{OpLessThan, "less than", true},
			{OpGTE, "greater than or equal to", true},
			{OpLTE, "less than or equal to", true},
			{OpChanged, "changed", false},
			{OpChangedFrom, "changed from", true},
			{OpChangedTo, "changed to", true},
		}
	case "date":
		return []OperatorEntry{
			{OpEquals, "is on", true},
			{OpNotEquals, "is not on", true},
			{OpGreaterThan, "is after", true},
			{OpLessThan, "is before", true},
			{OpGTE, "is on or after", true},
			{OpLTE, "is on or before", true},
			{OpChanged, "changed", false},
			{OpChangedFrom, "changed from", true},
			{OpChangedTo, "changed to", true},
		}
	case "boolean":
		return []OperatorEntry{
			{OpEquals, "is", true},
			{OpChanged, "changed", false},
			{OpChangedTo, "changed to", true},
		}
	case "select":
		return []OperatorEntry{
			{OpEquals, "equals", true},
			{OpNotEquals, "does not equal", true},
			{OpChanged, "changed", false},
			{OpChangedFrom, "changed from", true},
			{OpChangedTo, "changed to", true},
			{OpWas, "was (at any time)", true},
			{OpWasNot, "was not (at any time)", true},
		}
	case "multiselect":
		return []OperatorEntry{
			{OpContains, "contains", true},
			{OpEquals, "is exactly", true},
			{OpChanged, "changed", false},
		}
	case "user":
		return []OperatorEntry{
			{OpEquals, "is", true},
			{OpNotEquals, "is not", true},
			{OpChanged, "changed", false},
			{OpChangedFrom, "changed from", true},
			{OpChangedTo, "changed to", true},
			{OpWas, "was (at any time)", true},
		}
	default:
		// Unknown field type — give the conservative defaults so the
		// UI never renders an empty operator list.
		return []OperatorEntry{
			{OpEquals, "equals", true},
			{OpNotEquals, "does not equal", true},
			{OpChanged, "changed", false},
		}
	}
}

// HandleHTTP is the GET /notifications/rule-schema handler. Returns
// the section the caller asked for; the UI composes them across
// dropdown changes.
type SchemaHandler struct {
	schema *Schema
}

func NewSchemaHandler(s *Schema) *SchemaHandler {
	return &SchemaHandler{schema: s}
}

func (h *SchemaHandler) Get(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	typeParam := r.URL.Query().Get("type")
	target := r.URL.Query().Get("target")

	// No type → return the type list (drives the UI's first dropdown).
	if typeParam == "" {
		write(w, map[string]any{"types": h.schema.Types()})
		return
	}

	ruleType := RuleType(typeParam)
	if !ruleType.Valid() {
		httperr.Write(w, r, http.StatusBadRequest, "unknown type")
		return
	}

	// type but no target → return target options for that type.
	if target == "" {
		targets, err := h.schema.Targets(r.Context(), user.SubscriptionID, ruleType)
		if err != nil {
			if errors.Is(err, ErrUnsupportedType) {
				httperr.Write(w, r, http.StatusNotImplemented, err.Error())
				return
			}
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
			return
		}
		write(w, map[string]any{"targets": targets})
		return
	}

	// type + target → return fields + operators.
	fields, err := h.schema.Fields(r.Context(), user.SubscriptionID, ruleType, target)
	if err != nil {
		if errors.Is(err, ErrUnsupportedType) || errors.Is(err, ErrInvalidInput) {
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "target", Message: err.Error()},
			})
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	write(w, map[string]any{"fields": fields})
}

func write(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}
