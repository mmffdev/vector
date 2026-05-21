// Slice 2.5 of the ObjectTree refactor (docs/c_c_objecttree_refactor_plan.md).
//
// Column catalogue for /timeboxes/sprints. Same shape + semantics as
// the artefactitems catalogue — see backend/internal/artefactitems/
// columns.go for the rationale and contract.

package timeboxsprints

// ColumnSpec describes one field exposed via the ?fields= contract.
type ColumnSpec struct {
	Name     string `json:"name"`
	AlwaysOn bool   `json:"always_on,omitempty"`
}

// SprintColumns is the allow-list of fields callers may request via
// ?fields= on the /timeboxes/sprints list endpoint. Keep in sync with
// Sprint's json:"..." tags in types.go.
var SprintColumns = []ColumnSpec{
	// Identity (always on)
	{Name: "timeboxes_sprints_id", AlwaysOn: true},

	// Ownership / scope
	{Name: "timeboxes_sprints_id_subscription"},
	{Name: "timeboxes_sprints_id_workspace"},
	{Name: "timeboxes_sprints_id_topology_node"},
	{Name: "timeboxes_sprints_id_user_owner"},

	// Identity / labels
	{Name: "timeboxes_sprints_name"},
	{Name: "timeboxes_sprints_suffix"},

	// Cadence
	{Name: "timeboxes_sprints_cadence_days"},
	{Name: "timeboxes_sprints_date_start"},
	{Name: "timeboxes_sprints_date_end"},

	// Capacity + outcome metrics
	{Name: "timeboxes_sprints_scope"},
	{Name: "timeboxes_sprints_velocity"},
	{Name: "timeboxes_sprints_estimate"},
	{Name: "timeboxes_sprints_creep_by_count"},
	{Name: "timeboxes_sprints_creep_by_estimate"},

	// Lifecycle
	{Name: "timeboxes_sprints_status"},

	// Audit
	{Name: "timeboxes_sprints_created_at"},
	{Name: "timeboxes_sprints_updated_at"},
	{Name: "timeboxes_sprints_archived_at"},

	// Slice 5A — propagation intent
	{Name: "timeboxes_sprints_scope_propagation"},

	// Slice 5B — non-persisted read-time inheritance metadata.
	// These are NOT DB columns; they're stamped onto each row by
	// Service.List when the read came via heartbeat propagation. Listed
	// here so the ?fields= allow-list accepts them (callers explicitly
	// asking for the inheritance fields don't get 400'd) and so they
	// pass through projectSprints unchanged.
	{Name: "origin"},
	{Name: "from_node_id"},
	{Name: "from_node_name"},
}

var sprintColumnSet = func() map[string]bool {
	out := make(map[string]bool, len(SprintColumns))
	for _, c := range SprintColumns {
		out[c.Name] = c.AlwaysOn
	}
	return out
}()

// IsKnownSprintColumn returns true if name is in the catalogue.
func IsKnownSprintColumn(name string) bool {
	_, ok := sprintColumnSet[name]
	return ok
}

// AlwaysOnSprintColumns returns fields the projection must include even
// when callers don't ask for them. Currently just the id.
func AlwaysOnSprintColumns() []string {
	var out []string
	for _, c := range SprintColumns {
		if c.AlwaysOn {
			out = append(out, c.Name)
		}
	}
	return out
}
