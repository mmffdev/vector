package artefacttypes

import (
	"time"

	"github.com/google/uuid"
)

// ArtefactType is the wire shape returned by GET /_site/artefact-types.
//
// Slot (PLA-0054 / story 00584) is the project-locked, invisible-to-
// users handle for the canonical work types: wrk_epic, wrk_story,
// wrk_defect, wrk_task, wrk_risk. Custom tenant types have Slot=nil.
// The frontend resolves Slot → ID via the workspace catalogue so chip
// filters and sidecar references stay valid across gadmin renames.
type ArtefactType struct {
	ID             uuid.UUID  `json:"id"`
	Scope          string     `json:"scope"`
	Source         string     `json:"source"`
	Name           string     `json:"name"`
	Prefix         string     `json:"prefix"`
	Description    *string    `json:"description"`
	Colour         *string    `json:"colour"`
	Slot           *string    `json:"slot"`
	ParentTypeID   *uuid.UUID `json:"parent_type_id"`
	AllowsChildren bool       `json:"allows_children"`
	LayerDepth     *int       `json:"layer_depth"`
	// ExecutionParentSlots — work-scope allowed-parent rule: list of parent
	// type slots (wrk_story, wrk_epic, ...) this work type may nest under.
	// Nil for strategy types. Replaces the retired frontend PARENT_PREFIX_MAP.
	ExecutionParentSlots []string   `json:"execution_parent_slots"`
	SortOrder            int        `json:"sort_order"`
	ArchivedAt           *time.Time `json:"archived_at"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// PatchInput is the body accepted by PATCH /_site/artefact-types/{id}.
// All fields are optional pointers; only non-nil fields are applied.
//
// ParentTypeID + LayerDepth use a double-pointer pattern so the wire
// can distinguish three states: absent (leave alone), explicit null
// (clear to NULL), or a value (set). Without this, JSON null is
// indistinguishable from absence at the *string level.
type PatchInput struct {
	Name        *string `json:"name"`
	Prefix      *string `json:"prefix"`
	Description *string `json:"description"`
	Colour      *string `json:"colour"`
	// ParentTypeID — UUID of the type this one nests under in the
	// portfolio/execution ladder. Drives useParentCandidates on the
	// frontend (walks the chain to compute allowed parents for any
	// given type). Tenant-editable since prefix map can't keep up with
	// renames like "Feature" → "Capability". Empty string clears to
	// NULL (top of ladder); a UUID string sets.
	ParentTypeID *string `json:"parent_type_id"`
	// LayerDepth — 0-based depth in the ladder. 0 = top (no parent
	// allowed in the UI). Same three-state convention via *string:
	// empty string clears to NULL, integer-as-string sets.
	LayerDepth *string `json:"layer_depth"`
}

// CreateWorkTypeInput is the body for POST /_site/artefact-types (scope=work).
type CreateWorkTypeInput struct {
	Tag               string    `json:"tag"`
	Name              string    `json:"name"`
	Description       *string   `json:"description"`
	Colour            *string   `json:"colour"`
	BehavesLikeTypeID uuid.UUID `json:"behaves_like_type_id"`
}

// InsertLayerInput is the body for POST /_site/artefact-types/insert-layer
// (and its /preview sibling). A new strategy type is inserted directly above
// ChildTypeID — i.e. between ChildTypeID and ChildTypeID's current strategy
// parent — and every live instance of the child type is given a pass-through
// wrapper of the new type.
type InsertLayerInput struct {
	Tag         string    `json:"tag"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	Colour      *string   `json:"colour"`
	ChildTypeID uuid.UUID `json:"child_type_id"`
}

// ImpactedArtefact is one live child instance that will receive a pass-through
// wrapper. CurrentParentName is the title of its present parent (nil if root).
type ImpactedArtefact struct {
	ID                uuid.UUID `json:"id"`
	Name              string    `json:"name"`
	CurrentParentName *string   `json:"current_parent_name"`
}

// LayerRef is a lightweight {id, name} reference to a strategy type, used in
// the preview to name the parent + child layer either side of the insertion.
type LayerRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// InsertLayerPreview is the non-mutating preview of an insert-layer operation.
// Rejection (when non-nil) explains a BLOCKING hierarchy condition (bounds /
// depth cap) so the flyout can disable Confirm and say why; malformed INPUT is
// surfaced as a 422 ValidationError instead, never here.
type InsertLayerPreview struct {
	ParentLayer      LayerRef           `json:"parent_layer"`
	ChildLayer       LayerRef           `json:"child_layer"`
	Impacted         []ImpactedArtefact `json:"impacted"`
	PassthroughCount int                `json:"passthrough_count"`
	Rejection        *string            `json:"rejection"`
}

// InsertLayerResult is the committed outcome: the created strategy type and the
// number of pass-through wrappers backfilled.
type InsertLayerResult struct {
	NewType      *ArtefactType `json:"new_type"`
	CreatedCount int           `json:"created_count"`
}
