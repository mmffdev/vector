// Package artefactpriorities owns the per-workspace priorities
// catalogue introduced by PLA-0055 (story 00596). Mirrors the
// artefact_types pattern: gadmin-CRUDable name + sort_order, with a
// project-locked `slot` enum for the 4 system priorities
// (pri_critical, pri_high, pri_medium, pri_low) that consumers
// resolve via the catalogue context.
package artefactpriorities

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound       = errors.New("priority not found")
	ErrSlottedRow     = errors.New("cannot modify slot or archive a slotted priority")
	ErrInvalidInput   = errors.New("invalid input")
)

// Priority is the wire shape returned by GET /_site/artefact-priorities.
//
// Slot is non-null for the 4 system rows (pri_critical, pri_high,
// pri_medium, pri_low) and null for custom tenant rows. Frontend
// `useDefaultPriority` picks the pri_medium row when present.
type Priority struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspace_id"`
	Name        string     `json:"name"`
	Slot        *string    `json:"slot"`
	SortOrder   int        `json:"sort_order"`
	Colour      *string    `json:"colour"`
	ArchivedAt  *time.Time `json:"archived_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// CreateInput is the body accepted by POST /_site/artefact-priorities.
// Slot is intentionally NOT accepted from the caller — only the seed
// migration sets slot values; user-created priorities are always
// custom (slot=null).
type CreateInput struct {
	Name      string  `json:"name"`
	SortOrder int     `json:"sort_order"`
	Colour    *string `json:"colour"`
}

// PatchInput is the body accepted by PATCH /_site/artefact-priorities/{id}.
// Slot is intentionally absent — see CreateInput comment.
type PatchInput struct {
	Name      *string `json:"name"`
	SortOrder *int    `json:"sort_order"`
	Colour    *string `json:"colour"`
}
