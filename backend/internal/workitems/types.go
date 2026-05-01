// Package workitems owns the work_items artefact: epics, stories, and their
// associated sprints, custom field library, templates, and field values.
// All queries are subscription-scoped; cross-tenant reads are impossible.
package workitems

import (
	"errors"
	"time"
)

var (
	ErrNotFound         = errors.New("work item not found")
	ErrSprintNotFound   = errors.New("sprint not found")
	ErrFieldNotFound    = errors.New("custom field not found")
	ErrTemplateNotFound = errors.New("template not found")
	ErrConflict         = errors.New("conflict: resource already exists or constraint violated")
	ErrInvalidInput     = errors.New("invalid input")
	ErrWrongValueColumn = errors.New("value column does not match field type")
)

// WorkItem is the wire representation of o_artefacts_execution_work_items.
type WorkItem struct {
	ID             string     `json:"id"`
	SubscriptionID string     `json:"subscription_id"`
	KeyNum         int64      `json:"key_num"`
	ItemType       string     `json:"item_type"`
	Title          string     `json:"title"`
	Description    *string    `json:"description,omitempty"`
	Status         string     `json:"status"`
	Priority       *string    `json:"priority,omitempty"`
	StoryPoints    *int       `json:"story_points,omitempty"`
	SprintID       *string    `json:"sprint_id,omitempty"`
	ParentID       *string    `json:"parent_id,omitempty"`
	RootFeatureID  *string    `json:"root_feature_id,omitempty"`
	OwnerID        string     `json:"owner_id"`
	CreatedBy      string     `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at,omitempty"`
	ChildrenCount  int        `json:"children_count"`
}

// CreateWorkItemInput holds fields required to create a work item.
type CreateWorkItemInput struct {
	ItemType    string
	Title       string
	Description *string
	Status      string
	Priority    *string
	StoryPoints *int
	SprintID    *string
	ParentID    *string
	OwnerID     string
	CreatedBy   string
}

// PatchWorkItemInput holds optional fields for partial update.
type PatchWorkItemInput struct {
	Title       *string
	Description *string
	Status      *string
	Priority    *string
	StoryPoints *int
	SprintID    *string
}

// ListWorkItemsFilter holds query parameters for the list endpoint.
type ListWorkItemsFilter struct {
	ParentID *string
	ItemType *string
	Status   *string
	Priority *string
	SprintID *string
	Limit    int
	Offset   int
}

// Sprint is the wire representation of the sprints table.
type Sprint struct {
	ID             string     `json:"id"`
	SubscriptionID string     `json:"subscription_id"`
	Name           string     `json:"name"`
	Goal           *string    `json:"goal,omitempty"`
	StartDate      *string    `json:"start_date,omitempty"`
	EndDate        *string    `json:"end_date,omitempty"`
	Status         string     `json:"status"`
	CreatedBy      string     `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at,omitempty"`
}

// CreateSprintInput holds fields required to create a sprint.
type CreateSprintInput struct {
	Name      string
	Goal      *string
	StartDate *string
	EndDate   *string
	CreatedBy string
}

// PatchSprintInput holds optional fields for partial sprint update.
type PatchSprintInput struct {
	Name      *string
	Goal      *string
	StartDate *string
	EndDate   *string
	Status    *string
}

// CustomField is the wire representation of o_execution_custom_field_library.
type CustomField struct {
	ID             string     `json:"id"`
	SubscriptionID string     `json:"subscription_id"`
	FieldName      string     `json:"field_name"`
	Label          string     `json:"label"`
	Type           string     `json:"type"`
	OptionsJSON    *string    `json:"options_json,omitempty"`
	ConfigJSON     *string    `json:"config_json,omitempty"`
	CreatedBy      string     `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at,omitempty"`
}

// CreateCustomFieldInput holds fields required to create a library entry.
type CreateCustomFieldInput struct {
	FieldName   string
	Label       string
	Type        string
	OptionsJSON *string
	ConfigJSON  *string
	CreatedBy   string
}

