// Package artefacts provides generic CRUD, schema management, and field
// value access for all Phase 1 artefact types. All operations are
// subscription-scoped — cross-tenant reads are impossible by design.
package artefacts

import (
	"errors"
	"time"
)

// Sentinel errors.
var (
	ErrNotFound        = errors.New("artefact not found")
	ErrSchemaNotFound  = errors.New("schema field not found")
	ErrTypeConflict    = errors.New("field type cannot be changed once values exist")
	ErrInvalidType     = errors.New("invalid artefact type")
	ErrInvalidKind     = errors.New("invalid field kind")
)

// typeTable maps a scope_key to its three table names.
type typeTable struct {
	core   string
	schema string
	fv     string
}

// registry maps scope_key → table triple. All 5 Phase 1 types.
var registry = map[string]typeTable{
	"execution_user_stories": {
		core:   "o_artefacts_execution_user_stories",
		schema: "o_artefacts_execution_user_stories_schema",
		fv:     "o_artefacts_execution_user_stories_field_values",
	},
	"execution_defects": {
		core:   "o_artefacts_execution_defects",
		schema: "o_artefacts_execution_defects_schema",
		fv:     "o_artefacts_execution_defects_field_values",
	},
	"execution_tasks": {
		core:   "o_artefacts_execution_tasks",
		schema: "o_artefacts_execution_tasks_schema",
		fv:     "o_artefacts_execution_tasks_field_values",
	},
	"execution_test_cases": {
		core:   "o_artefacts_execution_test_cases",
		schema: "o_artefacts_execution_test_cases_schema",
		fv:     "o_artefacts_execution_test_cases_field_values",
	},
	"strategic": {
		core:   "o_artefacts_strategic",
		schema: "o_artefacts_strategic_schema",
		fv:     "o_artefacts_strategic_field_values",
	},
}

// validFieldKinds is the set of allowed type values for _schema rows.
var validFieldKinds = map[string]bool{
	"textbox": true, "richtext": true, "integer": true, "decimal": true,
	"date": true, "boolean": true, "select": true, "multiselect": true,
	"radio": true, "user": true, "url": true,
}

func tables(artefactType string) (typeTable, error) {
	t, ok := registry[artefactType]
	if !ok {
		return typeTable{}, ErrInvalidType
	}
	return t, nil
}

// Artefact is the core row returned by Get/Create/Patch.
type Artefact struct {
	ID             string     `json:"id"`
	SubscriptionID string     `json:"subscription_id"`
	KeyNum         int64      `json:"key_num"`
	Title          string     `json:"title"`
	Description    *string    `json:"description,omitempty"`
	OwnerID        string     `json:"owner_id"`
	CreatedBy      string     `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at,omitempty"`
}

// CreateInput holds required fields for creating any artefact.
type CreateInput struct {
	Title       string
	Description *string
	OwnerID     string
}

// PatchInput holds optional updates. Nil = leave unchanged.
type PatchInput struct {
	Title       *string
	Description *string
	OwnerID     *string
}

// SchemaField is one row from a *_schema table.
type SchemaField struct {
	ID             string     `json:"id"`
	SubscriptionID string     `json:"subscription_id"`
	FieldName      string     `json:"field_name"`
	Label          string     `json:"label"`
	Type           string     `json:"type"`
	Required       bool       `json:"required"`
	Position       int        `json:"position"`
	DefaultValue   *string    `json:"default_value,omitempty"`
	OptionsJSON    *string    `json:"options_json,omitempty"`
	ConfigJSON     *string    `json:"config_json,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at,omitempty"`
}

// CreateSchemaInput holds required fields for a new schema row.
type CreateSchemaInput struct {
	FieldName    string
	Label        string
	Type         string
	Required     bool
	Position     int
	DefaultValue *string
	OptionsJSON  *string
	ConfigJSON   *string
}

// PatchSchemaInput holds optional schema updates. Type is immutable once
// field_values rows reference this schema_field_id.
type PatchSchemaInput struct {
	Label        *string
	Required     *bool
	Position     *int
	DefaultValue *string
	OptionsJSON  *string
	ConfigJSON   *string
}

// FieldValue is one row from a *_field_values table.
type FieldValue struct {
	ID            string  `json:"id"`
	FieldName     string  `json:"field_name"`
	SchemaFieldID *string `json:"schema_field_id,omitempty"`
	StringValue   *string `json:"string_value,omitempty"`
	NumberValue   *string `json:"number_value,omitempty"`
	TextValue     *string `json:"text_value,omitempty"`
	DateValue     *string `json:"date_value,omitempty"`
}

// WriteFieldInput holds the value for a single field write.
type WriteFieldInput struct {
	StringValue *string
	NumberValue *string
	TextValue   *string
	DateValue   *string
}
