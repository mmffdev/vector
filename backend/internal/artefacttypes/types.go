package artefacttypes

import (
	"time"

	"github.com/google/uuid"
)

// ArtefactType is the wire shape returned by GET /_site/artefact-types.
type ArtefactType struct {
	ID             uuid.UUID  `json:"id"`
	Scope          string     `json:"scope"`
	Source         string     `json:"source"`
	Name           string     `json:"name"`
	Prefix         string     `json:"prefix"`
	Description    *string    `json:"description"`
	Colour         *string    `json:"colour"`
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
type PatchInput struct {
	Name        *string `json:"name"`
	Prefix      *string `json:"prefix"`
	Description *string `json:"description"`
	Colour      *string `json:"colour"`
}
