package timeboxreleases

import (
	"errors"
	"time"
)

var (
	ErrNotFound     = errors.New("release not found")
	ErrConflict     = errors.New("release dates overlap an existing release for this workspace and team")
	ErrInvalidInput = errors.New("invalid release input")
	ErrLifecycle    = errors.New("active or completed releases cannot be deleted")
)

// Release is the wire representation of a timeboxes_releases row. JSON
// tags follow §2.3 — wire keys match the column names.
type Release struct {
	ID                     string     `json:"timeboxes_releases_id"`
	SubscriptionID         string     `json:"timeboxes_releases_id_subscription"`
	WorkspaceID            string     `json:"timeboxes_releases_id_workspace"`
	OrgNodeID              *string    `json:"timeboxes_releases_id_topology_node"`
	ReleaseName            string     `json:"timeboxes_releases_name"`
	ReleaseSuffix          *string    `json:"timeboxes_releases_suffix"`
	ReleaseOwner           *string    `json:"timeboxes_releases_id_user_owner"`
	ReleaseCadenceDays     int        `json:"timeboxes_releases_cadence_days"`
	ReleaseDateStart       string     `json:"timeboxes_releases_date_start"`
	ReleaseDateEnd         string     `json:"timeboxes_releases_date_end"`
	ReleaseScope           int        `json:"timeboxes_releases_scope"`
	ReleaseVelocity        int        `json:"timeboxes_releases_velocity"`
	ReleaseEstimate        int        `json:"timeboxes_releases_estimate"`
	ReleaseCreepByCount    int        `json:"timeboxes_releases_creep_by_count"`
	ReleaseCreepByEstimate int        `json:"timeboxes_releases_creep_by_estimate"`
	Status                 string     `json:"timeboxes_releases_status"`
	ReleaseDateAdded       time.Time  `json:"timeboxes_releases_created_at"`
	ReleaseDateUpdated     time.Time  `json:"timeboxes_releases_updated_at"`
	ArchivedAt             *time.Time `json:"timeboxes_releases_archived_at"`
	// Slice 5 of the ObjectTree refactor — heartbeat substrate. See
	// the matching field on Sprint (backend/internal/timeboxsprints/
	// types.go) for the contract. Values: 'this_node_only' (default)
	// or 'this_node_and_descendants'.
	ScopePropagation string `json:"timeboxes_releases_scope_propagation"`
}

// CreateReleaseInput holds required fields to create a release.
type CreateReleaseInput struct {
	SubscriptionID     string
	WorkspaceID        string
	OrgNodeID          *string
	ReleaseName        string
	ReleaseSuffix      *string
	ReleaseOwner       *string
	ReleaseCadenceDays int
	ReleaseDateStart   string
	ReleaseDateEnd     string
	ReleaseVelocity    *int
	// Slice 5 — propagation intent. Nil = use the DB default
	// ('this_node_only'). Valid non-nil values:
	//   'this_node_only', 'this_node_and_descendants'
	ScopePropagation *string
}

// UpdateReleaseInput holds optional fields for partial release update.
// Nil pointer = field unchanged.
type UpdateReleaseInput struct {
	ReleaseName        *string
	ReleaseSuffix      *string
	ReleaseOwner       *string
	ReleaseCadenceDays *int
	ReleaseDateStart   *string
	ReleaseDateEnd     *string
	ReleaseScope       *int
	ReleaseVelocity    *int
	ReleaseEstimate    *int
	Status             *string
}

// ListFilters holds query parameters for the list endpoint.
type ListFilters struct {
	OrgNodeID *string
	Status    *string
}

var validStatuses = map[string]bool{
	"planned": true, "active": true, "completed": true,
}
