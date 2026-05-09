package flows

// FlowState is one state within a flow, read from vector_artefacts.flow_states.
type FlowState struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`       // "todo" | "in_progress" | "done" | "cancelled"
	SortOrder int     `json:"sort_order"`
	IsInitial bool    `json:"is_initial"`
	Colour    *string `json:"colour,omitempty"`
}

// FlowGroup is one artefact type's complete flow with its ordered states.
type FlowGroup struct {
	FlowID    string      `json:"flow_id"`
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
