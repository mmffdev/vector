// Package dependencies is the sole writer for the artefact dependency
// substrate introduced by PLA074 / B23.
//
// The three persisted tables (vector_artefacts):
//   - artefact_dependency_maps        (mig 173) — named container per
//     topology node; multiple maps may overlap and share artefacts.
//   - artefact_dependency_edges       (mig 174) — directed
//     finish_to_start OR non-directional parallel relationships
//     between two artefacts inside one map. pair_low/pair_high are
//     GENERATED STORED for cross-kind uniqueness.
//   - artefact_dependency_edge_events (mig 175) — append-only audit
//     of every edge mutation, capturing the actor + the Sentinel
//     clamp snapshot at write time.
//
// Sentinel discipline. Every read and write reads the resolved clamp
// from r.Context() via the sentinel package — sole-writer semantics
// hold at the package boundary, NOT at the constructor seam (matches
// the live artefactpriorities / artefactitems pattern).
//
// The package mirrors the polymorphicrefs tx-discipline shape: edge
// writes are wrapped in a tx that holds FOR UPDATE on the parent map
// row for the duration of the cycle check + uniqueness check.
package dependencies

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Error vocabulary returned by the service. HTTP handler maps these
// to status codes (404 / 403 / 409 / 422 etc.).
var (
	ErrNotFound          = errors.New("dependency record not found")
	ErrInvalidInput      = errors.New("invalid input")
	ErrSelfLoop          = errors.New("edge endpoints must be distinct")
	ErrDuplicateEdge     = errors.New("duplicate edge in this map")
	ErrCycle             = errors.New("cycle rejected")
	ErrEndpointNotInScope = errors.New("edge endpoint not visible in caller scope")
	ErrArchived          = errors.New("record is archived")
	ErrSchemaMissing     = errors.New("dependency schema missing — apply migrations 173–175")
)

// EdgeKind enumerates the persisted edge kinds. Stored as TEXT in
// vector_artefacts; the CHECK on artefact_dependency_edges_kind pins
// the same vocabulary at the DB layer.
type EdgeKind string

const (
	EdgeKindFinishToStart EdgeKind = "finish_to_start"
	EdgeKindParallel      EdgeKind = "parallel"
)

// IsValid reports whether the kind is one of the persisted vocabulary
// values. New kinds must be added here AND to the CHECK on the table.
func (k EdgeKind) IsValid() bool {
	switch k {
	case EdgeKindFinishToStart, EdgeKindParallel:
		return true
	default:
		return false
	}
}

// Map is the wire shape for a dependency map. Returned by
// GET /_site/dependencies/maps and GET /_site/dependencies/maps/{id}.
type Map struct {
	ID             uuid.UUID  `json:"id"`
	SubscriptionID uuid.UUID  `json:"subscription_id"`
	WorkspaceID    uuid.UUID  `json:"workspace_id"`
	TopologyNodeID uuid.UUID  `json:"topology_node_id"`
	RootArtefactID *uuid.UUID `json:"root_artefact_id"`
	Name           string     `json:"name"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at"`
	CreatedBy      *uuid.UUID `json:"created_by"`
	EdgeCount      int        `json:"edge_count,omitempty"`
}

// Edge is the wire shape for one persisted edge row.
type Edge struct {
	ID             uuid.UUID  `json:"id"`
	MapID          uuid.UUID  `json:"map_id"`
	FromArtefactID uuid.UUID  `json:"from_artefact_id"`
	ToArtefactID   uuid.UUID  `json:"to_artefact_id"`
	Kind           EdgeKind   `json:"kind"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	ArchivedAt     *time.Time `json:"archived_at"`
	CreatedBy      *uuid.UUID `json:"created_by"`
}

// CreateMapInput is the body accepted by POST /_site/dependencies/maps.
type CreateMapInput struct {
	TopologyNodeID uuid.UUID  `json:"topology_node_id"`
	RootArtefactID *uuid.UUID `json:"root_artefact_id"`
	Name           string     `json:"name"`
}

// RenameMapInput is the body accepted by PATCH /_site/dependencies/maps/{id}.
type RenameMapInput struct {
	Name string `json:"name"`
}

// CreateEdgeInput is the body accepted by POST /_site/dependencies/edges.
type CreateEdgeInput struct {
	MapID          uuid.UUID `json:"map_id"`
	FromArtefactID uuid.UUID `json:"from_artefact_id"`
	ToArtefactID   uuid.UUID `json:"to_artefact_id"`
	Kind           EdgeKind  `json:"kind"`
}

// MapImpact summarises edge participation under one map for the
// dependency-impact preflight (B23.1.8).
type MapImpact struct {
	MapID   uuid.UUID `json:"map_id"`
	MapName string    `json:"map_name"`
	Edges   int       `json:"edges"`
}

// ImpactReport is the response shape for GET /_site/work-items/{id}/dependency-impact.
type ImpactReport struct {
	ImpactedMaps []MapImpact `json:"impacted_maps"`
	TotalEdges   int         `json:"total_edges"`
}
