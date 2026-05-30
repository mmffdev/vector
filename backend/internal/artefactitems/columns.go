// Slice 2.5 of the ObjectTree refactor (docs/c_c_objecttree_refactor_plan.md).
//
// Column catalogue for /work-items and /portfolio-items (both run on this
// handler). Drives the ?fields=<a,b,c> query-param filter on List
// responses and the GET /<resource>/columns endpoint that exposes the
// allow-list to clients.
//
// Allow-list semantics:
//   • Every field a caller may request must appear here.
//   • Unknown field names → 400 with the offending name. Beats silent
//     fallback that would hide typos.
//   • `id` is always returned, regardless of ?fields=. The catalogue
//     declares it `addable: false, defaultVisible: true` so clients see
//     it in the picker but can't remove it.
//
// The catalogue is the same for both work-items and portfolio-items
// (they share this handler). The catalogue is now the AUTHORITATIVE
// source for label, group, default visibility, and addability — the
// Slice 4.5 column picker on the frontend reads these directly via
// /work-items/columns, so a new field reaches the UI by editing this
// file alone (no parallel frontend constant to keep in sync).

package artefactitems

// ColumnSpec describes one field exposed via the ?fields= contract.
// The struct is consumed both by the server-side projection layer
// (Name + AlwaysOn) and by the frontend column picker (Label / Group /
// DefaultVisible / Addable). The two roles share one struct so that
// adding a column is a single-line change.
type ColumnSpec struct {
	// Name is the JSON key clients use in ?fields= AND the key the
	// server returns under in the response object. Must match the
	// `json:"..."` tag on the corresponding struct field — otherwise
	// projection silently drops the field.
	Name string `json:"name"`

	// AlwaysOn fields are returned even when not in ?fields=. Today
	// only `id` carries this; AlwaysOn defaults to false.
	AlwaysOn bool `json:"always_on,omitempty"`

	// Label is the human-readable string the column picker shows.
	// Empty falls back to Name on the frontend.
	Label string `json:"label,omitempty"`

	// Group is the section heading in the picker dropdown ("Identity",
	// "Workflow", etc.). Empty groups go under "Other" on the frontend.
	Group string `json:"group,omitempty"`

	// DefaultVisible controls whether the column is on by default
	// before any per-user prefs override. AlwaysOn fields are visible
	// regardless of this flag.
	DefaultVisible bool `json:"default_visible,omitempty"`

	// Addable=false means the user cannot toggle this column off in
	// the picker (rendered as a disabled checkbox). Useful for primary
	// identity / title columns the grid needs to function. AlwaysOn
	// implies non-addable.
	Addable bool `json:"addable"`

	// Family tags a column as gated to a specific artefact-type family.
	// The EMPTY string (zero value) means UNIVERSAL — applies to every
	// type. This is ADDITIVE: existing readers (?fields= projection,
	// column picker) ignore Family entirely, so leaving it unset on the
	// vast majority of columns is a no-op for them.
	//
	// ── SOURCE OF TRUTH — migs 158 + 162 ────────────────────────────────
	// The set of gated families and their members mirrors the live DB
	// trigger trg_artefacts_slot_gate_aiu_fn (migration 158, extended by
	// 162), which raises EXCEPTION when an out-of-family core column is
	// non-null for a given artefacts_types_slot / artefacts_types_scope.
	// The trigger is the HARD enforcement; this Family tag is the
	// PRESENTATION + SAVE-VALIDATION mirror so the Form Layout Builder
	// only offers (and only accepts) fields legitimately on the type.
	//
	// THIS MUST STAY IN SYNC WITH THE TRIGGER. The drift-pin test
	// columns_slot_gate_test.go asserts the family→columns sets here
	// exactly match the trigger's families; if it breaks, mig 158/162 and
	// this rubric have diverged and must be reconciled (do not "fix" the
	// test by loosening it).
	//
	// Recognised families (anything else, including "", is universal):
	//   FamilyDefect      — slot == wrk_defect
	//   FamilyRisk        — slot == wrk_risk
	//   FamilyTask        — slot == wrk_task
	//   FamilySubmittedBy — slot IN (wrk_defect, wrk_risk)
	//   FamilyStrategy    — scope == strategy
	Family string `json:"family,omitempty"`
}

