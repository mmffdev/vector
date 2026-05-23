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
	SortOrder      int        `json:"sort_order"`
	ArchivedAt     *time.Time `json:"archived_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
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
