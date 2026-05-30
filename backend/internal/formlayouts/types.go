// Package formlayouts owns per-(topology node + artefact type) form-layout
// configs (Form Layout Builder, 2026-05-30 — see
// docs/superpowers/specs/2026-05-30-form-layout-builder-design.md).
//
// A layout is a row-based grid document authored by a team against its
// topology node. It is versioned: saving a new layout for an existing
// (node, type) flips the prior row's is_current=false and inserts a new
// version, so an artefact stamped with artefacts_id_form_layout always
// resolves to the exact shape it was created under (origin-ref
// carry-through).
//
// Sole writer of topology_node_form_layouts. Runs on vaPool
// (vector_artefacts).
package formlayouts

import (
	"time"

	"github.com/google/uuid"
)

// RowTemplate enumerates the fixed grid templates the builder offers.
// Cell spans derive from the template, never free-form — this keeps the
// snap-to-slot model clean and prevents broken layouts.
type RowTemplate string

const (
	Template100    RowTemplate = "100"
	Template5050   RowTemplate = "50-50"
	Template3070   RowTemplate = "30-70"
	Template7030   RowTemplate = "70-30"
	Template303030 RowTemplate = "30-30-30"
)

// templateSpans maps each template to its ordered cell spans (percent).
var templateSpans = map[RowTemplate][]int{
	Template100:    {100},
	Template5050:   {50, 50},
	Template3070:   {30, 70},
	Template7030:   {70, 30},
	Template303030: {33, 33, 33},
}

// Cell is one slot in a row. FieldKey is a core field's stable string key
// (e.g. "title"), or "custom:<artefacts_fields_library_id>", or nil for an
// empty slot.
type Cell struct {
	ID       string  `json:"id"`
	FieldKey *string `json:"fieldKey"`
	Span     int     `json:"span"`
}

// Row is one horizontal band of the form.
type Row struct {
	ID       string      `json:"id"`
	Template RowTemplate `json:"template"`
	Cells    []Cell      `json:"cells"`
}

// LayoutDoc is the JSON document stored in
// topology_node_form_layouts_layout_json.
type LayoutDoc struct {
	Version        int    `json:"version"`
	ArtefactTypeID string `json:"artefactTypeId"`
	Rows           []Row  `json:"rows"`
}

// Layout is a stored row (one version).
type Layout struct {
	ID             uuid.UUID `json:"id"`
	TopologyNodeID uuid.UUID `json:"topologyNodeId"`
	ArtefactTypeID uuid.UUID `json:"artefactTypeId"`
	WorkspaceID    uuid.UUID `json:"workspaceId"`
	Version        int       `json:"version"`
	IsCurrent      bool      `json:"isCurrent"`
	Doc            LayoutDoc `json:"doc"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// CoreFieldDescriptor is one entry in the builder's field sidebar. Kind
// is "core" (a first-class artefacts column) or "custom" (a catalogue
// field bound to the type). IsMandatory core fields block save when absent
// (the "page won't save without them" rule).
type CoreFieldDescriptor struct {
	FieldKey    string `json:"fieldKey"`
	Label       string `json:"label"`
	DataType    string `json:"dataType"`
	Kind        string `json:"kind"` // "core" | "custom"
	Group       string `json:"group"`
	IsMandatory bool   `json:"isMandatory"` // core mandatory → blocks save
}

// mandatoryCoreFieldKeys is the server-side gate: a saved layout MUST place
// every one of these (SERVER IS THE GATE). The client mirrors this for live
// UX, but the server rejects a layout missing any of them.
var mandatoryCoreFieldKeys = []string{"title", "flow_state_name", "owner"}

func isMandatoryCore(key string) bool {
	for _, k := range mandatoryCoreFieldKeys {
		if k == key {
			return true
		}
	}
	return false
}
