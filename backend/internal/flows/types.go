package flows

// FlowState is one state within a flow, read from vector_artefacts.flow_states.
type FlowState struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`       // "todo" | "in_progress" | "done" | "accepted" | "cancelled"
	SortOrder int     `json:"sort_order"`
	IsInitial bool    `json:"is_initial"`
	Colour    *string `json:"colour,omitempty"`
}

// PatchStateInput is the body accepted by PATCH /_site/flow-states/{id}.
// Only colour is mutable for now.
type PatchStateInput struct {
	Colour *string `json:"colour"` // nil = clear; "#RRGGBB" = set
}

// FlowGroup is one artefact type's complete flow with its ordered states.
type FlowGroup struct {
	FlowID    string      `json:"flow_id"`
	FlowName  string      `json:"flow_name"`
	IsDefault bool        `json:"is_default"`
	TypeID    string      `json:"type_id"`
	TypeName  string      `json:"type_name"`
	TypeScope string      `json:"type_scope"` // "work" | "strategy"
	States    []FlowState `json:"states"`
}

// ListResponse is the wire shape of GET /samantha/v2/flows.
type ListResponse struct {
	Work     []FlowGroup `json:"work"`     // sprint-tracked execution types
	Strategy []FlowGroup `json:"strategy"` // hierarchical portfolio types
}
