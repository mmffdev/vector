// Package artefactitems owns the v2 artefacts wire types mirroring
// backend/internal/workitems/types.go. The struct layout MUST NOT drift
// from v1 — any schema change must be applied to both packages in tandem
// until the vector_artefacts cutover is complete.
package artefactitems

import (
	"encoding/json"
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
	// ErrParentFlowStateDerived — caller tried to PATCH flow_state_id on
	// an artefact that has live children. Per the cascade rule, a parented
	// row's flow state is derived from its children (work flows UP), so
	// manual writes are rejected. Handler maps to 409. Server-side gate;
	// the frontend pill row is also locked but defence-in-depth here.
	ErrParentFlowStateDerived = errors.New("flow state is derived from children")
)

// WorkItem is the wire representation of vector_artefacts.artefacts.
//
// Points model: StoryPoints is the manually-entered value; RollupPoints is
// the sum of leaf points across the descendant subtree (only populated for
// items with at least one non-archived child). When RollupPoints is set, it
// is the value the UI shows — the manual value is preserved in the DB but
// shadowed. Tasks may not have manual points (see canHaveManualPoints).
//
// Flow state: FlowStateID is the UUID FK into vector_artefacts.flows_states. FlowStateName
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
	// PLA-0052 follow-up — UUID of the artefact's type row in
	// artefacts_types. Exposed so the inline form can filter the
	// flow-states dropdown to this artefact's type (instead of getting
	// the "first work-scoped type" fallback). Always non-empty post-
	// migration (artefacts.artefact_type_id is NOT NULL).
	ArtefactTypeID string     `json:"artefact_type_id"`
	// DescriptionDoc — TipTap (ProseMirror) JSON document for the rich
	// description. When set takes precedence over Description (TEXT).
	// Wire shape is opaque JSON; the frontend RichTextField owns its
	// schema validation. Backend just stores/returns it verbatim.
	DescriptionDoc *json.RawMessage `json:"description_doc"`
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
	Parent         *ParentRef `json:"parent"`
	RootFeatureID  *string    `json:"root_feature_id"`
	OwnerID        string     `json:"owner_id"`
	Owner          *OwnerRef  `json:"owner"`
	// PLA-0021 / 00460 (WS4-C) — DueDate is the wire form of the new
	// nullable due_date column on vector_artefacts.artefacts. The
	// SELECT casts to ::text so we read YYYY-MM-DD without paying for
	// time.Time/RFC-3339 round-trip. Nil ⇒ JSON `null` (no `omitempty`)
	// so absent vs cleared can both render as the em-dash placeholder.
	DueDate        *string    `json:"due_date"`
	CreatedBy      string     `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at"`
	ChildrenCount  int        `json:"children_count"`
	// PLA-0043 — topology node this artefact is pinned to. Nil for
	// pre-meg-writer rows (zombies that exist in the tenant but are
	// invisible to any per-node clamp). Read-only on the wire today;
	// set at insert time via POST /work-items?meg=<uuid>.
	TopologyNodeID *string `json:"topology_node_id"`
	// ArtefactInlineForm first-class columns (migration 084 + 085).
	// Colour: per-artefact hex override; nil ⇒ inherit from
	// artefact_types.colour. IsBlocked + BlockedReason are independent.
	// MilestoneID + ReleaseID are wire-stable strings of the
	// timeboxes_milestones / timeboxes_releases FK.
	Colour        *string `json:"colour"`
	IsBlocked     bool    `json:"is_blocked"`
	BlockedReason *string `json:"blocked_reason"`
	ReleaseID     *string `json:"release_id"`
	MilestoneID   *string `json:"milestone_id"`
	// Core-field demotion (2026-05-29, migration 147). 18 new columns
	// promoted from the artefacts_fields_library catalogue onto first-
	// class columns on `artefacts`. See spec
	// docs/superpowers/specs/2026-05-29-core-field-demotion-design.md
	// for the rationale and the ColumnSpec mirror in columns.go.
	//
	// Numeric columns (artefacts.numeric) are exposed as *string so the
	// scaler can avoid precision loss and the wire shape mirrors the
	// existing FieldValue.NumberValue pattern.
	DefectSeverity           *string          `json:"defect_severity"`
	DefectStatus             *string          `json:"defect_status"`
	Environment              *string          `json:"environment"`
	EstimateHours            *string          `json:"estimate_hours"`
	EstimateRemaining        *string          `json:"estimate_remaining"`
	EstimateInitial          *string          `json:"estimate_initial"`
	EstimateUpdated          *string          `json:"estimate_updated"`
	IsExpedite               bool             `json:"is_expedite"`
	IsReady                  bool             `json:"is_ready"`
	AffectsDoc               bool             `json:"affects_doc"`
	CountChildTestCases      int              `json:"count_child_test_cases"`
	Notes                    *string          `json:"notes"`
	NotesDoc                 *json.RawMessage `json:"notes_doc"`
	PlannedStartDate         *string          `json:"planned_start_date"`
	PlannedFinishDate        *string          `json:"planned_finish_date"`
	ActualStartDate          *string          `json:"actual_start_date"`
	FlowStateChangedAt       *time.Time       `json:"flow_state_changed_at"`
	StrategicInvestmentGroup *string          `json:"strategic_investment_group"`
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

