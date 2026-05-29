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
	{Name: "affects_doc", Label: "Affects Documentation", Group: "Visual", DefaultVisible: false, Addable: true},

	// Defect
	{Name: "defect_severity", Label: "Defect Severity", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "defect_status", Label: "Defect Status", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "environment", Label: "Environment", Group: "Defect", DefaultVisible: false, Addable: true},

	// Notes (mirror description/description_doc pair)
	{Name: "notes", Label: "Notes", Group: "Content", DefaultVisible: false, Addable: true},
	{Name: "notes_doc", Label: "Notes (Doc)", Group: "Content", DefaultVisible: false, Addable: true},

	// Estimation (additions for the demoted core fields)
	{Name: "estimate_hours", Label: "Estimate Hours", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},
	{Name: "estimate_remaining", Label: "Estimate Remaining", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},
	{Name: "estimate_initial", Label: "Initial Estimate", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},
	{Name: "estimate_updated", Label: "Updated Estimate", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},
	{Name: "count_child_test_cases", Label: "Child Test Cases", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},

	// Planning (additions for the demoted core fields)
	{Name: "planned_start_date", Label: "Planned Start", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "planned_finish_date", Label: "Planned Finish", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "actual_start_date", Label: "Actual Start", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "flow_state_changed_at", Label: "Flow State Changed", Group: "Workflow", DefaultVisible: false, Addable: true},

	// Strategic
	{Name: "strategic_investment_group", Label: "Strategic Investment Group", Group: "Planning", DefaultVisible: false, Addable: true},

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
	{Name: "defect_resolution", Label: "Defect Resolution", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "defect_test_case_status", Label: "Defect Test Case Status", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "defect_fixed_in_build", Label: "Fixed In Build", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "defect_found_in_build", Label: "Found In Build", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "defect_is_release_note", Label: "Release Note", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "defect_steps_to_reproduce", Label: "Steps To Reproduce", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "defect_steps_to_reproduce_doc", Label: "Steps To Reproduce (Doc)", Group: "Defect", DefaultVisible: false, Addable: true},
	{Name: "defect_is_regression", Label: "Regression", Group: "Defect", DefaultVisible: false, Addable: true},
	// Risk (mig 152) — paired bucket/score columns + GENERATED calculated.
	{Name: "risk_resolution", Label: "Risk Resolution", Group: "Risk", DefaultVisible: false, Addable: true},
	{Name: "risk_impact", Label: "Risk Impact", Group: "Risk", DefaultVisible: false, Addable: true},
	{Name: "risk_impact_score", Label: "Risk Impact Score", Group: "Risk", DefaultVisible: false, Addable: true},
	{Name: "risk_probability", Label: "Risk Probability", Group: "Risk", DefaultVisible: false, Addable: true},
	{Name: "risk_probability_score", Label: "Risk Probability Score", Group: "Risk", DefaultVisible: false, Addable: true},
	{Name: "risk_response", Label: "Risk Response", Group: "Risk", DefaultVisible: false, Addable: true},
	{Name: "risk_exposure", Label: "Risk Exposure", Group: "Risk", DefaultVisible: false, Addable: true},
	{Name: "risk_calculated", Label: "Risk Calculated", Group: "Risk", DefaultVisible: false, Addable: true},
	// Submitted-by (mig 153) — defect + risk shared.
	{Name: "submitted_by_user_id", Label: "Submitted By", Group: "People", DefaultVisible: false, Addable: true},
	// Strategy (mig 154).
	{Name: "strategic_job_size", Label: "Strategic Job Size", Group: "Planning", DefaultVisible: false, Addable: true},
	{Name: "strategic_preliminary_estimate_value", Label: "Preliminary Estimate Value", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},
	// Estimate-initial sidecar (mig 155 — ALTERed _estimate_initial to
	// TEXT bucket name; this is the numeric value-per-bucket).
	{Name: "estimate_initial_value", Label: "Initial Estimate Value", Group: "Priority & Estimation", DefaultVisible: false, Addable: true},

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
