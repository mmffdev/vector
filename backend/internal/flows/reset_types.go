package flows

// ResetPreviewInput is the body accepted by POST /_site/flows/reset/preview
// and /apply. The artefact type is the unit of reset — its single default
// flow is rewritten back to the snapshot in flow_defaults.
type ResetPreviewInput struct {
	ArtefactTypeID string `json:"artefact_type_id"`
}

// ResetPillDelta describes one pill change planned by Preview.
//
// Action is one of:
//   - "keep"   — pill exists in both live and snapshot, name/kind/sort_order match.
//   - "update" — pill exists in both, but one or more attributes differ.
//   - "add"    — pill in snapshot, missing from live (will be inserted).
//   - "remove" — pill in live, missing from snapshot (will be archived).
type ResetPillDelta struct {
	Action            string `json:"action"`
	LiveStateID       string `json:"live_state_id,omitempty"` // empty for "add"
	Name              string `json:"name"`
	Kind              string `json:"kind"`
	SortOrder         int    `json:"sort_order"`
	IsInitial         bool   `json:"is_initial"`
	IsPullable        bool   `json:"is_pullable"`
	SuccessorStateID  string `json:"successor_state_id,omitempty"`  // for "remove": where artefacts move to
	SuccessorStateName string `json:"successor_state_name,omitempty"`
}

// ResetTransitionDelta describes one transition change.
//
// Action is "add" or "remove".
type ResetTransitionDelta struct {
	Action       string `json:"action"`
	FromStateID  string `json:"from_state_id"`
	ToStateID    string `json:"to_state_id"`
	FromName     string `json:"from_name"`
	ToName       string `json:"to_name"`
}

// ResetArtefactImpact describes how many live artefacts will rebind off a
// removed state and where they will land.
type ResetArtefactImpact struct {
	RemovedStateID    string `json:"removed_state_id"`
	RemovedStateName  string `json:"removed_state_name"`
	SuccessorStateID  string `json:"successor_state_id"`
	SuccessorStateName string `json:"successor_state_name"`
	ArtefactCount     int    `json:"artefact_count"`
}

// ResetPreview is the response shape of POST /_site/flows/reset/preview.
type ResetPreview struct {
	ArtefactTypeID   string                 `json:"artefact_type_id"`
	ArtefactTypeName string                 `json:"artefact_type_name"`
	FlowID           string                 `json:"flow_id"`
	FlowName         string                 `json:"flow_name"`

	Pills            []ResetPillDelta       `json:"pills"`
	Transitions      []ResetTransitionDelta `json:"transitions"`
	ArtefactImpacts  []ResetArtefactImpact  `json:"artefact_impacts"`

	// AlreadyAtDefault is true when there is nothing to change.
	AlreadyAtDefault bool `json:"already_at_default"`
}

// ResetApplyResult is the response shape of POST /_site/flows/reset/apply.
type ResetApplyResult struct {
	ArtefactTypeID    string `json:"artefact_type_id"`
	FlowID            string `json:"flow_id"`
	PillsAdded        int    `json:"pills_added"`
	PillsUpdated      int    `json:"pills_updated"`
	PillsRemoved      int    `json:"pills_removed"`
	TransitionsAdded  int    `json:"transitions_added"`
	TransitionsRemoved int   `json:"transitions_removed"`
	ArtefactsRebound  int    `json:"artefacts_rebound"`
}