// ParentRef is the slim parent projection embedded on each WorkItem when
// the row has a non-null parent_artefact_id that resolves to a live (non-
// archived) artefacts row. Sourced via a LEFT JOIN onto self in
// sqlWorkItemColumns. Stays nil for unparented roots and for orphans whose
// parent has been archived since — the frontend renders an em-dash in
// either case.
//
// TypePrefix + KeyNum reconstruct the human-readable parent id (e.g.
// "ST-12") without a second round-trip; Title gives the parent's display
// label so the dense grid can render "ST-12 — Login refactor" inline.
type ParentRef struct {
	ID         string `json:"id"`
	TypePrefix string `json:"type_prefix"`
	KeyNum     int64  `json:"key_num"`
	Title      string `json:"title"`
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
	// SprintIDIsNull, when true, clamps the read to artefacts whose
	// artefacts_id_timebox_sprint IS NULL — i.e. items not yet assigned to
	// any sprint. Used by the /value-sprint backlog tree so the backlog
	// and sprint-panel views are mutually exclusive (an item is either in
	// the backlog or in a sprint, never both). Wire-side this is set by
	// the sentinel value `sprint_id=__none__`; ignored when SprintID is
	// also set (a UUID filter wins; mutually-exclusive at the handler).
	SprintIDIsNull bool
	OwnerID        []uuid.UUID
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
	// artefact_type belongs to this workspace. PLA-0053 / story 00579,
	// updated PLA062 S05.5. Populated by the handler from
	// sentinel.WorkspaceIDFromCtx (seeded by sentinel.Middleware which
	// replaced topology.WorkspaceClampMiddleware). When nil (admin
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
	// TopologyNodeID pins the new artefact to a node in the workspace's
	// topology tree (PLA-0043 writer path). Nil → row inserts with NULL
	// topology_node_id (orphan; visible only to unscoped reads).
	// Non-nil → service validates the node belongs to the resolved
	// workspace AND that the actor holds a grant on it before insert.
	// Failures map to ErrScopeForbidden (no grant / cross-workspace)
	// or ErrScopeNodeNotFound (no such node in tenant).
	TopologyNodeID *string
	// ActorRoleID is the role UUID of the caller, required when
	// TopologyNodeID is set so the per-node CanReadScope grant check
	// can run. Mirrors Filters.ActorRoleID on the read path.
	ActorRoleID uuid.UUID
	// CustomFields carries values for any field_library entries bound
	// to the artefact type via artefacts_types_fields. Written inside
	// the same transaction as the artefact insert so the row + its
	// custom values are committed atomically. Empty / nil → no custom
	// fields written, behaviour matches the legacy create.
	CustomFields []UpsertFieldValueInput
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
	// ArtefactInlineForm first-class columns. Three-state convention
	// (nil ⇒ skip / "" ⇒ clear-to-NULL / non-empty ⇒ write) applies to
	// the four pointers below. IsBlocked is a true tri-state via the
	// *bool pointer so the form can PATCH the toggle without touching
	// reason / colour / FK fields.
	Colour            *string
	IsBlocked         *bool
	BlockedReason     *string
	ReleaseID         *string
	MilestoneID       *string
	OwnedByUserID     *string
	ParentArtefactID  *string
	TopologyNodeID    *string
	// DescriptionDoc — TipTap JSON. Pointer so PATCH can distinguish
	// "unchanged" (nil) from "explicit clear" (a json.RawMessage of
	// length 0 or "null"). The service treats "null" or empty as a
	// SET to NULL; any other payload is stored verbatim.
	DescriptionDoc *json.RawMessage
	// AuthorUserID is the UUID of the caller making the patch. The
	// handler reads it from the auth-context and passes it in; the
	// service uses it as the AuthorUserID on the rule-engine event.
	// uuid.Nil means "unauthenticated path" (rules fire with a zero
	// author — same as before this field existed).
	AuthorUserID uuid.UUID
	// ActorRoleID is the role UUID of the caller, required ONLY when
	// the patch sets TopologyNodeID — the service runs topology.CanReadScope
	// against the new node to gate the write, and that resolver short-
	// circuits on roles.SystemGrpGlobalID (gadmin). Mirrors the field on
	// CreateWorkItemInput which has the same downstream call.
	// Passing uuid.Nil when TopologyNodeID is non-nil returns
	// ErrInvalidInput; passing uuid.Nil when TopologyNodeID is nil is
	// fine (no scope gate runs).
	ActorRoleID uuid.UUID
	// Core-field demotion (2026-05-29, migration 147). Patchable
	// projections of the 18 new first-class columns. Three-state
	// convention (nil ⇒ skip / "" ⇒ clear-to-NULL / non-empty ⇒ write)
	// applies to every *string pointer. *bool pointers are tri-state
	// (nil ⇒ skip / non-nil ⇒ write). *int pointers are tri-state
	// (nil ⇒ skip / non-nil ⇒ write — clearing to NULL not supported
	// because count_child_test_cases is NOT NULL DEFAULT 0).
	//
	// DefectSeverity / DefectStatus carry CHECK constraints in the DB
	// (mig 147); the service mirrors the allowed-value list so a bad
	// patch returns ErrInvalidInput before the round-trip.
	DefectSeverity           *string
	DefectStatus             *string
	Environment              *string
	EstimateHours            *string
	EstimateRemaining        *string
	EstimateInitial          *string
	EstimateUpdated          *string
	IsExpedite               *bool
	IsReady                  *bool
	AffectsDoc               *bool
	CountChildTestCases      *int
	Notes                    *string
	NotesDoc                 *json.RawMessage
	PlannedStartDate         *string
	PlannedFinishDate        *string
	ActualStartDate          *string
	StrategicInvestmentGroup *string
}

