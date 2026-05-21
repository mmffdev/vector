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
// (they share this handler). Domain-specific column descriptions
// (label, group, default visibility) live in the wizard JSON config
// on the frontend — this file is the SERVER-side contract describing
// which keys can be requested.

package artefactitems

// ColumnSpec describes one field exposed via the ?fields= contract.
// Currently a minimal shape — a name plus presence in the allow-list
// is enough for Slice 2.5. Future fields (Slice 4.5 column picker)
// may add `Group`, `DefaultVisible`, etc. The struct grows; clients
// see new fields via the GET /columns endpoint without code change.
type ColumnSpec struct {
	// Name is the JSON key clients use in ?fields= AND the key the
	// server returns under in the response object. Must match the
	// `json:"..."` tag on the corresponding struct field — otherwise
	// projection silently drops the field.
	Name string `json:"name"`

	// AlwaysOn fields are returned even when not in ?fields=. Today
	// only `id` carries this; AlwaysOn defaults to false.
	AlwaysOn bool `json:"always_on,omitempty"`
}

// ArtefactItemColumns is the allow-list of fields callers may request
// via ?fields= on /work-items and /portfolio-items list endpoints.
// Keep in sync with WorkItem's json:"..." tags in types.go — the
// projection step (handler.go) maps directly between these names and
// the marshalled map keys.
var ArtefactItemColumns = []ColumnSpec{
	// Identity (always on)
	{Name: "id", AlwaysOn: true},

	// Numeric + slug identifiers — cheap, returned by default in
	// most callers. NOT always-on; a config that explicitly wants
	// only `id, title` shouldn't pay for these.
	{Name: "key_num"},
	{Name: "type_prefix"},
	{Name: "item_type"},
	{Name: "artefact_type_id"},

	// Content
	{Name: "title"},
	{Name: "description"},
	{Name: "description_doc"},

	// Workflow
	{Name: "status"},
	{Name: "flow_state_id"},
	{Name: "flow_state_name"},
	{Name: "flow_state_code"},

	// Priority + estimation
	{Name: "priority_id"},
	{Name: "priority"},
	{Name: "story_points"},
	{Name: "rollup_points"},

	// Planning
	{Name: "sprint_id"},
	{Name: "sprint"},
	{Name: "release_id"},
	{Name: "milestone_id"},
	{Name: "due_date"},

	// Hierarchy
	{Name: "parent_id"},
	{Name: "root_feature_id"},
	{Name: "children_count"},

	// People
	{Name: "owner_id"},
	{Name: "owner"},
	{Name: "created_by"},

	// Topology
	{Name: "topology_node_id"},

	// Visual / state
	{Name: "colour"},
	{Name: "is_blocked"},
	{Name: "blocked_reason"},

	// Audit
	{Name: "subscription_id"},
	{Name: "created_at"},
	{Name: "updated_at"},
	{Name: "archived_at"},
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