// Artefact-type families used by ColumnSpec.Family. Empty string =
// universal (no gate). These mirror the gated families in the slot-gate
// trigger (migs 158 + 162) — see ColumnSpec.Family doc above.
const (
	FamilyDefect      = "defect"
	FamilyRisk        = "risk"
	FamilyTask        = "task"
	FamilySubmittedBy = "submitted_by"
	// FamilyStrategy is the strategy-scope family tag. Its VALUE
	// intentionally differs from the artefacts_types_scope value
	// (ScopeStrategy, in types.go) — the family is gated BY that scope but
	// the tag string is just an internal discriminator.
	FamilyStrategy = "strategic"
)

// Slot constants — the artefacts_types_slot values that gate the work
// families. Strategy types have a NULL slot (slot == "") and are gated by
// scope instead.
const (
	SlotDefect = "wrk_defect"
	SlotRisk   = "wrk_risk"
	SlotTask   = "wrk_task"
	SlotStory  = "wrk_story"
	SlotEpic   = "wrk_epic"
)

// AppliesToType reports whether this column is offered/accepted for an
// artefact type with the given slot + scope. Universal columns (Family
// == "") apply to every type. Gated columns apply only when the type's
// slot/scope matches the family's gate (mirrors migs 158 + 162).
func (c ColumnSpec) AppliesToType(slot, scope string) bool {
	switch c.Family {
	case "":
		return true // universal
	case FamilyDefect:
		return slot == SlotDefect
	case FamilyRisk:
		return slot == SlotRisk
	case FamilyTask:
		return slot == SlotTask
	case FamilySubmittedBy:
		return slot == SlotDefect || slot == SlotRisk
	case FamilyStrategy:
		return scope == ScopeStrategy // ScopeStrategy declared in types.go
	default:
		// Unknown family — fail closed (don't offer it). A new family must
		// be added to this switch AND the drift-pin test.
		return false
	}
}

