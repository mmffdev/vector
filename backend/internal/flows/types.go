package flows

// FlowState is one state within a flow, read from vector_artefacts.flow_states.
type FlowState struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Kind       string  `json:"kind"` // "backlog" | "todo" | "in_progress" | "done" | "accepted" | "cancelled"
	SortOrder  int     `json:"sort_order"`
	IsInitial  bool    `json:"is_initial"`
	IsPullable bool    `json:"is_pullable"`
	Colour     *string `json:"colour,omitempty"`
}

// PatchStateInput is the body accepted by PATCH /_site/flow-states/{id}.
type PatchStateInput struct {
	Colour     *string `json:"colour"`      // nil = clear; "#RRGGBB" = set
	Name       *string `json:"name"`        // nil = no change
	Kind       *string `json:"kind"`        // nil = no change; otherwise one of validKinds
	SortOrder  *int    `json:"sort_order"`  // nil = no change
	IsInitial  *bool   `json:"is_initial"`  // nil = no change
	IsPullable *bool   `json:"is_pullable"` // nil = no change
}

// CreateStateInput is the body accepted by POST /_site/flows/{flowId}/states.
type CreateStateInput struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`        // "backlog"|"todo"|"in_progress"|"done"|"accepted"|"cancelled"
	SortOrder  int    `json:"sort_order"`  // 0 = append after last
	IsInitial  bool   `json:"is_initial"`
	IsPullable bool   `json:"is_pullable"`
}

// CreateTransitionInput is the body accepted by POST /_site/flows/{flowId}/transitions.
type CreateTransitionInput struct {
	FromStateID string `json:"from_state_id"`
	ToStateID   string `json:"to_state_id"`
}

// DeleteTransitionInput is the body accepted by DELETE /_site/flows/{flowId}/transitions.
type DeleteTransitionInput struct {
	FromStateID string `json:"from_state_id"`
	ToStateID   string `json:"to_state_id"`
}

// FlowTransition is one allowed edge within a flow.
type FlowTransition struct {
	From string `json:"from"` // flow_state.id
	To   string `json:"to"`   // flow_state.id
}

// FlowGroup is one artefact type's complete flow with its ordered states.
type FlowGroup struct {
	FlowID      string           `json:"flow_id"`
	FlowName    string           `json:"flow_name"`
	IsDefault   bool             `json:"is_default"`
	TypeID      string           `json:"type_id"`
	TypeName    string           `json:"type_name"`
	TypeScope   string           `json:"type_scope"` // "work" | "strategy"
	States      []FlowState      `json:"states"`
	Transitions []FlowTransition `json:"transitions"`
}

// ListResponse is the wire shape of GET /samantha/v2/flows.
type ListResponse struct {
	Work     []FlowGroup `json:"work"`     // sprint-tracked execution types
	Strategy []FlowGroup `json:"strategy"` // hierarchical portfolio types
}
