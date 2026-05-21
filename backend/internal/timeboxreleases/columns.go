// Slice 2.5 of the ObjectTree refactor (docs/c_c_objecttree_refactor_plan.md).
//
// Column catalogue for /timeboxes/releases. Same shape + semantics as
// the artefactitems and timeboxsprints catalogues — see
// backend/internal/artefactitems/columns.go for the rationale.

package timeboxreleases

// ColumnSpec describes one field exposed via the ?fields= contract.
type ColumnSpec struct {
	Name     string `json:"name"`
	AlwaysOn bool   `json:"always_on,omitempty"`
}

// ReleaseColumns is the allow-list of fields callers may request via
// ?fields= on the /timeboxes/releases list endpoint. Keep in sync with
// Release's json:"..." tags in types.go.
var ReleaseColumns = []ColumnSpec{
	// Identity (always on)
	{Name: "timeboxes_releases_id", AlwaysOn: true},

	// Ownership / scope
	{Name: "timeboxes_releases_id_subscription"},
	{Name: "timeboxes_releases_id_workspace"},
	{Name: "timeboxes_releases_id_topology_node"},
	{Name: "timeboxes_releases_id_user_owner"},

	// Identity / labels
	{Name: "timeboxes_releases_name"},
	{Name: "timeboxes_releases_suffix"},

	// Cadence
	{Name: "timeboxes_releases_cadence_days"},
	{Name: "timeboxes_releases_date_start"},
	{Name: "timeboxes_releases_date_end"},

	// Capacity + outcome metrics
	{Name: "timeboxes_releases_scope"},
	{Name: "timeboxes_releases_velocity"},
	{Name: "timeboxes_releases_estimate"},
	{Name: "timeboxes_releases_creep_by_count"},
	{Name: "timeboxes_releases_creep_by_estimate"},

	// Lifecycle
	{Name: "timeboxes_releases_status"},

	// Audit
	{Name: "timeboxes_releases_created_at"},
	{Name: "timeboxes_releases_updated_at"},
	{Name: "timeboxes_releases_archived_at"},
}

var releaseColumnSet = func() map[string]bool {
	out := make(map[string]bool, len(ReleaseColumns))
	for _, c := range ReleaseColumns {
		out[c.Name] = c.AlwaysOn
	}
	return out
}()

// IsKnownReleaseColumn returns true if name is in the catalogue.
func IsKnownReleaseColumn(name string) bool {
	_, ok := releaseColumnSet[name]
	return ok
}

// AlwaysOnReleaseColumns returns fields the projection must include
// even when callers don't ask for them.
func AlwaysOnReleaseColumns() []string {
	var out []string
	for _, c := range ReleaseColumns {
		if c.AlwaysOn {
			out = append(out, c.Name)
		}
	}
	return out
}
