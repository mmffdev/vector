// Package artefactitems owns the v2 artefacts wire types mirroring
// backend/internal/workitems/types.go. The struct layout MUST NOT drift
// from v1 — any schema change must be applied to both packages in tandem
// until the vector_artefacts cutover is complete.
package artefactitems

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound         = errors.New("work item not found")
	ErrSprintNotFound   = errors.New("sprint not found")
	ErrFieldNotFound    = errors.New("custom field not found")
	ErrTemplateNotFound = errors.New("template not found")
	ErrConflict         = errors.New("conflict: resource already exists or constraint violated")
	ErrInvalidInput     = errors.New("invalid input")
	ErrWrongValueColumn = errors.New("value column does not match field type")
	// ErrScopeForbidden — caller asked for ?scope=<id> but does not hold
	// a grant that reaches that node. Handler maps to 403 (PLA-0043).
	ErrScopeForbidden = errors.New("scope read denied")
	// ErrScopeNodeNotFound — ?scope=<id> points at a node missing or in
	// another tenant. Handler maps to 404 (PLA-0043).
	ErrScopeNodeNotFound = errors.New("scope node not found")
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
	TypePrefix     string     `json:"type_prefix"`
	Title          string     `json:"title"`
	Description    *string    `json:"description"`
	Status         string     `json:"status"`
	FlowStateID    string     `json:"flow_state_id"`
	FlowStateName  string     `json:"flow_state_name"`
	FlowStateCode  string     `json:"flow_state_code"`
	// PLA-0055 / story 00595+00597 — priority is a UUID FK into
	// artefact_priorities, not a slug. PriorityID is the wire form
	// of artefacts.priority_id (always non-empty post-migration —
	// NOT NULL FK). Priority carries the joined display name +
	// slot for the row renderer; nil only if a future archive flow
	// orphans an artefact (shouldn't happen — Archive returns 403
	// for slotted rows and the FK is not ON DELETE SET NULL).
	PriorityID     string        `json:"priority_id"`
	Priority       *PriorityRef  `json:"priority"`
	StoryPoints    *int          `json:"story_points"`
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

// PriorityRef is the slim priority projection embedded on each WorkItem.
// PLA-0055 / story 00595. Sourced from a LEFT JOIN on artefact_priorities
// via artefacts.priority_id. Name is the gadmin-editable display label;
// Slot is the project-locked handle (one of pri_critical/pri_high/
// pri_medium/pri_low for system rows, null for tenant-added custom
// priorities) — frontend renderers branch on slot for stable colour
// mapping that survives display renames.
type PriorityRef struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Slot  *string `json:"slot"`
	Order int     `json:"sort_order"`
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
//
// PLA-0054 / story 00586 + PLA-0055 / story 00597: multi-value list
// types replace the per-field *string singles. ItemType / Status /
// Priority / OwnerID are all []uuid.UUID — UUID-on-the-wire so gadmin
// display-name renames cannot break filters, and tenant-added custom
// priorities/types/states flow through without code changes.
//
// Empty list (len==0) means "no filter on this field"; nil and len==0
// behave identically and are stored interchangeably.
type Filters struct {
	ParentID *string
	ItemType []uuid.UUID
	Status   []uuid.UUID
	Priority []uuid.UUID
	SprintID *string
	OwnerID  []uuid.UUID
	// ScopeNodeID, when set, clamps the read to artefacts whose
	// topology_node_id is `ScopeNodeID` or any live descendant of it
	// (PLA-0043). NULL topology_node_id rows are excluded when scope is
	// active. The service calls CanReadScope before executing the
	// query; ActorUserID and ActorRoleID MUST be set whenever ScopeNodeID
	// is, otherwise the service returns ErrInvalidInput.
	ScopeNodeID  *string
	ActorUserID  *string   // required when ScopeNodeID is set
	ActorRoleID  uuid.UUID // required when ScopeNodeID is set; uuid.Nil means "not provided"
	// ScopeDirection controls which nodes the scope clamp resolves to.
	// "descend" (default, empty string): rootNodeID + all live descendants.
	// "ascend": strict ancestor chain — rootNodeID + every ancestor up to
	// the subscription root, no siblings. Stored in the user's server
	// preference (key "scope.direction"); forwarded via ?dir= query param.
	ScopeDirection string // "descend" | "ascend"; empty == "descend"
	// WorkspaceID, when set, clamps reads to artefacts whose
	// artefact_type belongs to this workspace. PLA-0053 / story 00579.
	// Populated by the handler from topology.WorkspaceIDFromCtx (seeded
	// by WorkspaceClampMiddleware per story 00578). When nil (admin
	// tools / migrations bypassing the middleware), reads fall back to
	// subscription-only — same shape as artefacttypes.Service.List.
	WorkspaceID *string
	Limit       int
	Offset      int
	Sort        string
	Dir         string
}