// ArtefactItemColumns is the allow-list of fields callers may request
// via ?fields= on /work-items and /portfolio-items list endpoints.
// Keep in sync with WorkItem's json:"..." tags in types.go — the
// projection step (handler.go) maps directly between these names and
// the marshalled map keys.
//
// Groups are ordered for the picker UI: Identity → Content → Workflow
// → Planning → Hierarchy → People → Topology → Visual → Audit.
var ArtefactItemColumns = []ColumnSpec{
	// Identity (always on or sticky-by-default)
	{Name: "id", AlwaysOn: true, Label: "ID", Group: "Identity", DefaultVisible: true, Addable: false},
	{Name: "key_num", Label: "#", Group: "Identity", DefaultVisible: true, Addable: true},
	{Name: "type_prefix", Label: "Type Prefix", Group: "Identity", DefaultVisible: false, Addable: true},
	{Name: "item_type", Label: "Type", Group: "Identity", DefaultVisible: true, Addable: true},
	{Name: "artefact_type_id", Label: "Artefact Type ID", Group: "Identity", DefaultVisible: false, Addable: true},

	// Content
	{Name: "title", Label: "Title", Group: "Content", DefaultVisible: true, Addable: false},
	{Name: "description", Label: "Description", Group: "Content", DefaultVisible: false, Addable: true},
	{Name: "description_doc", Label: "Description (Doc)", Group: "Content", DefaultVisible: false, Addable: true},

	// Workflow
	{Name: "status", Label: "Status", Group: "Workflow", DefaultVisible: true, Addable: true},
	{Name: "flow_state_id", Label: "Flow State ID", Group: "Workflow", DefaultVisible: false, Addable: true},
	{Name: "flow_state_name", Label: "Flow State", Group: "Workflow", DefaultVisible: true, Addable: true},
	{Name: "flow_state_code", Label: "Flow State Code", Group: "Workflow", DefaultVisible: false, Addable: true},

	// Priority + estimation
	{Name: "priority_id", Label: "Priority ID", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},
	{Name: "priority", Label: "Priority", Group: "Priority & Estimation", DefaultVisible: true, Addable: true},
	{Name: "story_points", Label: "Story Points", Group: "Priority & Estimation", DefaultVisible: true, Addable: true},
	{Name: "rollup_points", Label: "Rollup Points", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},

	// Planning
	{Name: "sprint_id", Label: "Sprint ID", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "sprint", Label: "Sprint", Group: "Planning", DefaultVisible: true, Addable: true},
	{Name: "release_id", Label: "Release", Group: "Planning", DefaultVisible: true, Addable: true},
	{Name: "milestone_id", Label: "Milestone", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "due_date", Label: "Due Date", Group: "Planning", DefaultVisible: false, Addable: true},

	// Hierarchy
	{Name: "parent_id", Label: "Parent", Group: "Hierarchy", DefaultVisible: true, Addable: true},
	{Name: "root_feature_id", Label: "Root Feature", Group: "Hierarchy", DefaultVisible: false, Addable: true},
	{Name: "children_count", Label: "Children", Group: "Hierarchy", DefaultVisible: false, Addable: true},

	// People
	{Name: "owner_id", Label: "Owner ID", Group: "People", DefaultVisible: false, Addable: true},
	{Name: "owner", Label: "Owner", Group: "People", DefaultVisible: true, Addable: true},
	{Name: "created_by", Label: "Created By", Group: "People", DefaultVisible: false, Addable: true},

	// Topology
	{Name: "topology_node_id", Label: "Topology Node", Group: "Topology", DefaultVisible: false, Addable: true},

	// Visual / state
	{Name: "colour", Label: "Colour", Group: "Visual", DefaultVisible: false, Addable: true},
	{Name: "is_blocked", Label: "Blocked", Group: "Visual", DefaultVisible: true, Addable: true},
	{Name: "blocked_reason", Label: "Blocked Reason", Group: "Visual", DefaultVisible: false, Addable: true},
	// Core-field demotion (2026-05-29) — 18 columns demoted from the
	// custom-fields catalogue onto first-class columns on artefacts.
	// Spec: docs/superpowers/specs/2026-05-29-core-field-demotion-design.md.
	// All default-hidden — adoption is opt-in via the picker until the
	// inline-form / grid renderers ship (TD-INLINE-FORM-NEW-CORE-COLUMNS,
	// TD-GRID-RENDERERS-CORE-BOOLEANS).
	{Name: "is_expedite", Label: "Expedite", Group: "Visual", DefaultVisible: false, Addable: true},
	{Name: "is_ready", Label: "Ready", Group: "Visual", DefaultVisible: false, Addable: true},
	{Name: "affects_doc", Label: "Affects Documentation", Group: "Visual", DefaultVisible: false, Addable: true, Family: FamilyDefect},

	// Defect
	{Name: "defect_severity", Label: "Defect Severity", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "defect_status", Label: "Defect Status", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "environment", Label: "Environment", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},

	// Notes (mirror description/description_doc pair)
	{Name: "notes", Label: "Notes", Group: "Content", DefaultVisible: false, Addable: true},
	{Name: "notes_doc", Label: "Notes (Doc)", Group: "Content", DefaultVisible: false, Addable: true},

	// Estimation (additions for the demoted core fields)
	{Name: "estimate_hours", Label: "Estimate Hours", Group: "Priority & Estimation", DefaultVisible: false, Addable: true, Family: FamilyTask},
	{Name: "estimate_remaining", Label: "Estimate Remaining", Group: "Priority & Estimation", DefaultVisible: false, Addable: true, Family: FamilyTask},
	{Name: "estimate_initial", Label: "Initial Estimate", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},
	{Name: "estimate_updated", Label: "Updated Estimate", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},
	{Name: "count_child_test_cases", Label: "Child Test Cases", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},

	// Planning (additions for the demoted core fields)
	{Name: "planned_start_date", Label: "Planned Start", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "planned_finish_date", Label: "Planned Finish", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "actual_start_date", Label: "Actual Start", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "flow_state_changed_at", Label: "Flow State Changed", Group: "Workflow", DefaultVisible: false, Addable: true},

	// Strategic
	{Name: "strategic_investment_group", Label: "Strategic Investment Group", Group: "Planning", DefaultVisible: false, Addable: true, Family: FamilyStrategy},

	// Rally-screenshots batch (2026-05-29, migrations 150-155). 24
	// new columns spread across universal / defect / risk / strategy
	// / submitted-by families plus the estimate_initial ALTER + new
	// sidecar value column. All default-hidden — opt-in via the
	// picker. Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md
	//
	// Universal (mig 150).
	{Name: "actuals", Label: "Actuals", Group: "Tags & Actuals", DefaultVisible: false, Addable: true},
	{Name: "tags", Label: "Tags", Group: "Tags & Actuals", DefaultVisible: false, Addable: true},
	{Name: "actual_end_date", Label: "Actual End Date", Group: "Planning", DefaultVisible: false, Addable: true},
	// Defect (mig 151).
	{Name: "defect_resolution", Label: "Defect Resolution", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "defect_test_case_status", Label: "Defect Test Case Status", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "defect_fixed_in_build", Label: "Fixed In Build", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "defect_found_in_build", Label: "Found In Build", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "defect_is_release_note", Label: "Release Note", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "defect_steps_to_reproduce", Label: "Steps To Reproduce", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "defect_steps_to_reproduce_doc", Label: "Steps To Reproduce (Doc)", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "defect_is_regression", Label: "Regression", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	// Risk (mig 152) — paired bucket/score columns + GENERATED calculated.
	// risk_calculated is GENERATED (self-gates via NULL inputs) so the
	// trigger does NOT list it; we tag it FamilyRisk anyway so the builder
	// never offers a read-only generated column on a non-risk type. Go is
	// intentionally STRICTER than the trigger here — safe (presentation
	// hides it; the trigger would have allowed a NULL). Pinned in the
	// drift test as a documented exception.
	{Name: "risk_resolution", Label: "Risk Resolution", Group: "Risk", DefaultVisible: false, Addable: true, Family: FamilyRisk},
	{Name: "risk_impact", Label: "Risk Impact", Group: "Risk", DefaultVisible: false, Addable: true, Family: FamilyRisk},
	{Name: "risk_impact_score", Label: "Risk Impact Score", Group: "Risk", DefaultVisible: false, Addable: true, Family: FamilyRisk},
	{Name: "risk_probability", Label: "Risk Probability", Group: "Risk", DefaultVisible: false, Addable: true, Family: FamilyRisk},
	{Name: "risk_probability_score", Label: "Risk Probability Score", Group: "Risk", DefaultVisible: false, Addable: true, Family: FamilyRisk},
	{Name: "risk_response", Label: "Risk Response", Group: "Risk", DefaultVisible: false, Addable: true, Family: FamilyRisk},
	{Name: "risk_exposure", Label: "Risk Exposure", Group: "Risk", DefaultVisible: false, Addable: true, Family: FamilyRisk},
	{Name: "risk_calculated", Label: "Risk Calculated", Group: "Risk", DefaultVisible: false, Addable: true, Family: FamilyRisk},
	// Submitted-by (mig 153) — defect + risk shared.
	{Name: "submitted_by_user_id", Label: "Submitted By", Group: "People", DefaultVisible: false, Addable: true, Family: FamilySubmittedBy},
	// Strategy (mig 154).
	{Name: "strategic_job_size", Label: "Strategic Job Size", Group: "Planning", DefaultVisible: false, Addable: true, Family: FamilyStrategy},
	{Name: "strategic_preliminary_estimate_value", Label: "Preliminary Estimate Value", Group: "Priority & Estimation", DefaultVisible: false, Addable: true, Family: FamilyStrategy},
	// Estimate-initial sidecar (mig 155 — ALTERed _estimate_initial to
	// TEXT bucket name; this is the numeric value-per-bucket).
	{Name: "estimate_initial_value", Label: "Initial Estimate Value", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},

	// Fourth-wave demotion batch (mig 162, 2026-05-29). FOUR new core
	// columns demoted from the artefacts_fields_library catalogue.
	// mig 163 archives the redundant catalogue rows that motivated this.
	//   defect_browser                       (defect-only, gated by trigger)
	//   work_accepted_date                   (universal)
	//   strategic_value_stream_identifier    (strategy-only, gated by trigger)
	//   strategic_investment_weight          (strategy-only, gated by trigger;
	//                                         vocab undefined — see
	//                                         TD-STRATEGIC-INVESTMENT-WEIGHT-VOCAB)
	{Name: "defect_browser", Label: "Browser", Group: "Defect", DefaultVisible: false, Addable: true, Family: FamilyDefect},
	{Name: "work_accepted_date", Label: "Work Accepted Date", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "strategic_value_stream_identifier", Label: "Strategic Value Stream", Group: "Planning", DefaultVisible: false, Addable: true, Family: FamilyStrategy},
	{Name: "strategic_investment_weight", Label: "Strategic Investment Weight", Group: "Planning", DefaultVisible: false, Addable: true, Family: FamilyStrategy},

	// Flow State Change Owner (mig 164, 2026-05-30) — promoted from the
	// catalogue to a universal user-FK core column (assigned to ALL
	// artefact types; no slot/scope gate). Mirrors submitted_by_user_id.
	{Name: "flow_state_change_owner_user_id", Label: "Flow State Change Owner", Group: "People", DefaultVisible: false, Addable: true},

	// Audit
	{Name: "subscription_id", Label: "Subscription", Group: "Audit", DefaultVisible: false, Addable: true},
	{Name: "created_at", Label: "Created", Group: "Audit", DefaultVisible: false, Addable: true},
	{Name: "updated_at", Label: "Updated", Group: "Audit", DefaultVisible: false, Addable: true},
	{Name: "archived_at", Label: "Archived", Group: "Audit", DefaultVisible: false, Addable: true},
}

// columnNameSet returns the catalogue as a name → AlwaysOn map for
// fast membership + always-on checks in the handler. Computed once at
// package init time; callers should not mutate.
var artefactItemColumnSet = func() map[string]bool {
	out := make(map[string]bool, len(ArtefactItemColumns))
	for _, c := range ArtefactItemColumns {
		out[c.Name] = c.AlwaysOn
	}
	return out
}()

// IsKnownArtefactItemColumn returns true if name is in the catalogue.
// Handler uses this to validate ?fields= entries before applying.
func IsKnownArtefactItemColumn(name string) bool {
	_, ok := artefactItemColumnSet[name]
	return ok
}

// IsAlwaysOnArtefactItemColumn returns true if the field is returned
// regardless of ?fields= — currently just "id".
func IsAlwaysOnArtefactItemColumn(name string) bool {
	return artefactItemColumnSet[name]
}

// AlwaysOnArtefactItemColumns returns the set of fields the projection
// must include even when callers don't ask for them. Used to seed the
// effective field set when ?fields= is present.
func AlwaysOnArtefactItemColumns() []string {
	var out []string
	for _, c := range ArtefactItemColumns {
		if c.AlwaysOn {
			out = append(out, c.Name)
		}
	}
	return out
}

// CoreColumnsForType returns the catalogue columns applicable to an
// artefact type with the given slot + scope, in catalogue order. Used by
// the Form Layout Builder (formlayouts) to scope the sidebar's core-field
// list to the type — a Defect never sees risk/strategic columns, an Epic
// never sees Steps-to-Reproduce, etc. Universal columns are always
// included. Mirrors the slot-gate trigger (migs 158 + 162).
func CoreColumnsForType(slot, scope string) []ColumnSpec {
	out := make([]ColumnSpec, 0, len(ArtefactItemColumns))
	for _, c := range ArtefactItemColumns {
		if c.AppliesToType(slot, scope) {
			out = append(out, c)
		}
	}
	return out
}

// compulsoryUniversalKeys are compulsory on EVERY artefact type (always
// placed on a saved form layout, regardless of slot/scope). This is the
// SERVER-IS-THE-GATE "Required fields" locked-group set; the marker lives
// in this Go catalogue for now (a future migration may move it to the DB).
//
// Each key listed here MUST resolve to a real ColumnSpec AND pass
// AppliesToType for the universal case (Family == "" ⇒ always true).
// CompulsoryFieldsForType filters the raw list against the catalogue so a
// typo'd or non-universal key can never silently demand a field that the
// builder cannot place. The drift-pin test
// (formlayouts/compulsory_test.go) asserts every surviving key resolves +
// applies + is not skipFromBuilder'd.
var compulsoryUniversalKeys = []string{
	"title", "description", "owner", "created_by", "parent_id", "tags",
	"notes", "topology_node_id", "is_blocked", "blocked_reason",
	"flow_state_changed_at", "flow_state_name",
	"colour", "children_count",
	// dropped: flow_state_change_owner_user_id — skipFromBuilder'd in
	// formlayouts (raw user-FK, rendered nowhere in the builder); the builder
	// cannot place it, so it cannot be a compulsory-on-layout field.
}

// compulsoryStrategyKeys add to the universal set for strategy types
// (scope == ScopeStrategy). Filtered against the catalogue + AppliesToType
// by CompulsoryFieldsForType.
var compulsoryStrategyKeys = []string{
	"is_ready", "estimate_initial", "estimate_updated",
	"planned_start_date", "planned_finish_date", "actual_start_date",
	"actual_end_date", "due_date", "strategic_investment_group",
	"strategic_investment_weight", "strategic_job_size",
	"strategic_value_stream_identifier", "release_id",
	// dropped: milestone_id — skipFromBuilder'd in formlayouts (raw FK,
	// rendered as an internal id, not offered in the builder sidebar).
}

// compulsoryDefectKeys add to the universal set for defect types
// (slot == SlotDefect).
var compulsoryDefectKeys = []string{
	"sprint", "release_id", "defect_severity",
	"defect_status", "defect_resolution", "is_expedite", "rollup_points",
	"work_accepted_date",
	// dropped: milestone_id — skipFromBuilder'd in formlayouts (raw FK).
	// dropped: submitted_by_user_id — skipFromBuilder'd in formlayouts (raw
	//          user-FK, rendered nowhere in the builder).
}

// compulsoryEpicKeys add to the universal set for epic types (slot == SlotEpic).
var compulsoryEpicKeys = []string{
	"sprint", "release_id", "story_points",
	"is_expedite", "work_accepted_date", "rollup_points",
	// dropped: milestone_id — skipFromBuilder'd in formlayouts (raw FK).
}

// compulsoryStoryKeys add to the universal set for story types (slot == SlotStory).
var compulsoryStoryKeys = []string{
	"sprint", "release_id", "story_points",
	"is_expedite", "work_accepted_date",
	// dropped: milestone_id — skipFromBuilder'd in formlayouts (raw FK).
}

// compulsoryTaskKeys add to the universal set for task types (slot == SlotTask).
var compulsoryTaskKeys = []string{
	"sprint", "release_id", "estimate_hours",
	// dropped: milestone_id — skipFromBuilder'd in formlayouts (raw FK).
}

// compulsoryRiskKeys add to the universal set for risk types (slot == SlotRisk).
var compulsoryRiskKeys = []string{
	"sprint", "release_id", "estimate_hours",
	"risk_impact", "risk_impact_score", "risk_probability",
	"risk_probability_score", "risk_response", "risk_exposure",
	"risk_calculated", "risk_resolution",
	"work_accepted_date",
	// dropped: milestone_id — skipFromBuilder'd in formlayouts (raw FK).
	// dropped: submitted_by_user_id — skipFromBuilder'd in formlayouts (raw
	//          user-FK, rendered nowhere in the builder).
}

// CompulsoryFieldsForType returns the set of core field keys that a saved
// form layout MUST place for an artefact type with the given slot + scope.
// It is the universal set ∪ the per-family set, each filtered to keys that
// (a) resolve to a real ColumnSpec and (b) pass AppliesToType(slot, scope).
//
// Keys are keyed by SLOT for work types (Story vs Epic share scope==work
// but differ by slot) and by SCOPE for strategy. A key that fails to
// resolve or does not apply to the type is DROPPED here — the rubric is
// reconciled against the catalogue (the source of truth), never the other
// way around.
//
// NOTE: this function does NOT apply the formlayouts skipFromBuilder filter
// — that predicate lives in the formlayouts package. Callers in formlayouts
// (CoreFields, validateDoc) apply skipFromBuilder at their call site so they
// never demand a field the builder cannot place.
func CompulsoryFieldsForType(slot, scope string) map[string]bool {
	raw := append([]string(nil), compulsoryUniversalKeys...)
	switch {
	case scope == ScopeStrategy:
		raw = append(raw, compulsoryStrategyKeys...)
	case slot == SlotDefect:
		raw = append(raw, compulsoryDefectKeys...)
	case slot == SlotEpic:
		raw = append(raw, compulsoryEpicKeys...)
	case slot == SlotStory:
		raw = append(raw, compulsoryStoryKeys...)
	case slot == SlotTask:
		raw = append(raw, compulsoryTaskKeys...)
	case slot == SlotRisk:
		raw = append(raw, compulsoryRiskKeys...)
	}
	out := make(map[string]bool, len(raw))
	for _, k := range raw {
		spec, ok := columnSpecByName[k]
		if !ok {
			continue // dropped: key not in the catalogue
		}
		if !spec.AppliesToType(slot, scope) {
			continue // dropped: key does not apply to this type
		}
		out[k] = true
	}
	return out
}

// columnSpecByName indexes the catalogue by Name for O(1) lookup. Computed
// once at init.
var columnSpecByName = func() map[string]ColumnSpec {
	out := make(map[string]ColumnSpec, len(ArtefactItemColumns))
	for _, c := range ArtefactItemColumns {
		out[c.Name] = c
	}
	return out
}()

// CoreColumnSpecForName returns the ColumnSpec for a core field name. The
// second return is false when the name is not in the catalogue (caller
// should treat that as an unknown-field error). Used by the formlayouts
// save validator to check AppliesToType for each placed core field.
func CoreColumnSpecForName(name string) (ColumnSpec, bool) {
	c, ok := columnSpecByName[name]
	return c, ok
}