// validDefectSeverities mirrors the artefacts_defect_severity_chk
// constraint added in migration 147. Empty string is also accepted as
// the wire "clear-to-NULL" sentinel; the service translates it before
// the constraint check would fire.
var validDefectSeverities = map[string]bool{
	"low": true, "medium": true, "high": true, "critical": true,
}

// validDefectStatuses mirrors the artefacts_defect_status_chk
// constraint added in migration 147.
var validDefectStatuses = map[string]bool{
	"open":        true,
	"triaged":     true,
	"in_progress": true,
	"fixed":       true,
	"verified":    true,
	"closed":      true,
	"wontfix":     true,
	"duplicate":   true,
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

// CustomField is the wire representation of vector_artefacts.artefacts_fields_library.
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

// Template is deprecated — obj_field_templates was dropped in CUT1.1.2. Struct retained for back-compat.
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

// TemplateField is deprecated — obj_field_template_fields was dropped in CUT1.1.2. Struct retained for back-compat.
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

// FieldBinding is the wire representation of one row in the
// artefacts_types_fields binding table joined with its
// artefacts_fields_library row. Returned by
// GET /work-items/types/{typeId}/fields (and the portfolio-items
// sibling) so the frontend create/edit forms can render per-type
// custom-field inputs in the right order, with the right input
// primitive, with options for select/radio/multiselect, and with
// required flags.
//
// Ordered by `position` ASC ON the wire so consumers can render
// without re-sorting.
type FieldBinding struct {
	FieldLibraryID string  `json:"field_library_id"`
	FieldName      string  `json:"field_name"`
	Label          string  `json:"label"`
	FieldType      string  `json:"field_type"`
	OptionsJSON    *string `json:"options_json,omitempty"`
	Position       int     `json:"position"`
	Required       bool    `json:"required"`
	DefaultValue   *string `json:"default_value,omitempty"`
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

// AncestorRef is the slim wire shape returned by GET /work-items/{id}/ancestors.
// Used by ArtefactNodeDiagram on the frontend to render the parent
// chain above the selected artefact. Ordered immediate-parent-first
// (depth=1) up to the topmost ancestor — so callers can render top-
// down by reversing the array.
type AncestorRef struct {
	ID         string  `json:"id"`
	TypePrefix string  `json:"type_prefix"`
	KeyNum     int64   `json:"key_num"`
	Title      string  `json:"title"`
	ParentID   *string `json:"parent_id"`
}

// WorkItemFlowState is a slim projection of flows_states scoped to the
// default flow of an artefact type. The frontend uses this to populate
// the Status pill row in the ObjectTree and the Flow state dropdown in
// the ArtefactInlineForm without needing flows.manage permission.
//
// ArtefactTypeID is populated only by the by-type variant of
// ListFlowStates (when ?artefact_type_id=<list> is supplied). When the
// legacy fallback path runs it stays empty — that path returns states
// for a single implicit type, so grouping isn't meaningful.
type WorkItemFlowState struct {
	ArtefactTypeID string  `json:"artefact_type_id,omitempty"`
	ID             string  `json:"id"`
	Position       int     `json:"flow_position"`
	Name           string  `json:"name"`
	CanonicalCode  string  `json:"canonical_code"`
	// Per-state tenant-set hex (#RRGGBB). NULL when the tenant hasn't
	// overridden the system default — frontend falls back to the
	// canonical_code colour class in that case.
	Colour *string `json:"colour"`
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
//
// AuthorUserID is the UUID of the caller making the write. Handler reads
// it from the auth-context and passes it in; the service uses it as the
// AuthorUserID on the rule-engine event (same pattern as PatchWorkItemInput).
// uuid.Nil means "unauthenticated path" — rules fire with a zero author.
type UpsertFieldValueInput struct {
	FieldLibraryID string
	StringValue    *string
	NumberValue    *string
	TextValue      *string
	DateValue      *string
	AuthorUserID   uuid.UUID
}

// validFieldTypes is the set of allowed custom field types.
var validFieldTypes = map[string]bool{
	"textbox": true, "richtext": true, "integer": true, "decimal": true,
	"date": true, "boolean": true, "select": true, "multiselect": true,
	"radio": true, "user": true, "url": true,
}

// validItemTypesByScope is the per-scope allow-list for the item_type
// discriminator on Create. Scope "work" mirrors the legacy CHECK that
// originally lived on obj_work_items (migration 066) plus the portfolio-item
// escape hatch retained from PLA-0033. Scope "strategy" is intentionally an
// open set — strategy artefacts_types are tenant-extensible (themes,
// objectives, business epics, capabilities, …) and the canonical authority
// is the `artefacts_types` row lookup performed by CreateWorkItem; an extra
// hardcoded list here would force a code change every time a tenant added a
// new strategy type. Returning nil from validItemTypesByScope means "trust
// the DB lookup".
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