// CreateWorkItemInput holds fields required to create a work item.
//
// PLA-0055 / story 00595+00597: PriorityID is the artefact_priorities
// UUID, replacing the legacy Priority slug string. Nil falls back to
// the workspace's default priority (pri_medium slot) resolved by the
// service.
type CreateWorkItemInput struct {
	ItemType    string
	Title       string
	Description *string
	Status      string
	PriorityID  *string
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
	// PLA-0055 / story 00595+00597 — PriorityID is the artefact_priorities
	// UUID. Three-state: nil ⇒ field absent (no change); non-nil empty
	// string ⇒ historically used to clear, but priority_id is NOT NULL
	// post-migration so empty-string is now a validation error;
	// non-nil non-empty ⇒ UUID-parsed and written.
	PriorityID  *string
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

// WorkItemsSummary is the wire shape for GET /samantha/v2/{work-items,
// portfolio-items}/summary.
//
// History: previously carried fixed-shape fields (Epics/Stories/Tasks/
// Defects, plus Risks per PLA-0052) alongside ByType. That fixed shape
// was TD-WORKITEMS-GENERIC: every new artefact type forced a 4-file Go
// change. Paid down 2026-05-16 by deleting the fixed fields entirely;
// callers now read ByType[<lowercased type name>] for every type
// (work-items page, portfolio-items page, etc.). Blocked stays because
// it's a status flag, not a type; Total is the cross-cutting aggregate.
//
// Adding a new artefact type now requires only: (a) seed the type row,
// (b) front-end reads ByType['<name>']. No Go change.
type WorkItemsSummary struct {
	Total   int            `json:"total"`
	Blocked int            `json:"blocked"`
	ByType  map[string]int `json:"by_type"`
}

// RisksSummary is the wire shape for GET /_site/risks/summary (PLA-0052
// Story 10). Severity × likelihood matrix aggregator for the /risk page
// header. Frontend-only consumer for now; public surface (/samantha/v2)
// deferred until n8n needs it.
//
// Matrix layout (3×3, severity rows × likelihood columns):
//
//	            likelihood=high  likelihood=medium  likelihood=low
//	severity=high   matrix[0][0]   matrix[0][1]       matrix[0][2]
//	severity=medium matrix[1][0]   matrix[1][1]       matrix[1][2]
//	severity=low    matrix[2][0]   matrix[2][1]       matrix[2][2]
//
// "critical" severity is reported via BySeverity.Critical but does not
// participate in the 3×3 matrix; the UI shows critical as a separate banner.
type RisksSummary struct {
	Total        int                  `json:"total"`
	Open         int                  `json:"open"`
	BySeverity   RisksSummaryBySev    `json:"by_severity"`
	ByLikelihood RisksSummaryByLik    `json:"by_likelihood"`
	Matrix       [3][3]int            `json:"matrix"`
}

type RisksSummaryBySev struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
}

type RisksSummaryByLik struct {
	High   int `json:"high"`
	Medium int `json:"medium"`
	Low    int `json:"low"`
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

// validItemTypesByScope is the per-scope allow-list for the item_type
// discriminator on Create. Scope "work" mirrors the legacy CHECK on
// obj_work_items (migration 066) plus the portfolio-item escape hatch
// retained from PLA-0033. Scope "strategy" is intentionally an open set —
// strategy artefacts_types are tenant-extensible (themes, objectives,
// business epics, capabilities, …) and the canonical authority is the
// `artefacts_types` row lookup performed by CreateWorkItem; an extra
// hardcoded list here would force a code change every time a tenant
// added a new strategy type. Returning nil from validItemTypesByScope
// means "trust the DB lookup".
//
// B21 (PLA-0037): introduced when artefactitems became scope-parameterised.
var validItemTypesByScope = map[string]map[string]bool{
	"work": {
		"epic": true, "story": true, "task": true, "defect": true, "risk": true, "portfolio item": true,
	},
	// "strategy": nil — DB row lookup is authoritative, no static allow-list.
}

// validItemTypes is retained for back-compat with any in-package callers
// that still treat the work scope as default. Prefer validItemTypesByScope
// keyed by Service.scope at the call-site.
var validItemTypes = validItemTypesByScope["work"]

// validStatuses is the set of allowed work item statuses.
var validStatuses = map[string]bool{
	"open": true, "in_progress": true, "done": true, "cancelled": true,
}

// Priority enum allow-list removed by PLA-0055 / story 00595+00597:
// priority is now a UUID FK to artefact_priorities and the FK
// constraint plus uuid.Parse() at the edge replace the slug allow-list.

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