// PatchCustomFieldInput holds optional fields for partial library update.
type PatchCustomFieldInput struct {
	Label       *string
	OptionsJSON *string
	ConfigJSON  *string
}

// Template is the wire representation of o_execution_work_item_templates.
type Template struct {
	ID             string          `json:"id"`
	SubscriptionID string          `json:"subscription_id"`
	Name           string          `json:"name"`
	Description    *string         `json:"description,omitempty"`
	ItemType       *string         `json:"item_type,omitempty"`
	Fields         []TemplateField `json:"fields,omitempty"`
	CreatedBy      string          `json:"created_by"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	ArchivedAt     *time.Time      `json:"archived_at,omitempty"`
}

// TemplateField is one slot in o_execution_work_item_template_fields.
type TemplateField struct {
	ID             string  `json:"id"`
	TemplateID     string  `json:"template_id"`
	FieldLibraryID string  `json:"field_library_id"`
	FieldName      string  `json:"field_name"`
	Label          string  `json:"label"`
	FieldType      string  `json:"field_type"`
	Position       int     `json:"position"`
	Required       bool    `json:"required"`
	DefaultValue   *string `json:"default_value,omitempty"`
}

// CreateTemplateInput holds fields required to create a template.
type CreateTemplateInput struct {
	Name        string
	Description *string
	ItemType    *string
	CreatedBy   string
}

// AddTemplateFieldInput holds fields required to add a field slot to a template.
type AddTemplateFieldInput struct {
	FieldLibraryID string
	Position       int
	Required       bool
	DefaultValue   *string
}

// FieldValue is the wire representation of a field_values row joined with library metadata.
type FieldValue struct {
	ID             string  `json:"id"`
	WorkItemID     string  `json:"work_item_id"`
	FieldLibraryID *string `json:"field_library_id,omitempty"`
	TemplateID     *string `json:"template_id,omitempty"`
	FieldName      string  `json:"field_name"`
	Label          string  `json:"label"`
	FieldType      string  `json:"field_type"`
	OptionsJSON    *string `json:"options_json,omitempty"`
	StringValue    *string `json:"string_value,omitempty"`
	NumberValue    *string `json:"number_value,omitempty"`
	TextValue      *string `json:"text_value,omitempty"`
	DateValue      *string `json:"date_value,omitempty"`
}

// UpsertFieldValueInput holds the value to write for one field on a work item.
type UpsertFieldValueInput struct {
	FieldLibraryID string
	StringValue    *string
	NumberValue    *string
	TextValue      *string
	DateValue      *string
}

// validFieldTypes is the set of allowed custom field types.
var validFieldTypes = map[string]bool{
	"textbox": true, "richtext": true, "integer": true, "decimal": true,
	"date": true, "boolean": true, "select": true, "multiselect": true,
	"radio": true, "user": true, "url": true,
}

// validItemTypes is the set of allowed item_type discriminators.
var validItemTypes = map[string]bool{
	"epic": true, "story": true,
}

// validStatuses is the set of allowed work item statuses.
var validStatuses = map[string]bool{
	"open": true, "in_progress": true, "done": true, "cancelled": true,
}

// validPriorities is the set of allowed priority values.
var validPriorities = map[string]bool{
	"critical": true, "high": true, "medium": true, "low": true,
}

// validSprintStatuses is the set of allowed sprint statuses.
var validSprintStatuses = map[string]bool{
	"planned": true, "active": true, "completed": true,
}

// typeValueColumn maps a custom field type to its storage column.
// Used to enforce type-routing on field value writes.
func typeValueColumn(fieldType string) string {
	switch fieldType {
	case "integer", "decimal":
		return "number_value"
	case "richtext":
		return "text_value"
	case "date":
		return "date_value"
	default:
		return "string_value"
	}
}
