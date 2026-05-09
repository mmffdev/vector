// Package workitemsv2 owns the v2 work-items wire types mirroring
// backend/internal/workitems/types.go. The struct layout MUST NOT drift
// from v1 — any schema change must be applied to both packages in tandem
// until the vector_artefacts cutover is complete.
package workitemsv2

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

// WorkItem is the wire representation of obj_work_items.
//
// Points model: StoryPoints is the manually-entered value; RollupPoints is
// the sum of leaf points across the descendant subtree (only populated for
// items with at least one non-archived child). When RollupPoints is set, it
// is the value the UI shows — the manual value is preserved in the DB but
// shadowed. Tasks may not have manual points (see canHaveManualPoints).
//
// Flow state: FlowStateID is the UUID FK into obj_flow_tenant. FlowStateName
// and FlowStateCode are joined from that row so the frontend can render the
// current state without a second request. Use FlowStateID (not Status) for
// all state reads/writes — Status is the legacy shadow column kept for one
// release while readers migrate (see migration 119 → 120).
type WorkItem struct {
	ID             string     `json:"id"`
	SubscriptionID string     `json:"subscription_id"`
	KeyNum         int64      `json:"key_num"`
	ItemType       string     `json:"item_type"`
	Title          string     `json:"title"`
	Description    *string    `json:"description"`
	Status         string     `json:"status"`
	FlowStateID    string     `json:"flow_state_id"`
	FlowStateName  string     `json:"flow_state_name"`
	FlowStateCode  string     `json:"flow_state_code"`
	Priority       *string    `json:"priority"`
	StoryPoints    *int       `json:"story_points"`
	RollupPoints   *int       `json:"rollup_points"`
	SprintID       *string    `json:"sprint_id"`
	Sprint         *SprintRef `json:"sprint"`
	ParentID       *string    `json:"parent_id"`
	RootFeatureID  *string    `json:"root_feature_id"`
	OwnerID        string     `json:"owner_id"`
	Owner          *OwnerRef  `json:"owner"`
	// PLA-0021 / 00460 (WS4-C) — DueDate is the wire form of the new
	// nullable due_date column on obj_work_items. The
	// SELECT casts to ::text so we read YYYY-MM-DD without paying for
	// time.Time/RFC-3339 round-trip. Nil ⇒ JSON `null` (no `omitempty`)
	// so absent vs cleared can both render as the em-dash placeholder.
	DueDate        *string    `json:"due_date"`
	CreatedBy      string     `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at"`
	ChildrenCount  int        `json:"children_count"`
}

// OwnerRef is the slim user projection embedded on each WorkItem when the
// row's owner_id resolves to a real users row. PLA-0021 / 00459 — replaces
// the synthetic ownerGlyph() placeholder so the wire row carries a stable
// display name + (future) avatar URL the frontend can render directly.
//
// DisplayName is derived in SQL via
//
//	COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), email)
//
// so the field is always a non-empty string for any active user. AvatarURL
// is exposed as a nullable wire field today (the users table has no avatar
// storage column yet); when storage lands, the SELECT changes — the wire
// shape stays stable, no client breakage. Stays nil only when the join
// fails (deleted/missing user); writers continue to set OwnerID directly.
type OwnerRef struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

// SprintRef is the slim sprint projection embedded on each WorkItem when
// the row's sprint_id resolves to a non-archived sprints row. Alias is
// sourced from sprints.name (the sprint's display label). Stays nil when
// sprint_id is NULL or points at an archived/deleted sprint, so the
// frontend renders the em-dash placeholder.
//
// This is intentionally a separate struct from Sprint (the wire shape used
// by the /api/sprints endpoints) — the embedded form is read-only and only
// carries the two fields a row-level renderer needs.
type SprintRef struct {
	ID    string `json:"id"`
	Alias string `json:"alias"`
}

// canHaveManualPoints reports whether an item of the given type may have
// story_points set manually. Tasks are bottom-layer execution units and
// never carry their own points; every other type (epic, story, defect)
// can. For parent items the manual value is preserved but visually
// shadowed by the rollup.
func canHaveManualPoints(itemType string) bool {
	return itemType != "task"
}

// Filters holds query parameters for the v2 list endpoint.
// Expanded in stories 00465–00468; stub for 00464.
type Filters struct {
	ParentID *string
	ItemType *string
	Status   *string
	Priority *string
	SprintID *string
	OwnerID  *string
	Limit    int
	Offset   int
	Sort     string
	Dir      string
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
//
// PLA-0021 / 00460 (WS4-C) — DueDate uses the same three-state convention
// as SprintID: nil ⇒ field absent (no change); non-nil empty string ⇒
// clear to NULL; non-nil non-empty ⇒ parsed as YYYY-MM-DD and written.
type PatchWorkItemInput struct {
	Title       *string
	Description *string
	Status      *string
	FlowStateID *string // UUID — replaces Status; both accepted during transition
	Priority    *string
	StoryPoints *int
	SprintID    *string
	DueDate     *string
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

// CustomField is the wire representation of obj_custom_field_lib.
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

// Template is the wire representation of obj_field_templates.
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

// TemplateField is one slot in obj_field_template_fields.
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

// WorkItemFlowState is a slim projection of obj_flow_tenant scoped to the
// execution_work_items flow for a subscription. The frontend uses this to
// populate the Status dropdown without needing flows.manage permission.
type WorkItemFlowState struct {
	ID            string `json:"id"`
	Position      int    `json:"flow_position"`
	Name          string `json:"name"`
	CanonicalCode string `json:"canonical_code"`
}

// BulkOpResult is the wire shape returned by POST /api/work-items/bulk.
// Successful row count + per-row failure list. The handler always returns
// 200 even with partial failures — callers inspect Failed to learn which
// ids were rejected.
type BulkOpResult struct {
	Updated int           `json:"updated"`
	Failed  []BulkFailure `json:"failed"`
}

// BulkFailure describes one row that the bulk op refused to apply.
// Reason is a short stable string ("forbidden" for cross-tenant or
// non-existent ids; otherwise the underlying validation message).
type BulkFailure struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// WorkItemsSummary is the wire shape for GET /api/v2/work-items/summary.
type WorkItemsSummary struct {
	Total   int `json:"total"`
	Epics   int `json:"epics"`
	Stories int `json:"stories"`
	Tasks   int `json:"tasks"`
	Defects int `json:"defects"`
	Blocked int `json:"blocked"`
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

// validItemTypes is the set of allowed item_type discriminators. Mirrors
// the CHECK in migration 066 (epic | story | task | defect) plus portfolio item (PLA-0033).
var validItemTypes = map[string]bool{
	"epic": true, "story": true, "task": true, "defect": true, "portfolio item": true,
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
